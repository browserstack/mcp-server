/**
 * The tool surface: four discovery tools plus ONE invoke tool.
 *
 * Discovery is deliberately two steps. `searchCapability` returns a shortlist — enough to
 * CHOOSE — and `describeCapability` returns the contract for the one chosen. Parameters and
 * response shapes are 86% of a full record and are needed once, not eight times: measured
 * over eight queries, ~8.6k tokens a search becomes ~1.1k, and even describing every result
 * still costs less than the single fat call did.
 *
 * ONE invoke tool means one set of MCP annotations, so they describe the whole surface
 * honestly: it can write (not read-only) and it can never delete, because destructive
 * endpoints are refused before binding. Write consent therefore rests on `user_permission`
 * enforced HERE rather than on a client-side hint — which is the one thing a separate
 * read/write tool pair was buying.
 */

import { randomUUID } from "node:crypto";
import {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import logger from "../../logger.js";
import { MCPEventExtras, trackMCP } from "../../lib/instrumentation.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { GroupedArguments } from "./bind.js";
import { indexPaths, isEnabled, resolveBaseUrl } from "./config.js";
import { redact } from "./redact.js";
import { Credentials, Transport, fetchTransport } from "./egress.js";
import {
  CapabilityRegistry,
  InvocationError,
  ResponseSelection,
  resolveResponses,
} from "./index-loader.js";
import { invoke } from "./resolve.js";
import {
  ambiguousProducts,
  productAnchors,
  isBrowseQuery,
  searchCapabilities,
  singular,
  terms,
  vocabularyOf,
} from "./search.js";
import { Mode } from "./types.js";

export const PERMISSION_VALUES = ["not_asked", "granted", "denied"] as const;

/**
 * The search-side twin of `user_permission`: did a human choose the product, or did you?
 *
 * No `denied`. A refused write is a thing the caller must not do; a refused product choice
 * is not a state — the user either named one, in which case you search it, or has not been
 * asked, in which case there is nothing to search yet.
 */
export const PRODUCT_CHOICE_VALUES = ["not_asked", "user_confirmed"] as const;

export interface RegistryDeps {
  registry: CapabilityRegistry;
  /**
   * Per-product base URL. Never baked into the artifact — it is environment AND account
   * specific: tm is region-sharded, so this is resolved per call, not once at startup.
   */
  baseUrlFor: (product: string) => Promise<string>;
  credentialsFor: () => Credentials;
  transport?: Transport;
}

/**
 * The tool-adder the server factory calls.
 *
 * Registers NOTHING when the artifact is absent or unreadable, rather than throwing: a
 * missing index is a packaging problem, and taking the whole MCP server down with it would
 * remove every other product's tools too. The reason is logged so it is not silent.
 */
export function addCapabilityRegistryToolsFromConfig(
  server: McpServer,
  config: BrowserStackConfig,
): Record<string, RegisteredTool> {
  if (!isEnabled()) {
    logger.info("capability registry disabled by CAPABILITY_REGISTRY_DISABLED");
    return {};
  }
  const files = indexPaths();
  if (files.length === 0) {
    logger.warn(
      "capability registry index not found; its tools are not registered. Set " +
        "CAPABILITY_REGISTRY_INDEX_DIR, or ship capabilities/<product>.capability-index.json " +
        "at the package root.",
    );
    return {};
  }
  let registry: CapabilityRegistry;
  try {
    registry = CapabilityRegistry.fromFiles(files);
  } catch (error) {
    // One unreadable file fails the whole load on purpose (see `fromFiles`), so this is
    // the only place that decides the surface is absent, and it says why.
    logger.error(
      "capability registry index unusable (%s): %s",
      files.join(", "),
      error instanceof Error ? error.message : String(error),
    );
    return {};
  }
  const loaded = registry.buildInfo();
  logger.info(
    "capability registry loaded: %d product(s) — %s",
    registry.productNames().length,
    registry
      .productNames()
      .map(
        (name) =>
          `${name} build ${loaded[name]?.build_id || "?"}` +
          (loaded[name]?.version ? ` v${loaded[name].version}` : ""),
      )
      .join(", "),
  );
  // WITHHELD CAPABILITIES ARE LOGGED, because they are otherwise undetectable from
  // outside: the flag's whole job is to make them invisible, so the count at startup is
  // the only place an operator can see that the surface is smaller than the artifact.
  const withheld = registry.disabledCounts();
  if (Object.keys(withheld).length) {
    logger.info(
      "capability registry withholding disabled capabilities: %s",
      Object.entries(withheld)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => `${name} ${count}`)
        .join(", "),
    );
  }
  return addCapabilityRegistryTools(
    server,
    {
      registry,
      // The whole product bundle, not just its host: a region-sharded product declares
      // several candidates and the probe needs an endpoint from its own capabilities.
      baseUrlFor: (product) =>
        resolveBaseUrl(product, config, registry.index.products[product]),
      // Read per call, not captured: the remote server rebuilds config per session, so a
      // captured credential would outlive the session it belongs to.
      credentialsFor: () => ({
        username: config["browserstack-username"],
        accessKey: config["browserstack-access-key"],
      }),
    },
    config,
  );
}

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function failed(
  message: string,
  extra?: Record<string, unknown>,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: message, ...extra }),
      },
    ],
    isError: true,
  };
}

