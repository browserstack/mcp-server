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
import { trackMCP } from "../../lib/instrumentation.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { GroupedArguments } from "./bind.js";
import { indexPaths, isEnabled, resolveBaseUrl } from "./config.js";
import { Credentials, Transport, fetchTransport } from "./egress.js";
import {
  CapabilityRegistry,
  InvocationError,
  ResponseSelection,
  resolveResponses,
} from "./index-loader.js";
import { invoke } from "./resolve.js";
import { searchCapabilities, vocabularyOf } from "./search.js";
import { Mode } from "./types.js";

export const PERMISSION_VALUES = ["not_asked", "granted", "denied"] as const;

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

function failed(message: string): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify({ ok: false, error: message }) },
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
  const track = (name: string) => {
    try {
      trackMCP(name, server.server.getClientVersion()!, undefined, config);
    } catch {
      // Telemetry must not decide whether a tool call succeeds.
    }
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
      if (!bundle) return failed(`unknown product '${product}'`);
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
      "a search. Results are ranked and capped, and `truncated` says when more matched.",
    {
      query: z
        .string()
        .describe("What you are trying to do, in plain language."),
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
      mode: z
        .enum(["read", "write", "destructive"])
        .optional()
        .describe("Restrict to reads or writes. Omit to let the query decide."),
      limit: z.number().optional().describe("Max results (default 8)."),
    },
    {
      title: "Search Capabilities",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ query, entity, product, mode, limit }) => {
      track("searchCapability");
      const { hits, weak, top_matched, ...rest } = searchCapabilities(
        registry.index.products,
        query,
        {
          entity,
          product,
          mode: mode as Mode | undefined,
          limit,
        },
      );
      return ok({
        build_id: registry.buildId,
        // A SHORTLIST: only what choosing requires. Parameters and response shapes are 86%
        // of a full record and are needed for exactly ONE of the eight — the one the caller
        // picks — so they move to describeCapability. Measured over eight queries: 8.6k
        // tokens a search becomes ~1k, and even describing all eight results still costs
        // slightly less than today.
        //
        // `product` is here because results span products and the caller cannot otherwise
        // tell a Load Testing row from a Test Management one. `method`/`path` are here
        // because Load Testing publishes no names at all — without them its rows would be
        // unaddressable, which is worse than verbose.
        capabilities: hits.map(({ product: owner, capability }) => ({
          ...(capability.name ? { name: capability.name } : {}),
          product: owner,
          method: capability.method,
          path: capability.path,
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
      track("describeCapability");
      try {
        // The same two handles as invokeCapability, resolved the same way, so a name that
        // describes is a name that invokes. Divergence here would be its own bug class.
        if (!input.name && !(input.method && input.path)) {
          return failed(
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
        const { responses: unresolved, ...contract } = capability;
        void unresolved;
        return ok({
          build_id: registry.buildId,
          product: owner,
          ...contract,
          ...(responses ? { responses } : {}),
        });
      } catch (error) {
        if (error instanceof InvocationError) return failed(error.message);
        logger.error(
          "describeCapability failed: %s",
          error instanceof Error ? error.message : String(error),
        );
        return failed("that capability could not be described");
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
      track("invokeCapability");
      try {
        // Either handle resolves to the same capability. `name` wins when both are sent,
        // rather than cross-checking them: a caller pasting a stale path alongside a good
        // name should still reach the right operation, which is the point of naming.
        if (!input.name && !(input.method && input.path)) {
          return failed(
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
        const args: GroupedArguments = {
          path_params: input.path_params,
          query: input.query,
          body: input.body,
        };

        if (capability.mode === "destructive") {
          // Refused before binding, so consent is never sought for something that cannot run.
          return failed(
            `${handle} is a destructive operation and is not available through this surface`,
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
            return failed(
              "refused: this endpoint changes data — ask the user to confirm, then retry " +
                "with user_permission='granted' and a change_summary",
            );
          }
          if (!(input.change_summary || "").trim()) {
            return failed("change_summary is required: state what will change");
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
        return ok(result);
      } catch (error) {
        if (error instanceof InvocationError) return failed(error.message);
        logger.error(
          "invokeCapability failed: %s",
          error instanceof Error ? error.message : String(error),
        );
        return failed("that capability could not be invoked");
      }
    },
  );

  return tools;
}

export default addCapabilityRegistryToolsFromConfig;
