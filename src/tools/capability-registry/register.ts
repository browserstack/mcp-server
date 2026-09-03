/**
 * The tool surface: four discovery tools plus ONE invoke tool.
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
import { searchCapabilities } from "./search.js";
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

  /**
   * One line per product, for the ONE tool whose job is routing between them.
   *
   * Only listProducts carries the summaries. They are authored prose of unbounded length —
   * tm's is 90 characters, loadtesting's is 470 — and a tool description is static context
   * on every request, so repeating them across five tools would cost more than the round
   * trip they save. Everywhere else the names alone are what a caller needs.
   *
   * Each summary is cut to its first sentence and capped, and the whole catalog is
   * budgeted: past the budget the names still route, which is the part that matters.
   */
  const productCatalog = (() => {
    const lines = productNames.map((name) => {
      const summary = registry.index.products[name].summary.trim();
      const firstSentence = summary.split(/(?<=\.)\s/)[0] ?? summary;
      const trimmed =
        firstSentence.length > 130
          ? `${firstSentence.slice(0, 127).trimEnd()}…`
          : firstSentence;
      return `${name} — ${trimmed.replace(/\.$/, "")}`;
    });
    const joined = lines.join("; ");
    return joined.length <= 500 ? joined : productList;
  })();
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
    "List the BrowserStack products this surface can reach, with a one-line summary each. " +
      "Start here when you do not know which product a task belongs to. " +
      `This build carries ${productCatalog}.`,
    {},
    async () => {
      track("listProducts");
      const info = registry.buildInfo();
      return ok({
        build_id: registry.buildId,
        products: registry.productNames().map((name) => ({
          name,
          summary: registry.index.products[name].summary,
          // Provenance for logging and cache-busting only — capability resolution must
          // never depend on it.
          build_id: info[name]?.build_id,
          ...(info[name]?.version ? { version: info[name].version } : {}),
        })),
      });
    },
  );

  tools.listEntities = server.tool(
    "listEntities",
    "List the entities a product models (test case, folder, test plan, …). Use it to scope " +
      "searchCapability, or to find the entity name describeEntity wants.",
    {
      product: productArg().describe(
        `Which product to list entities for: ${productList}.`,
      ),
    },
    async ({ product }) => {
      track("listEntities");
      const bundle = registry.index.products[product];
      if (!bundle) return failed(`unknown product '${product}'`);
      return ok({ product, entities: Object.keys(bundle.entities).sort() });
    },
  );

  tools.describeEntity = server.tool(
    "describeEntity",
    "Describe one entity: what it is, what identifies it, what it relates to, and the " +
      "vocabulary the product uses for it. Read this before filtering or writing, because " +
      "ids and field values usually have to be resolved first.",
    {
      product: productArg().describe(
        `Which product the entity belongs to: ${productList}.`,
      ),
      entity: z.string().describe("Entity name from listEntities."),
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
    "Find endpoints this surface can call, by plain language, optionally narrowed to one " +
      "entity, product or mode. " +
      `Currently loaded products: ${productList} — call listProducts for what each does. ` +
      "Each result carries the endpoint's `method` and `path` plus " +
      "its parameters grouped into path_params / query / body under the spec's own names — " +
      "pass them straight back to invokeEndpoint, no renaming. `intent` says what it does, " +
      "`mode` tells you whether it writes, `product` says which product owns it, and " +
      "`responses` describes what a successful call returns, fully expanded. Results are " +
      "ranked and capped, and `truncated` says when more matched. Search before invoking.",
    {
      query: z
        .string()
        .describe("What you are trying to do, in plain language."),
      entity: z
        .string()
        .optional()
        .describe("Restrict to one entity (see listEntities)."),
      product: productArg()
        .optional()
        .describe(
          `Restrict to one product: ${productList}. Omit to search all of them.`,
        ),
      mode: z
        .enum(["read", "write", "destructive"])
        .optional()
        .describe("Restrict to reads or writes. Omit to let the query decide."),
      limit: z.number().optional().describe("Max results (default 8)."),
      include_responses: z
        .enum(["success", "all", "none"])
        .optional()
        .describe(
          "Which declared responses to expand: 'success' (default, the 2xx shape), 'all' " +
            "(adds the error shapes — several times larger, and near-identical across " +
            "endpoints), or 'none'.",
        ),
    },
    async ({ query, entity, product, mode, limit, include_responses }) => {
      track("searchCapability");
      const selection = (include_responses || "success") as ResponseSelection;
      const { hits, ...rest } = searchCapabilities(
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
        // Dereferenced HERE rather than in the artifact: the tables store each response and
        // schema once and the capabilities name them, so the file stays a third of the size
        // it would be inlined. Expanding on the way out means the caller never has to
        // resolve a `{"$schema": "…"}` itself, and never sees one.
        capabilities: hits.map(({ product: owner, capability }) => {
          const responses = resolveResponses(
            registry.index.products[owner],
            capability,
            selection,
          );
          // The raw field is dropped, not merely overwritten: it holds `{"$response": …}`
          // references, and spreading the capability would leak them straight through
          // whenever the resolved value is absent.
          const { responses: unresolved, ...rest } = capability;
          void unresolved;
          return {
            ...rest,
            product: owner,
            ...(responses ? { responses } : {}),
          };
        }),
        ...rest,
      });
    },
  );

  tools.invokeEndpoint = server.tool(
    "invokeEndpoint",
    "Call an endpoint returned by searchCapability. Pass `method` and `path` exactly as " +
      "given, with arguments grouped into path_params / query / body under the spec's own " +
      "names. One call makes exactly one request and returns the product's own response " +
      "untouched; when `completed` is false there is another page, which you fetch by " +
      "sending the endpoint's own page parameter. If the endpoint's mode is 'write' you " +
      "MUST ask the user first, then " +
      "resend with user_permission='granted' and a change_summary; both are recorded. " +
      "Endpoints whose mode is 'destructive' (deletes) are refused outright — archiving, " +
      "closing and merging are ordinary writes and DO run, so read the mode and intent " +
      "before confirming with the user.",
    {
      method: z
        .string()
        .describe("HTTP method, exactly as searchCapability returned it."),
      path: z
        .string()
        .describe("Path with {placeholders} intact, exactly as returned."),
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
          `Which product owns the endpoint (${productList}). searchCapability returns it ` +
            "on every result; required only when two products share a path.",
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
    async (input): Promise<CallToolResult> => {
      track("invokeEndpoint");
      try {
        const { product, capability } = registry.byEndpointLookup(
          input.method,
          input.path,
          input.product,
        );
        const args: GroupedArguments = {
          path_params: input.path_params,
          query: input.query,
          body: input.body,
        };

        if (capability.mode === "destructive") {
          // Refused before binding, so consent is never sought for something that cannot run.
          return failed(
            `${input.method} ${input.path} is a destructive operation and is not available ` +
              `through this surface`,
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
        );
        return ok(result);
      } catch (error) {
        if (error instanceof InvocationError) return failed(error.message);
        logger.error(
          "invokeEndpoint failed: %s",
          error instanceof Error ? error.message : String(error),
        );
        return failed("that endpoint could not be invoked");
      }
    },
  );

  return tools;
}

export default addCapabilityRegistryToolsFromConfig;