export function addCapabilityRegistryTools(
  server: McpServer,
  deps: RegistryDeps,
  config?: BrowserStackConfig,
): Record<string, RegisteredTool> {
  const { registry } = deps;
  const productNames = registry.productNames();

  /**
   * The `product` argument, typed to what this build actually carries.
   *
   * An enum rather than a free string, so the accepted values travel in the SCHEMA the
   * client validates against — the model sees them without spending a `listProducts` call,
   * and a typo is rejected before the handler runs instead of coming back as a tool error.
   * The set is fixed for the session because the index is read once at registration.
   */
  const productArg = () =>
    productNames.length > 0
      ? z.enum(productNames as [string, ...string[]])
      : z.string();

  /** "tm, loadtesting" — for prose that has to name them. */
  const productList = productNames.join(", ") || "none loaded";

  // NO PRODUCT CATALOG IN ANY DESCRIPTION. listProducts used to restate every product's
  // trimmed summary in its own description — duplicating, as static context on every
  // single request, the exact thing the tool returns when called. Authored summaries are
  // also unbounded (loadtesting's runs to 470 characters) and change with the artifact,
  // so the prose went stale on its own. The names still travel in the `product` enum,
  // which is where a client can actually validate them.
  const transport = deps.transport || fetchTransport();
  const tools: Record<string, RegisteredTool> = {};

  /**
   * Clashes already raised on this connection, by the shared words that caused them.
   *
   * A refusal the caller can walk away from is advice, not a gate: measured, the agent
   * treated one as a single failed call, reworded the query, and the next phrasing no
   * longer carried the shared word — so the same request completed on a product nobody
   * chose. Remembering the WORDS rather than the sentence is what survives the rewording,
   * since `report` is still `report` however the sentence around it is rebuilt.
   *
   * Cleared when the caller names a product the words actually anchor: that is the answer
   * the refusal asked for, and the question stops being open.
   */
  const raisedClashes = new Set<string>();

  /**
   * Tokens minted by a product_ambiguous refusal and not yet spent.
   *
   * Remembering the clashing WORDS catches a reworded retry only while the rewording
   * keeps one of them; a paraphrase that drops the word reads as a fresh, unambiguous
   * request. A token cannot be paraphrased around, and cannot be guessed — the only way
   * to hold one is to have been refused, which is the round trip the gate is asking for.
   *
   * What it proves is bounded, and worth stating plainly: it shows the refusal was seen,
   * NOT that a human answered it. Nothing a caller can transmit shows that. It is spent
   * on use, so one refusal buys one retry, and `user_words` still has to anchor.
   */
  const openClashes = new Set<string>();
  const mintClashToken = (): string => {
    const token = `clash_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    openClashes.add(token);
    return token;
  };

  /**
   * The product the last routing call settled on, when the user's words settled it.
   *
   * listProducts judges the whole request; the gate on a later search judges whatever
   * fragment the caller quotes, and the two disagreed — a request that settled on one
   * product was refused a moment later over the one shared noun the caller quoted out of
   * it. The settlement is the better evidence of the two, having seen the whole sentence,
   * so it stands until a listing finds a real clash and withdraws it.
   */
  let settledByListing: string | undefined;

  /** Instrumentation in the house style, and never fatal to the call it wraps. */
  const track = (name: string, extras?: MCPEventExtras) => {
    try {
      trackMCP(
        name,
        server.server.getClientVersion()!,
        undefined,
        config,
        extras,
      );
    } catch {
      // Telemetry must not decide whether a tool call succeeds.
    }
  };

  /**
   * An InvocationError's reason, from the prefix the registry itself writes. These are our
   * own messages from bind.ts / index-loader.ts, not a product's prose.
   *
   * EVERY BRANCH HERE IS A STRING MATCH AGAINST ANOTHER FILE'S WORDING, which is exactly
   * as brittle as it sounds — `no_base_url` matched "no base URL is configured" while
   * config.ts throws "no host is configured", so that reason never once fired. The tests
   * below pin each branch against the message its source actually produces; if you reword
   * a refusal, one of them will tell you.
   */
  const invocationReason = (message: string): string => {
    if (message.startsWith("unknown_capability:")) return "unknown_capability";
    if (message.startsWith("unknown_endpoint:")) return "unknown_endpoint";
    // The outcome this PR turns on: 46 of 244 capabilities are withheld, so this is the
    // likeliest refusal of all, and it was landing in the generic bucket.
    if (message.startsWith("capability_disabled:"))
      return "capability_disabled";
    // Auth failed before the product was ever called, so it is not the product's 401 and
    // must not be counted as one. oauth.ts prefixes every one of these.
    if (message.startsWith("token_mint_failed:")) return "token_mint_failed";
    if (message.startsWith("missing required parameter"))
      return "missing_parameter";
    if (/is not a usable path value/.test(message)) return "bad_path_value";
    if (/^'[^']+' must be /.test(message)) return "bad_parameter_type";
    if (/^'[^']+' must match /.test(message)) return "bad_parameter_pattern";
    // config.ts's wording, not a paraphrase of it.
    if (message.includes("no host is configured")) return "no_base_url";
    return "invocation_error";
  };

  /**
   * A refusal or a failure, recorded and returned in one step.
   *
   * Every error path here returns through `failed()`, which produced no telemetry at all:
   * BigQuery showed zero registry failures across 1,069 calls in 30 days. `refusal_reason`
   * distinguishes what we refused before any network call from what the product rejected.
   */

  const refuse = (
    tool: string,
    reason: string,
    message: string,
    extra?: Record<string, unknown>,
    extras?: MCPEventExtras,
  ): CallToolResult => {
    try {
      trackMCP(
        tool,
        server.server.getClientVersion()!,
        new Error(message),
        config,
        { refusal_reason: reason, ...(extras ?? {}) },
      );
    } catch {
      // Telemetry must not decide whether a tool call succeeds.
    }
    return failed(message, extra);
  };

  tools.listProducts = server.tool(
    "listProducts",
    "List the BrowserStack products this surface can reach: what each one does, the " +
      "entities it models, and a line saying what each entity is. START HERE — " +
      "searchCapability needs a product, and this is what tells you which one. If two " +
      "products could both fit the task, ask the user rather than choosing for them. " +
      "ALWAYS pass the user's request, in their own words, as `query`: the answer then " +
      "says outright whether the products clash over the words in it. WHEN IT REPORTS A " +
      "CLASH — two products claiming the same word for different things — ASK THE USER " +
      "WHICH PRODUCT THEY MEAN AND WAIT FOR THEIR ANSWER BEFORE SEARCHING OR INVOKING " +
      "ANYTHING. The response carries the question to put to them and what the shared " +
      "word means in each product. Choosing for them, or searching each product in turn " +
      "and merging the results, is the failure this call exists to prevent.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "The user's request, in their own words. With it the response carries a " +
            "`routing` block saying whether the products share the vocabulary this " +
            "request uses — and, when they do, the question to put to the user before " +
            "searching either product.",
        ),
    },
    {
      title: "List Capability Products",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ query }) => {
      track("listProducts");
      // THE CLASH, STATED RATHER THAN LEFT TO BE NOTICED. The entity lists below carry
      // the evidence — `report` under two products — but reading two lists and spotting
      // the overlap is work an agent skips when it already has a product in mind. So the
      // overlap is computed here and put at the top, with the question already written:
      // the cheap failure is picking one silently, and this is the call that precedes it.
      const ambiguity = query
        ? ambiguousProducts(registry.index.products, query)
        : { products: [], terms: [] };
      // A CLASH ANNOUNCED HERE BINDS THE NEXT SEARCH. Reporting it and then letting the
      // very next call through was the gap the measured runs walked through: the agent
      // read the clash, searched one product and then the other, and asked only
      // afterwards. The gate downstream judges the caller's paraphrase when no user words
      // are quoted, and a paraphrase carries none of the shared words that caused this —
      // so the refusal never fired. Opening a token here makes the question outlive the
      // call that raised it, and `user_words` is what closes it.
      if (query) settledByListing = ambiguity.settled;
      const listingToken =
        query && (ambiguity.products.length > 1 || ambiguity.unknown)
          ? mintClashToken()
          : undefined;
      const routing =
        ambiguity.products.length > 1
          ? {
              verdict: "products_clash" as const,
              note:
                `These products clash over ${ambiguity.terms.map((t) => `'${t}'`).join(", ")} — ` +
                `the same word means something different in ${ambiguity.products.join(" and ")}. ` +
                "ASK THE USER which they mean before searching or invoking anything; do not " +
                "search each product in turn and merge the results. Searching before you " +
                "ask will be refused: send the user's answer in `user_words` with this " +
                "`resume_token`.",
              resume_token: listingToken,
              shared_terms: ambiguity.terms,
              products: ambiguity.products,
              question: `Which product do you mean — ${ambiguity.products.join(" or ")}?`,
              senses: ambiguity.products.map((name) => ({
                product: name,
                means: ambiguity.terms
                  .map((term) => {
                    const entities =
                      registry.index.products[name]?.entities ?? {};
                    const key = Object.keys(entities).find((candidate) =>
                      [
                        candidate,
                        ...((entities[candidate].aliases as string[]) ?? []),
                      ].some(
                        (word) => terms(word).map(singular).join(" ") === term,
                      ),
                    );
                    return key
                      ? {
                          term,
                          entity: key,
                          description: entities[key].description,
                        }
                      : undefined;
                  })
                  .filter(Boolean),
              })),
            }
          : query && ambiguity.unknown
            ? {
                verdict: "no_vocabulary" as const,
                note:
                  "Nothing in this request names a product, or any word that belongs to " +
                  "one — so there is no evidence here about which product is meant. This " +
                  "is the LEAST settled a request can be, not the most. ASK THE USER " +
                  "which product they mean before searching or invoking anything. " +
                  "Searching before you ask will be refused: send their answer in " +
                  "`user_words` with this `resume_token`.",
                resume_token: listingToken,
                question: `Which product do you mean — ${registry
                  .productNames()
                  .join(" or ")}?`,
              }
            : query
              ? {
                  verdict: "no_clash" as const,
                  note: ambiguity.settled
                    ? `This request names words only ${ambiguity.settled} claims` +
                      (ambiguity.because?.length
                        ? ` (${ambiguity.because.map((t) => `'${t}'`).join(", ")})`
                        : "") +
                      `, so it settles on ${ambiguity.settled} without asking. SEARCH ` +
                      `${ambiguity.settled}; the other products do not answer this request.`
                    : "No word in this request is claimed by more than one product, so the " +
                      "entity lists below settle it without asking.",
                  ...(ambiguity.settled ? { product: ambiguity.settled } : {}),
                  ...(ambiguity.because?.length
                    ? { deciding_terms: ambiguity.because }
                    : {}),
                }
              : undefined;
      return ok({
        ...(routing ? { routing } : {}),
        products: registry.productNames().map((name) => ({
          name,
          summary: registry.index.products[name].summary,
          // THE ENTITIES AND WHAT EACH ONE IS. Routing is this tool's whole job, and a
          // product summary alone does not do it: "add a tag to xyz test" reads as
          // either product until you can see that `tag` exists in one and not the other.
          // The one-line description is what makes each name mean something — `version`
          // alone does not say whether it versions a test case or a project — so an
          // agent can choose here instead of calling describeEntity once per entity to
          // find out, which for tm is 19 calls at ~1.4KB apiece.
          //
          // NAME AND DESCRIPTION ONLY. The aliases used to travel here too, and they are
          // the wrong half for this job: they answer "what else is this called", which
          // matters when a search has already failed on vocabulary, not when choosing a
          // product. They still reach the caller at exactly that moment, in
          // searchCapability's weak-match block, where the full vocabulary is the answer
          // rather than 2.5KB of speculative context on every routing call.
          entities: (
            vocabularyOf(registry.index.products, name)[name] ?? []
          ).map(({ entity, description }) => ({
            entity,
            ...(description ? { description } : {}),
          })),
          // NO build_id OR version. They are provenance — for our logs and for cache
          // busting — and capability resolution must never depend on them, which means
          // no caller has anything to do with them. They rode on the one call an agent
          // makes before it knows anything, costing context to say nothing actionable.
          // Still on searchCapability's response, where a support question about which
          // index answered can actually be traced to a result.
        })),
      });
    },
  );

  // listEntities WAS HERE, and is gone. It answered `{product, entities: [names]}` — a
  // strict subset of what listProducts now returns for every product, and with the
  // aliases missing. Keeping it would have meant two tools for one question, and a tool
  // definition costs context on every request whether or not it is called, which is the
  // entire reason this surface is five generic tools instead of 173 specific ones.
  //
  // One consequence to watch: listProducts now carries every product's vocabulary rather
  // than one product's on request, so it grows with the number of products — roughly 1KB
  // each. That is the right trade while routing is the problem it solves (you cannot
  // choose between products by looking at one of them), but past a dozen products it may
  // need a names-only default with aliases on request.

  tools.describeEntity = server.tool(
    "describeEntity",
    "Describe one entity: what it is, what identifies it, what it relates to, and the " +
      "vocabulary the product uses for it. Read this before filtering or writing, because " +
      "ids and field values usually have to be resolved first.",
    {
      product: productArg().describe(
        `Which product the entity belongs to: ${productList}.`,
      ),
      entity: z.string().describe("Entity name, as listProducts returns it."),
    },
    {
      title: "Describe Entity",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ product, entity }) => {
      track("describeEntity");
      const bundle = registry.index.products[product];
      if (!bundle)
        return refuse(
          "describeEntity",
          "unknown_product",
          `unknown product '${product}'`,
          undefined,
          { product },
        );
      const doc = bundle.entities[entity];
      if (!doc) {
        return failed(
          `unknown entity '${entity}' in ${product}; known: ${Object.keys(bundle.entities).sort().join(", ")}`,
        );
      }
      return ok({ product, entity, ...doc });
    },
  );

  tools.searchCapability = server.tool(
    "searchCapability",
    "Find endpoints this surface can call, by plain language, within ONE product. " +
      "CALL listProducts FIRST, passing the user's request as its `query`: it names the " +
      "products, says whether they clash over the words in that request, and gives you " +
      "the question to ask when they do. You need it anyway — `product` here takes a name " +
      "exactly as listProducts spells it. Where two products use the same word for " +
      "different things, ask the USER and wait for an answer rather than picking. " +
      "Search matches the product's OWN words, not synonyms. When your words are not the " +
      "product's, the response says so: `weak_match: true` with a `suggested_vocabulary` " +
      "map of the product's entities and their aliases. Results are still returned, but " +
      "treat them as unconfirmed — pick the closest entity from that map and search again " +
      "using its vocabulary, or call describeEntity on it for the fuller picture. That one " +
      "extra round trip is far cheaper than invoking the wrong capability. " +
      "Narrowing further with `entity` sharpens results. " +
      "THIS IS A SHORTLIST, NOT A CONTRACT. Each result carries only what you need to " +
      "CHOOSE: `name` (the handle), `product`, `mode` (whether it writes), `intent` and " +
      "`guidance` (what it does and what goes wrong), and `method`/`path` for products " +
      "that publish no name yet. " +
      "It does NOT carry parameters or response shapes. Once you have picked one, call " +
      "describeCapability for its full contract, then invokeCapability. Fetching the " +
      "contract only for the one you chose is the difference between ~1k and ~8.6k tokens " +
      "a search. Results are ranked and capped. " +
      "TO SEE EVERYTHING rather than search, pass query='*' — that lists the product " +
      "(honouring `entity` and `mode`) in a stable order instead of ranking it, which is " +
      "what you want when the task is 'what can this product do' rather than a lookup. " +
      "TO PAGE, send `offset`: every response carries `offset` and, when more matched, " +
      "`next_offset` — resend the SAME query with that value. `next_offset` is absent on " +
      "the last page, so walk until it stops rather than comparing counts.",
    {
      query: z
        .string()
        .describe(
          "What you are trying to do, in plain language. Pass '*' (or 'all') to BROWSE " +
            "instead of search: every capability in the product, in a stable order, " +
            "paginated — use it when you want to see the surface rather than find one thing.",
        ),
      entity: z
        .string()
        .optional()
        .describe("Restrict to one entity (listProducts names them)."),
      // REQUIRED, and the reason is the tool that is NOT being called. listProducts
      // carries the routing data — each product's purpose, its entities, and what every
      // entity means — but nothing obliged an agent to read it: a search that worked
      // without naming a product meant the routing step could always be skipped, and an
      // optional step in front of a working one is a step that does not happen. Requiring
      // the argument makes the ordering structural instead of advisory.
      //
      // It costs one listProducts call on queries that were already unambiguous — 139 of
      // 147 vocabulary terms resolve to a single product — and buys the eight that are
      // not (run, project, report, result, folder, workspace, execution, history), where
      // the old behaviour was to silently pick whichever product ranked higher. A wasted
      // round trip against a silent wrong-product answer is not a close trade.
      // A FREE STRING, NOT AN ENUM, AND DELIBERATELY SO — this is the only argument on
      // this surface that is. An enum publishes the product names in the schema, which
      // every client shows the model before it calls anything, so a model that has never
      // called listProducts already knows `tm` and `tra` exist and picks one. Measured:
      // on the requests that still routed silently, listProducts was never called at all
      // — there was nothing left to learn from it. Withholding the names makes the
      // discovery call the only way to obtain one, and discovery is where the clash gets
      // reported. The cost is losing client-side validation of a typo; an unknown name is
      // refused here instead, by a message that names listProducts.
      product: z
        .string()
        .describe(
          "Which product to search, named exactly as listProducts spells it. Call " +
            "listProducts with the user's request to get the name — and to find out " +
            "whether the products clash over it, in which case ask the user first.",
        ),
      // `product_choice` USED TO LIVE HERE, AND WAS ITS OWN DEFEAT.
      //
      // A required enum of 'user_confirmed' | 'not_asked' publishes, in the schema every
      // client shows the model before it calls anything, the exact string that opens the
      // gate. Measured on the prompts that still routed silently: the caller wrote
      // `user_confirmed` on every single one, with no user input behind any of them. A
      // flag the caller fills in about itself can always be filled in; there is no wording
      // of it that makes it true. What replaced it is a token this server mints and the
      // caller cannot guess, plus `user_words`, which is a claim the index can test.
      resume_token: z
        .string()
        .optional()
        .describe(
          "The token from a product_ambiguous refusal, sent back with the user's answer. " +
            "You cannot obtain one without being refused first, which is the point: it " +
            "shows the question reached the user rather than being reworded around. Send " +
            "it together with `user_words`; neither works alone.",
        ),
      user_words: z
        .string()
        .optional()
        .describe(
          "The USER'S OWN words, verbatim, that settle which product this is — either " +
            "the product's name or a term only one product uses ('quality gate', 'test " +
            "plan'). Quote them; do not paraphrase, and do not write words the user did " +
            "not say. When a query could mean either product this is what lifts the " +
            "refusal, because it is checked against the index rather than taken on trust.",
        ),
      mode: z
        .enum(["read", "write", "destructive"])
        .optional()
        .describe("Restrict to reads or writes. Omit to let the query decide."),
      limit: z.number().optional().describe("Max results (default 8)."),
      offset: z
        .number()
        .optional()
        .describe(
          "Skip this many results — send the `next_offset` from the previous response " +
            "with the SAME query to get the next page. Omit for the first page.",
        ),
    },
    {
      title: "Search Capabilities",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({
      query,
      entity,
      product,
      resume_token,
      user_words,
      mode,
      limit,
      offset,
    }) => {
      // THE GATE. Nothing here can tell whether a human was asked — same as the write
      // gate, which also takes the caller's word. What it can do is refuse to answer a
      // question that is genuinely the user's, so that answering it anyway takes a
      // deliberate claim instead of silence.
      //
      // Only when the query itself cannot settle the choice: every recognised word is one
      // both products claim. 27 of the 198 eval queries, against 135 if constituent words
      // counted. `entity` is an explicit narrowing, so a caller that named one has already
      // been specific enough and is not asked again.
      // The ambiguity gate asks the USER which product a word belongs to. A browse query
      // contains no word to be ambiguous about — `*` names nothing — so there is nothing
      // to ask, and asking anyway would block the one query whose whole purpose is to
      // show what a product contains.
      // PROTOTYPE (CAPABILITY_ROUTING_GATE=user_words): adjudicate instead of trusting.
      //
      // `product_choice` is the caller describing itself, and a caller that wants to
      // proceed says user_confirmed — measured at 103 of 183 ambiguous prompts with no
      // user input behind it, which skipped this gate entirely. So under the flag the
      // ambiguity check runs whatever the flag says, and what lifts it is `user_words`:
      // the user's own text, checked here against the index. Quoting the conversation is
      // a claim the server can test; a boolean is not.
      // `entity` USED TO BYPASS THIS TOO, and had no business doing so. An entity narrows
      // WITHIN a product; it says nothing about WHICH product, and the four names both
      // products carry — project, report, test_run, comment — are precisely the ones the
      // clash is about. `entity: "report"` alongside a guessed product is the silent pick
      // this gate exists to stop, stated more confidently, so it skipped the check at the
      // exact moment the check mattered.
      // `product` is a free string now, so an unknown name reaches the handler. Refuse it
      // where the caller can act on it: naming listProducts, which is where the real names
      // come from, rather than returning an empty search that reads as "nothing matched".
      if (!registry.index.products[product]) {
        return refuse(
          "searchCapability",
          "unknown_product",
          `No product named '${product}'. Call listProducts — passing the user's request ` +
            "as `query` — for the names, and for whether the products clash over it.",
          {},
          { product },
        );
      }
      const adjudicate = process.env.CAPABILITY_ROUTING_GATE === "user_words";
      if (!isBrowseQuery(query)) {
        // JUDGE THE USER'S WORDS, NOT THE AGENT'S REWRITE.
        //
        // `query` is the caller's paraphrase into product vocabulary, so the caller
        // decides, through its own phrasing, whether this check fires: "what did the last
        // report say?" became "list saved reports", and `saved report` is tra-only, so the
        // shared word the user actually said stopped being examined. It is also the escape
        // from a refusal — reword and try again, which is what the measured runs did. The
        // user's text is the one input the caller cannot rewrite without quoting something
        // different, and `productAnchors` checks what it quotes against this index.
        const subject = user_words?.trim() ? user_words : query;
        const ambiguity = ambiguousProducts(registry.index.products, subject);
        // ALWAYS, NOT ONLY UNDER THE FLAG. With the self-reported flag gone, quoting the
        // user is the only way past a clash, so the check that reads the quote has to run
        // on both paths — otherwise the default path refuses with no way out at all. The
        // flag now governs the stricter refusals (a blank request, a clash still open),
        // not whether the user's own words count.
        const anchor = productAnchors(registry.index.products, user_words);
        // One product anchored, and it is the one being searched: the user settled it.
        // A listing that already settled on this product counts the same way: it read the
        // user's whole request, which is more than the fragment quoted here.
        // A VALID TOKEN IS WHAT CLEARS AN OPEN CLASH, and it has to arrive WITH the
        // user's words: the token shows the question was put, the words say what came
        // back. Spent on use, so it buys exactly the one retry it was minted for.
        const redeemed = Boolean(
          resume_token &&
          openClashes.has(resume_token) &&
          anchor.products.length === 1 &&
          anchor.products[0] === product,
        );
        if (redeemed) openClashes.delete(resume_token!);
        // One product anchored, and it is the one being searched: the user settled it.
        // A listing that already settled on this product counts the same way: it read the
        // user's whole request, which is more than the fragment quoted here.
        const settled =
          redeemed ||
          (anchor.products.length === 1 && anchor.products[0] === product) ||
          settledByListing === product;
        // A clash raised earlier is still open until it is answered, whatever this call's
        // wording looks like. Without this, a reworded query reads as unambiguous and the
        // refusal is simply routed around.
        const reopened = adjudicate && !settled && openClashes.size > 0;
        // NOTHING RECOGNISED IS NOT PERMISSION TO PICK. A request carrying no product's
        // vocabulary is the least settled kind there is, and it used to pass this gate
        // untouched because there was no shared word in it to object to.
        const blank = adjudicate && ambiguity.unknown && !settled;
        if (
          adjudicate &&
          (ambiguity.products.length > 1 || reopened || blank) &&
          !settled
        ) {
          for (const term of ambiguity.terms) raisedClashes.add(term);
          const token = mintClashToken();
          const named = anchor.products.length > 0;
          return refuse(
            "searchCapability",
            "product_ambiguous",
            (blank
              ? `Nothing in '${subject}' names a product, or any word that belongs to ` +
                "one, so there is no evidence here about which one is meant — that is " +
                "the least settled a request can be, not the most. "
              : `'${subject}' could mean ${ambiguity.products.join(" or ")} — ` +
                `${ambiguity.terms.map((t) => `'${t}'`).join(", ")} ` +
                `${ambiguity.terms.length === 1 ? "belongs" : "belong"} to both. `) +
              (named
                ? `The words you quoted (${anchor.terms.map((t) => `'${t}'`).join(", ")}) ` +
                  `point at ${anchor.products.join(" and ")}, not ${product}. `
                : user_words
                  ? "Nothing in the words you quoted names a product or a term only one " +
                    "product uses. "
                  : "Send `user_words` — the user's OWN words naming the product, or a " +
                    "term only one product uses — or ask them. ") +
              "Put the choice to the USER in their own terms, wait for an answer, then " +
              "resend with their words in `user_words` AND `resume_token` set to the " +
              "token below. Rewording this query will not get past here. Do NOT search " +
              "each product in turn and merge the results.",
            {
              resume_token: token,
              clarify: {
                question: `Which product do you mean — ${(ambiguity.products
                  .length
                  ? ambiguity.products
                  : registry.productNames()
                ).join(" or ")}?`,
                shared: ambiguity.terms,
                options: (ambiguity.products.length
                  ? ambiguity.products
                  : registry.productNames()
                ).map((name) => ({
                  product: name,
                  summary: registry.index.products[name]?.summary,
                })),
              },
            },
            { product: ambiguity.products.join("+") || "none" },
          );
        }
        if (ambiguity.products.length > 1 && !adjudicate) {
          // EVERYTHING NEEDED TO ASK, IN THE REFUSAL. Telling the agent to go and call
          // listProducts costs a round trip and still leaves it composing a question out
          // of nothing — so it tends to guess instead, which is the behaviour being
          // stopped. What makes the choice answerable is what each product calls the
          // shared word and what it means THERE: tm's project owns folders and test
          // cases, Load Testing's does not.
          const options = ambiguity.products.map((name) => {
            const entities = registry.index.products[name]?.entities ?? {};
            const senses = ambiguity.terms
              .map((term) => {
                const key = Object.keys(entities).find((candidate) =>
                  [
                    candidate,
                    ...((entities[candidate].aliases as string[]) ?? []),
                  ].some(
                    (word) => terms(word).map(singular).join(" ") === term,
                  ),
                );
                const doc = key ? entities[key] : undefined;
                return doc
                  ? { term, entity: key as string, means: doc.description }
                  : undefined;
              })
              .filter(Boolean);
            return {
              product: name,
              summary: registry.index.products[name]?.summary,
              ...(senses.length ? { shared_terms: senses } : {}),
            };
          });
          return refuse(
            "searchCapability",
            "product_ambiguous",
            `'${subject}' could mean ${ambiguity.products.join(" or ")} — ` +
              `${ambiguity.terms.map((t) => `'${t}'`).join(", ")} ` +
              `${ambiguity.terms.length === 1 ? "belongs" : "belong"} to both. ` +
              "Put the choice in `clarify` to the USER in their own terms, wait for an " +
              "answer, then resend with their words in `user_words`. Do NOT search " +
              "each product in turn and merge the results — that answers the question " +
              "instead of asking it.",
            {
              clarify: {
                question: `Which product do you mean — ${ambiguity.products.join(" or ")}?`,
                shared: ambiguity.terms,
                options,
              },
            },
            { product: ambiguity.products.join("+") },
          );
        }
      }

      // The user named a product the words anchor, so the question this gate asked has been
      // answered; a later search for the same words is no longer the unanswered one.
      if (adjudicate && user_words?.trim()) {
        const answered = productAnchors(registry.index.products, user_words);
        if (answered.products.length === 1 && answered.products[0] === product)
          for (const term of answered.terms) raisedClashes.delete(term);
      }

      const { hits, weak, top_matched, ...rest } = searchCapabilities(
        registry.index.products,
        query,
        {
          entity,
          product,
          mode: mode as Mode | undefined,
          limit,
          offset,
        },
      );
      // Whether the search FOUND anything useful: zero results, or a weak match (the
      // caller's words are not the product's), is a miss worth counting even though the
      // call succeeded.
      track("searchCapability", {
        product,
        entity,
        search_query: redact(query),
        results_returned: hits.length,
        total_matched: rest.total_matched,
        truncated: rest.truncated,
        weak_match: weak,
        coverage: Math.round(rest.coverage * 100) / 100,
      });
      return ok({
        // NO build_id. It is provenance — for our logs and for cache busting — and
        // resolution must never depend on it, which is exactly why no caller has anything
        // to do with it. It was also the WHOLE registry's id, so a search scoped to one
        // product still announced every other product's build: metadata about builds the
        // caller did not ask about and cannot act on. The startup log already records
        // what loaded, which is where a question about a stale index gets answered.
        //
        // A SHORTLIST: only what choosing requires. Parameters and response shapes are 86%
        // of a full record and are needed for exactly ONE of the eight — the one the caller
        // picks — so they move to describeCapability. Measured over eight queries: 8.6k
        // tokens a search becomes ~1k, and even describing all eight results still costs
        // slightly less than today.
        //
        // NO ROUTE, AND NO PRODUCT. Both were justified and both justifications expired.
        //
        // `method`/`path` were unconditional because Load Testing published no names, so
        // its rows would otherwise have been unaddressable. It now names all 20, as tm
        // names all 173 — every row on this surface is reachable by name. Publishing the
        // route anyway contradicts the premise the whole registry rests on: an agent
        // addresses a capability by a handle that outlives the route. They remain as a
        // fallback for a product that ships unnamed capabilities, emitted only for the
        // rows that actually need them, which today is none.
        //
        // `product` was here because results could span products. They cannot: `product`
        // is a required argument, so every row is the product the caller named.
        capabilities: hits.map(({ capability }) => ({
          ...(capability.name
            ? { name: capability.name }
            : { method: capability.method, path: capability.path }),
          mode: capability.mode,
          entity: capability.entity,
          ...(capability.intent ? { intent: capability.intent } : {}),
          ...(capability.guidance?.length
            ? { guidance: capability.guidance }
            : {}),
        })),
        ...rest,
        // WHEN THE MATCH IS WEAK, HAND OVER THE VOCABULARY.
        //
        // A vocabulary miss returns a full page of confident-looking hits — nothing in the
        // shape of the response says the caller's word does not exist in this product. This
        // is that signal, plus the fix in the same round trip: the caller is a model, and it
        // maps "bucket" to "folder" instantly once it can see the entity list.
        //
        // Additive, never a replacement — the results are still there, and the caller is
        // told to re-search rather than to trust this. That is what makes a generous
        // threshold safe.
        ...(weak
          ? {
              weak_match: true,
              suggested_vocabulary: vocabularyOf(
                registry.index.products,
                product,
              ),
              hint:
                "Nothing matched the product's own words strongly (best term score " +
                `${top_matched.toFixed(1)}). The results below may not answer the ` +
                "question. Re-search using a term from suggested_vocabulary, or call " +
                "describeEntity on the closest entity for its full vocabulary.",
            }
          : {}),
      });
    },
  );

  tools.describeCapability = server.tool(
    "describeCapability",
    "The full contract for ONE capability you picked from searchCapability: its " +
      "parameters grouped into path_params / query / body under the spec's own names, " +
      "what it returns, and its declared response shapes fully expanded. Call this after " +
      "search and before invokeCapability — search deliberately omits all of it, because " +
      "it is only needed for the one capability you actually call. " +
      "Identify it by `name`, exactly as search returned it; only when a result carries " +
      "no `name` (some products publish none yet) pass `method` and `path` instead. " +
      "Every parameter lists its type, whether it is required, its allowed values where " +
      "the set is closed, and any limits the product declares — obey those before calling " +
      "rather than discovering them from a rejected request.",
    {
      name: z
        .string()
        .optional()
        .describe(
          "The capability's published name, exactly as searchCapability returned it.",
        ),
      method: z
        .string()
        .optional()
        .describe(
          "HTTP method — only for capabilities returned without a `name`.",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Path with {placeholders} intact — only for capabilities returned without a `name`.",
        ),
      product: productArg()
        .optional()
        .describe(
          `Which product owns it (${productList}). searchCapability returns it on every ` +
            "result; required only when two products share a name or a path.",
        ),
      include_responses: z
        .enum(["success", "all", "none"])
        .optional()
        .describe(
          "Which declared responses to expand: 'success' (default, the 2xx shape), 'all' " +
            "(adds the error shapes — several times larger, and near-identical across " +
            "endpoints), or 'none'.",
        ),
    },
    {
      title: "Describe Capability",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async (input): Promise<CallToolResult> => {
      // Hoisted so the catch below can attribute a failure to the capability it was for.
      let identity: MCPEventExtras | undefined;
      try {
        // The same two handles as invokeCapability, resolved the same way, so a name that
        // describes is a name that invokes. Divergence here would be its own bug class.
        if (!input.name && !(input.method && input.path)) {
          return refuse(
            "describeCapability",
            "no_handle",
            "pass `name` — or, for a capability returned without one, both `method` and " +
              "`path`, exactly as searchCapability returned them",
          );
        }
        const { product: owner, capability } = input.name
          ? registry.byNameLookup(input.name, input.product)
          : registry.byEndpointLookup(
              input.method as string,
              input.path as string,
              input.product,
            );

        identity = {
          capability: capability.name,
          capability_method: capability.method,
          capability_path: capability.path,
          capability_mode: capability.mode,
          product: owner,
        };
        track("describeCapability", identity);
        const selection = (input.include_responses ||
          "success") as ResponseSelection;
        const responses = resolveResponses(
          registry.index.products[owner],
          capability,
          selection,
        );
        // Dropped rather than overwritten: the raw field holds `{"$response": …}` pointers,
        // and spreading the capability would leak them through whenever the resolved value
        // is absent.
        const { responses: unresolved, method, path, ...contract } = capability;
        void unresolved;
        return ok({
          // No build_id here either, same reason. `product` stays: describeCapability
          // resolves by NAME and its product argument is optional, so the answer has to
          // say whose contract came back.
          product: owner,
          // NO ROUTE, for the same reason the shortlist has none. A named capability is
          // invoked by its name; the route is how WE reach the product, not something
          // the caller acts on, and a contract that shows both invites the caller to
          // hold the half that breaks when `/edit` becomes `/edit-v2`. The parameters
          // below still carry `path_params`, so the caller knows what to supply — it
          // just never sees the template they are substituted into.
          //
          // Emitted only when there is no name to use instead, which is what
          // invokeCapability falls back to for a product that publishes none. No shipped
          // product is in that state today.
          ...(capability.name ? {} : { method, path }),
          ...contract,
          ...(responses ? { responses } : {}),
        });
      } catch (error) {
        if (error instanceof InvocationError)
          return refuse(
            "describeCapability",
            invocationReason(error.message),
            error.message,
            undefined,
            identity,
          );
        logger.error(
          "describeCapability failed: %s",
          error instanceof Error ? error.message : String(error),
        );
        return refuse(
          "describeCapability",
          "unexpected_error",
          "that capability could not be described",
          undefined,
          identity,
        );
      }
    },
  );

  tools.invokeCapability = server.tool(
    "invokeCapability",
    "Call a capability whose contract you have from describeCapability. Pass `name` exactly " +
      "as given — that is the handle. Only when a result carries no `name` (some products " +
      "do not publish them yet) pass `method` and `path` instead, exactly as returned. " +
      "Arguments go in path_params / query / body under the spec's own names. One call " +
      "makes exactly one request and returns the product's own response untouched; when " +
      "`completed` is false there is another page, which you fetch by sending the " +
      "capability's own page parameter. If the mode is 'write' you MUST ask the user " +
      "first, then resend with user_permission='granted' and a change_summary; both are " +
      "recorded. Capabilities whose mode is 'destructive' (deletes) are refused outright — " +
      "archiving, closing and merging are ordinary writes and DO run, so read the mode and " +
      "intent before confirming with the user.",
    {
      name: z
        .string()
        .optional()
        .describe(
          "The capability's published name, exactly as returned (e.g. 'create_test_run_by_integer_id'). " +
            "Preferred over method/path.",
        ),
      method: z
        .string()
        .optional()
        .describe(
          "HTTP method — only for capabilities returned without a `name`.",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Path with {placeholders} intact — only for capabilities returned without a `name`.",
        ),
      path_params: z
        .record(z.string(), z.any())
        .optional()
        .describe("Values for the {placeholders}."),
      query: z
        .record(z.string(), z.any())
        .optional()
        .describe("Query parameters."),
      body: z
        .record(z.string(), z.any())
        .optional()
        .describe("Body fields, under the spec's names."),
      product: productArg()
        .optional()
        .describe(
          `Which product owns the capability (${productList}). searchCapability returns it ` +
            "on every result; required only when two products share a name or a path.",
        ),
      user_permission: z
        .enum(PERMISSION_VALUES)
        .optional()
        .describe(
          "Set to 'granted' only after the user has confirmed a write.",
        ),
      change_summary: z
        .string()
        .optional()
        .describe("What will change. Required for writes."),
    },
    {
      title: "Invoke Capability",
      // Not read-only: this is the one tool that writes. Never destructive, because
      // destructive endpoints are refused before binding — the refusal is enforced here,
      // not merely hinted at. Not idempotent: it creates, clones and starts runs. Closed
      // world: it reaches BrowserStack products the index describes, nothing else.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async (input): Promise<CallToolResult> => {
      // Hoisted so the catch below can attribute a failure to the capability it was for.
      // Left undefined until resolution succeeds, which is the only point it is known —
      // a refusal before that genuinely has no capability to name.
      let identity: MCPEventExtras | undefined;
      try {
        // Either handle resolves to the same capability. `name` wins when both are sent,
        // rather than cross-checking them: a caller pasting a stale path alongside a good
        // name should still reach the right operation, which is the point of naming.
        if (!input.name && !(input.method && input.path)) {
          return refuse(
            "invokeCapability",
            "no_handle",
            "pass `name` — or, for a capability returned without one, both `method` and " +
              "`path`, exactly as searchCapability returned them",
          );
        }
        const { product, capability } = input.name
          ? registry.byNameLookup(input.name, input.product)
          : registry.byEndpointLookup(
              input.method as string,
              input.path as string,
              input.product,
            );
        /** What to call it in errors — the handle the caller actually used. */
        const handle =
          capability.name || `${capability.method} ${capability.path}`;
        /**
         * What was asked for. Recorded after resolution, not at entry, because only here is
         * it known. `capability` is absent for a product that publishes no names, where
         * method+path are the handle.
         */
        identity = {
          capability: capability.name,
          capability_method: capability.method,
          capability_path: capability.path,
          capability_mode: capability.mode,
          product,
        };
        const args: GroupedArguments = {
          path_params: input.path_params,
          query: input.query,
          body: input.body,
        };

        if (capability.mode === "destructive") {
          // Refused before binding, so consent is never sought for something that cannot run.
          return refuse(
            "invokeCapability",
            "destructive_blocked",
            `${handle} is a destructive operation and is not available through this surface`,
            undefined,
            identity,
          );
        }

        if (capability.mode === "write") {
          const permission = input.user_permission || "not_asked";
          // PARAMETERS ARE VALIDATED BEFORE PERMISSION IS DEMANDED. The gate used to run
          // first, so a caller with a typo'd parameter was told "ask the user to confirm this
          // change", went back to the human for approval, and only then learned the parameter
          // was wrong. A dry bind costs nothing and cannot mutate.
          const { bind } = await import("./bind.js");
          bind(capability, args);
          if (permission !== "granted") {
            // Catches the careless path, not the adversarial one: the model fills this field
            // in, so it is an audit record and a speed bump, never authorisation.
            return refuse(
              "invokeCapability",
              "permission_not_granted",
              "refused: this endpoint changes data — ask the user to confirm, then retry " +
                "with user_permission='granted' and a change_summary",
              undefined,
              identity,
            );
          }
          if (!(input.change_summary || "").trim()) {
            return refuse(
              "invokeCapability",
              "change_summary_missing",
              "change_summary is required: state what will change",
              undefined,
              identity,
            );
          }
        }

        const result = await invoke(
          capability,
          args,
          await deps.baseUrlFor(product),
          deps.credentialsFor(),
          transport,
          registry.index.products[product]?.auth,
          product,
        );
        // The one row for a completed invoke. invoke() returns a 4xx/5xx rather than
        // throwing, so `success` keeps its tool-level meaning and these two fields carry
        // whether the product call worked. Status 0 means it could not be reached.
        track("invokeCapability", {
          ...identity,
          upstream_ok: result.ok,
          upstream_status: result.http_response.status,
          change_summary: redact(input.change_summary),
        });
        return ok(result);
      } catch (error) {
        if (error instanceof InvocationError)
          return refuse(
            "invokeCapability",
            invocationReason(error.message),
            error.message,
            undefined,
            identity,
          );
        logger.error(
          "invokeCapability failed: %s",
          error instanceof Error ? error.message : String(error),
        );
        return refuse(
          "invokeCapability",
          "unexpected_error",
          "that capability could not be invoked",
          undefined,
          identity,
        );
      }
    },
  );

  return tools;
}

export default addCapabilityRegistryToolsFromConfig;
