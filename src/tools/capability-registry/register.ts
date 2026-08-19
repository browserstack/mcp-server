/**
 * The tool surface: four discovery tools plus ONE invoke tool.
 *
 * ONE invoke tool means one set of MCP annotations, so they describe the whole surface
 * honestly: it can write (not read-only) and it can never delete, because destructive
 * endpoints are refused before binding. Write consent therefore rests on `user_permission`
 * enforced HERE rather than on a client-side hint — which is the one thing a separate
 * read/write tool pair was buying.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { GroupedArguments } from "./bind.js";
import { Credentials, Transport, fetchTransport } from "./egress.js";
import { CapabilityRegistry, InvocationError } from "./index-loader.js";
import { invoke } from "./resolve.js";
import { searchCapabilities } from "./search.js";
import { Mode } from "./types.js";

export const PERMISSION_VALUES = ["not_asked", "granted", "denied"] as const;

export interface RegistryDeps {
  registry: CapabilityRegistry;
  /** Per-product base URL. Never baked into the artifact — it is environment-specific. */
  baseUrlFor: (product: string) => string;
  credentialsFor: () => Credentials;
  transport?: Transport;
}

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function failed(message: string): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }], isError: true };
}

export function addCapabilityRegistryTools(server: McpServer, deps: RegistryDeps): void {
  const { registry } = deps;
  const transport = deps.transport || fetchTransport();

  server.tool(
    "listProducts",
    "List the BrowserStack products this surface can reach, with a one-line summary each. " +
      "Start here when you do not know which product a task belongs to.",
    {},
    async () => ok({
      build_id: registry.buildId,
      products: registry.productNames().map((name) => ({
        name, summary: registry.index.products[name].summary,
      })),
    }),
  );

  server.tool(
    "listEntities",
    "List the entities a product models (test case, folder, test plan, …). Use it to scope " +
      "searchCapability, or to find the entity name describeEntity wants.",
    { product: z.string().describe("Product name from listProducts.") },
    async ({ product }) => {
      const bundle = registry.index.products[product];
      if (!bundle) return failed(`unknown product '${product}'`);
      return ok({ product, entities: Object.keys(bundle.entities).sort() });
    },
  );

  server.tool(
    "describeEntity",
    "Describe one entity: what it is, what identifies it, what it relates to, and the " +
      "vocabulary the product uses for it. Read this before filtering or writing, because " +
      "ids and field values usually have to be resolved first.",
    {
      product: z.string().describe("Product name from listProducts."),
      entity: z.string().describe("Entity name from listEntities."),
    },
    async ({ product, entity }) => {
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

  server.tool(
    "searchCapability",
    "Find endpoints this surface can call, by plain language, optionally narrowed to one " +
      "entity, product or mode. Each result carries the endpoint's `method` and `path` plus " +
      "its parameters grouped into path_params / query / body under the spec's own names — " +
      "pass them straight back to invokeEndpoint, no renaming. `guidance` is how to call it " +
      "correctly; `mode` tells you whether it writes. Results are ranked and capped, and " +
      "`truncated` says when more matched. Search before invoking.",
    {
      query: z.string().describe("What you are trying to do, in plain language."),
      entity: z.string().optional().describe("Restrict to one entity (see listEntities)."),
      product: z.string().optional().describe("Restrict to one product."),
      mode: z.enum(["read", "write", "destructive"]).optional()
        .describe("Restrict to reads or writes. Omit to let the query decide."),
      limit: z.number().optional().describe("Max results (default 8)."),
    },
    async ({ query, entity, product, mode, limit }) => ok({
      build_id: registry.buildId,
      ...searchCapabilities(registry.index.products, query, {
        entity, product, mode: mode as Mode | undefined, limit,
      }),
    }),
  );

  server.tool(
    "invokeEndpoint",
    "Call an endpoint returned by searchCapability. Pass `method` and `path` exactly as " +
      "given, with arguments grouped into path_params / query / body under the spec's own " +
      "names. Paging is handled for you — a read is complete unless `complete` is false; use " +
      "order_by (prefix '-' to reverse) and top_n to sort and trim rather than fetching " +
      "everything. If the endpoint's mode is 'write' you MUST ask the user first, then " +
      "resend with user_permission='granted' and a change_summary; both are recorded. " +
      "Endpoints whose mode is 'destructive' (deletes) are refused outright — archiving, " +
      "closing and merging are ordinary writes and DO run, so read the mode and intent " +
      "before confirming with the user.",
    {
      method: z.string().describe("HTTP method, exactly as searchCapability returned it."),
      path: z.string().describe("Path with {placeholders} intact, exactly as returned."),
      path_params: z.record(z.string(), z.any()).optional().describe("Values for the {placeholders}."),
      query: z.record(z.string(), z.any()).optional().describe("Query parameters."),
      body: z.record(z.string(), z.any()).optional().describe("Body fields, under the spec's names."),
      product: z.string().optional().describe("Required only if two products share the endpoint."),
      user_permission: z.enum(PERMISSION_VALUES).optional()
        .describe("Set to 'granted' only after the user has confirmed a write."),
      change_summary: z.string().optional().describe("What will change. Required for writes."),
      order_by: z.string().optional().describe("A returns field; prefix '-' to reverse."),
      top_n: z.number().optional().describe("Keep only the first N rows after ordering."),
    },
    async (input): Promise<CallToolResult> => {
      try {
        const { product, capability } = registry.byEndpointLookup(
          input.method, input.path, input.product,
        );
        const args: GroupedArguments = {
          path_params: input.path_params, query: input.query, body: input.body,
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
          capability, args, deps.baseUrlFor(product), deps.credentialsFor(), transport,
          { orderBy: input.order_by, topN: input.top_n },
        );
        return ok(result);
      } catch (error) {
        if (error instanceof InvocationError) return failed(error.message);
        throw error;
      }
    },
  );
}

export default addCapabilityRegistryTools;
