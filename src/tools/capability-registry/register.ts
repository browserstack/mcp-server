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
   * A refusal or a failure, recorded and returned in one step.
   *
   * Every error path here returns through `failed()`, which produced no telemetry at all:
   * BigQuery showed zero registry failures across 1,069 calls in 30 days. `refusal_reason`
   * distinguishes what we refused before any network call from what the product rejected.
   */
  /**
   * An InvocationError's reason, from the prefix the registry itself writes. These are our
   * own messages from bind.ts / index-loader.ts, not a product's prose.
   */
  const invocationReason = (message: string): string => {
    if (message.startsWith("unknown_capability:")) return "unknown_capability";
    if (message.startsWith("missing required parameter"))
      return "missing_parameter";
    if (/^'[^']+' must be /.test(message)) return "bad_parameter_type";
    if (message.includes("no base URL is configured")) return "no_base_url";
    return "invocation_error";
  };

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
      "products could both fit the task, ask the user rather than choosing for them.",
    {},
    {
      title: "List Capability Products",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async () => {
      track("listProducts");
      return ok({
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
      `You must say which: ${productList}. If the task does not name it unambiguously, ` +
      "call listProducts first — it returns what each product does, the entities each " +
      "models, and what every entity means, which is what settles the choice. Where two " +
      "products use the same word for different things, ask the user rather than picking. " +
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
      product: productArg().describe(
        `Which product to search: ${productList}. Call listProducts if the task does ` +
          `not make it obvious, and ask the user when two products could both fit.`,
      ),
      // REQUIRED, and self-reported, exactly like `user_permission` on a write. The
      // server cannot see whether you asked anyone; what it can do is refuse to answer a
      // question only the user can settle, and make claiming otherwise an explicit act
      // rather than an omission.
      product_choice: z
        .enum(PRODUCT_CHOICE_VALUES)
        .describe(
          "'user_confirmed' only when the user named the product, or the task names it " +
            "unmistakably. 'not_asked' otherwise — then a query that could mean either " +
            "product is refused and told what to ask, instead of being answered for the " +
            "wrong one. Never search each product in turn and merge the results: that is " +
            "the guess this argument exists to prevent.",
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
    async ({ query, entity, product, product_choice, mode, limit, offset }) => {
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
      if (
        product_choice !== "user_confirmed" &&
        !entity &&
        !isBrowseQuery(query)
      ) {
        const ambiguity = ambiguousProducts(registry.index.products, query);
        if (ambiguity.products.length > 1) {
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
            `'${query}' could mean ${ambiguity.products.join(" or ")} — ` +
              `${ambiguity.terms.map((t) => `'${t}'`).join(", ")} ` +
              `${ambiguity.terms.length === 1 ? "belongs" : "belong"} to both. ` +
              "Put the choice in `clarify` to the USER in their own terms, wait for an " +
              "answer, then resend with product_choice='user_confirmed'. Do NOT search " +
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

        track("describeCapability", {
          capability: capability.name,
          capability_method: capability.method,
          capability_path: capability.path,
          capability_mode: capability.mode,
          product: owner,
        });
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
          );
        logger.error(
          "describeCapability failed: %s",
          error instanceof Error ? error.message : String(error),
        );
        return refuse(
          "describeCapability",
          "unexpected_error",
          "that capability could not be described",
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
          "The capability's published name, exactly as returned (e.g. 'create_test_run_v1'). " +
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
         * it known. `capability` is absent for a product that publishes no names
         * (loadtesting), where method+path are the handle.
         */
        const identity: MCPEventExtras = {
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
          );
        logger.error(
          "invokeCapability failed: %s",
          error instanceof Error ? error.message : String(error),
        );
        return refuse(
          "invokeCapability",
          "unexpected_error",
          "that capability could not be invoked",
        );
      }
    },
  );

  return tools;
}

export default addCapabilityRegistryToolsFromConfig;
