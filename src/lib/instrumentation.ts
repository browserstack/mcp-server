import { AsyncLocalStorage } from "node:async_hooks";
import logger from "../logger.js";
import { getBrowserStackAuth } from "./get-auth.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");
import { apiClient } from "./apiClient.js";
import globalConfig from "../config.js";
import { redact } from "../tools/capability-registry/redact.js";
import { isKnownProduct } from "../tools/capability-registry/config.js";
import { accountRegion } from "./account-region.js";
import { AxiosError } from "axios";
import { HttpError } from "./error.js";
import { UpstreamScope, withUpstreamScope } from "./upstream-status.js";
import {
  AccountRegion,
  currentRegionScope,
  isRestrictedRegion,
} from "./region-context.js";

const INSTRUMENTATION_ENDPOINT = "https://api.browserstack.com/sdk/v1/event";

export type ClientInfo = { name?: string; version?: string };

export type ToolOutcome = "ok" | "error_result" | "threw";

/**
 * Who a failed call is attributed to. `caller`: the input or account was rejected (bad
 * parameter, 4xx). `upstream`: the product API failed or was unreachable (5xx, 408, no
 * answer). `mcp`: this server failed (threw, programming error, registry fault).
 * `unknown`: a returned error with no evidence either way.
 */
export type FailureClass = "caller" | "upstream" | "mcp" | "unknown";

/**
 * Why a call got its failure_class, where the class alone would hide something the
 * report needs: `blocked` (a caller fault that is entitlement, auth or a rate limit,
 * reported as its own rate), `contract_drift` (the product rejected a request our own
 * validation had accepted: the index or tool disagrees with the API), `region_probe`
 * (the Test Management host probe failed before any product call), `central_auth` and
 * `auth_scope` (a token could not be minted), `empty_error_result` (the tool reported
 * failure with no text).
 */
export type FailureReason =
  | "blocked"
  | "contract_drift"
  | "region_probe"
  | "central_auth"
  | "auth_scope"
  | "empty_error_result";

/**
 * Extra fields a caller may attach to its own row (the capability registry records what
 * it invoked and how the product answered). Values are scalars so every field stays one
 * queryable column.
 *
 * SOME OF IT IS FREE TEXT, and this comment used to claim the opposite. The registry
 * records `search_query` and `change_summary`, both written by the agent from what the
 * user asked for, and both leave the machine on every search and every write. They go
 * through `capability-registry/redact.ts` first, which strips PII it can identify by
 * SHAPE and caps the length — it cannot strip a person's name, and says so. Anything
 * added here that carries user text must go through the same filter.
 */
export type MCPEventExtras = Record<
  string,
  string | number | boolean | undefined
>;

interface MCPEventPayload {
  event_type: string;
  event_properties: {
    mcp_version: string;
    tool_name: string;
    mcp_client: string;
    node_version: string;
    success?: boolean;
    error_message?: string;
    error_type?: string;
    is_remote?: boolean;
    duration_ms?: number;
    outcome?: ToolOutcome;
    failure_class?: FailureClass;
    failure_reason?: FailureReason;
    upstream_status?: number;
    account_region?: AccountRegion;
  } & MCPEventExtras;
}

function baseProperties(toolName: string, clientInfo: ClientInfo) {
  return {
    mcp_version: packageJson.version as string,
    tool_name: toolName,
    mcp_client: clientInfo?.name || "unknown",
    node_version: process.versions.node,
    is_remote: globalConfig.REMOTE_MCP,
  };
}

function errorProperties(error: unknown) {
  return {
    error_message: error instanceof Error ? error.message : String(error),
    error_type: error instanceof Error ? error.constructor.name : "Unknown",
  };
}

const USAGE_FIELDS = new Set([
  "mcp_version",
  "tool_name",
  "mcp_client",
  "node_version",
  "is_remote",
  "success",
  "duration_ms",
  "outcome",
  "error_type",
  "refusal_reason",
  "product",
  "capability",
  "capability_method",
  "capability_path",
  "capability_mode",
  "agent_match",
  "results_returned",
  "total_matched",
  "truncated",
  "weak_match",
  "coverage",
  "upstream_ok",
  "upstream_status",
  "failure_class",
  "failure_reason",
  "account_region",
  "auth_failure_kind",
  "probe_status",
]);

function forDataRegion(
  props: MCPEventPayload["event_properties"],
  account: AccountRegion | undefined,
): MCPEventPayload["event_properties"] {
  if (!isRestrictedRegion(account)) return props;
  return Object.fromEntries(
    Object.entries(props).filter(
      // A product name the agent typed is free text, so only a known product is kept.
      ([key, value]) =>
        USAGE_FIELDS.has(key) && (key !== "product" || isKnownProduct(value)),
    ),
  ) as MCPEventPayload["event_properties"];
}

function sendEvent(event: MCPEventPayload, config?: any): void {
  // Inside a tool call the region is already known; outside one, wait for the lookup.
  const inCall = currentRegionScope();
  const account = inCall ? inCall.account : accountRegion(config);
  if (account instanceof Promise) {
    account.then((region) => post(event, config, region)).catch(() => {});
    return;
  }
  post(event, config, account);
}

function post(
  event: MCPEventPayload,
  config: any,
  account: AccountRegion | undefined,
): void {
  event = {
    ...event,
    event_properties: forDataRegion(event.event_properties, account),
  };
  let authHeader: string | undefined;
  if (config) {
    try {
      const authString = getBrowserStackAuth(config);
      authHeader = `Basic ${Buffer.from(authString).toString("base64")}`;
    } catch {
      // noop
    }
  }

  apiClient
    .post({
      url: INSTRUMENTATION_ENDPOINT,
      body: event,
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      timeout: 2000,
      raise_error: false,
    })
    .catch(() => {});
}

/** Per-call state; AsyncLocalStorage keeps concurrent (multi-tenant) calls apart. */
interface CallContext {
  toolName: string;
  clientInfo: ClientInfo;
  config?: any;
  error?: unknown;
  extras?: MCPEventExtras;
}

const callContext = new AsyncLocalStorage<CallContext>();

/**
 * Inside `withToolCall` this only records into the call's context; the single row is
 * written when the handler settles. Outside one (`started` heartbeat, unwrapped host
 * tools) it posts a row immediately, as before.
 */
export function trackMCP(
  toolName: string,
  clientInfo: ClientInfo,
  error?: unknown,
  config?: any,
  extras?: MCPEventExtras,
): void {
  const ctx = callContext.getStore();
  if (ctx) {
    if (clientInfo?.name && !ctx.clientInfo?.name) ctx.clientInfo = clientInfo;
    if (config && !ctx.config) ctx.config = config;
    if (error) ctx.error = error;
    // Later calls win, so a handler can record an identity first and the outcome after.
    if (extras) ctx.extras = { ...ctx.extras, ...extras };
    return;
  }

  if (clientInfo?.name) {
    logger.info(
      `Client connected: ${clientInfo.name} (version: ${clientInfo.version})`,
    );
  } else {
    logger.info("Client connected: unknown client");
  }

  const event: MCPEventPayload = {
    event_type: "MCPInstrumentation",
    event_properties: {
      ...baseProperties(toolName, clientInfo),
      success: !error,
      ...(error ? errorProperties(error) : {}),
      // Undefined entries are dropped by JSON.stringify, so an absent extra is an
      // absent column rather than a null one.
      ...(extras ?? {}),
    },
  };
  sendEvent(event, config);
}

/** The text a tool showed the user. */
function errorTextOf(result: unknown): string | undefined {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) =>
      typeof (part as { text?: unknown })?.text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join(" ");
  return redact(text);
}

function isErrorResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

/** The HTTP status an error carries; 0 when the request got no answer. */
function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpError) return error.status;
  if (error instanceof AxiosError) {
    if (error.response) return error.response.status;
    return error.request ? 0 : undefined;
  }
  // What Node's fetch rejects with when the request never got an answer.
  if (error instanceof TypeError && error.message === "fetch failed") return 0;
  return undefined;
}

// Registry refusals that are this server's fault; every other refusal is the caller's.
const MCP_REFUSALS = new Set(["unexpected_error", "no_base_url"]);

const PROGRAMMING_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError];

/** 4xx that mean the account may not do this: entitlement, auth, rate limit. */
const BLOCKED_STATUSES = new Set([401, 402, 403, 429]);

/**
 * 4xx that mean the product did not accept the shape of the request. Our own validation
 * had passed it, so the index or tool disagrees with the API: contract drift, ours to fix.
 * A 404 is deliberately not here: it is almost always an id that names nothing.
 */
const DRIFT_STATUSES = new Set([400, 405, 410, 415, 422]);

interface Attribution {
  failure_class: FailureClass;
  failure_reason?: FailureReason;
}

/** How a product's own answer is attributed, on either path. */
function byStatus(status: number): Attribution | undefined {
  if (status === 0 || status === 408 || status >= 500)
    return { failure_class: "upstream" };
  if (BLOCKED_STATUSES.has(status))
    return { failure_class: "caller", failure_reason: "blocked" };
  if (DRIFT_STATUSES.has(status))
    return { failure_class: "mcp", failure_reason: "contract_drift" };
  if (status >= 400) return { failure_class: "caller" };
  return undefined;
}

/**
 * The Test Management region probe: attributed by what the US host answered, not by the
 * last host tried (the other regions always answer 401 to an account that is not theirs).
 * A 402 is an account without the product; everything else — a timeout, a 429, a 5xx —
 * is the probe itself, which runs before every call and is this server's design.
 */
function byProbe(usStatus: number): Attribution {
  return usStatus === 402
    ? { failure_class: "caller", failure_reason: "blocked" }
    : { failure_class: "mcp", failure_reason: "region_probe" };
}

/** A token could not be minted: whose problem depends on why. */
function byTokenMint(kind: unknown): Attribution {
  switch (kind) {
    case "no_credentials":
    case "refused_credentials":
      return { failure_class: "caller", failure_reason: "blocked" };
    case "refused_scope":
      return { failure_class: "mcp", failure_reason: "auth_scope" };
    default:
      return { failure_class: "upstream", failure_reason: "central_auth" };
  }
}

/**
 * Attributes a failed call. Evidence is read in order: the registry's refusal reason,
 * the region probe, an upstream outage, a programming error, a rejection of the caller's
 * input (`CallerError`, `markCallerFault`), the product's 4xx, then whether the handler
 * threw. A handler that knows better passes `failure_class` in its trackMCP extras,
 * which wins because extras are spread last onto the row.
 *
 * A completed capability invoke returns the product's 4xx/5xx as a normal result with
 * `upstream_ok: false`; that row is attributed by its status like any other, so one
 * field answers "did this call fail" on both paths.
 */
function failureClassOf(
  outcome: ToolOutcome,
  error: unknown,
  status: number | undefined,
  scope: UpstreamScope,
  hasErrorText: boolean,
  extras: MCPEventExtras | undefined,
): Attribution | undefined {
  if (outcome === "ok" && error === undefined) {
    return extras?.upstream_ok === false && status !== undefined
      ? byStatus(status)
      : undefined;
  }
  const reason = extras?.refusal_reason;
  if (typeof reason === "string") {
    if (MCP_REFUSALS.has(reason)) return { failure_class: "mcp" };
    if (reason === "region_probe_failed")
      return byProbe(
        typeof extras?.probe_status === "number" ? extras.probe_status : 0,
      );
    if (reason === "token_mint_failed")
      return byTokenMint(extras?.auth_failure_kind);
    return { failure_class: "caller" };
  }
  if (scope.probeStatus !== undefined) return byProbe(scope.probeStatus);
  if (status !== undefined && (status === 0 || status === 408 || status >= 500))
    return { failure_class: "upstream" };
  if (PROGRAMMING_ERRORS.some((kind) => error instanceof kind))
    return { failure_class: "mcp" };
  if (scope.callerFault === true)
    return status !== undefined && BLOCKED_STATUSES.has(status)
      ? { failure_class: "caller", failure_reason: "blocked" }
      : { failure_class: "caller" };
  if (status !== undefined && status >= 400) return byStatus(status);
  if (outcome === "threw") return { failure_class: "mcp" };
  // A returned failure that says nothing is this server's defect: the tool knew it failed
  // and gave the agent, and us, no reason.
  if (outcome === "error_result" && !hasErrorText)
    return { failure_class: "mcp", failure_reason: "empty_error_result" };
  return { failure_class: "unknown" };
}

/**
 * Runs a tool handler and writes one MCPInstrumentation row when it settles: success,
 * duration_ms, outcome (ok / error_result / threw), error fields on failure, the last
 * upstream_status seen, and on a failure the failure_class it is attributed to.
 */
export async function withToolCall<T>(
  toolName: string,
  getClientInfo: () => ClientInfo,
  config: any,
  fn: () => Promise<T> | T,
): Promise<T> {
  const ctx: CallContext = { toolName, clientInfo: {}, config };
  const upstream: UpstreamScope = {};
  const startedAt = performance.now();
  let outcome: ToolOutcome = "ok";
  let errorText: string | undefined;
  try {
    const result = await withUpstreamScope(upstream, () =>
      callContext.run(ctx, fn),
    );
    if (isErrorResult(result)) {
      outcome = "error_result";
      // A returned failure never sets ctx.error, so the reason is read off the result.
      errorText ??= errorTextOf(result);
    }
    return result;
  } catch (error) {
    outcome = "threw";
    ctx.error ??= error;
    throw error;
  } finally {
    try {
      let clientInfo = ctx.clientInfo;
      try {
        const live = getClientInfo();
        if (live?.name) clientInfo = live;
      } catch {
        /* client info is optional */
      }
      // The error the handler reported is the cause; the last status seen is the fallback.
      const upstreamStatus =
        typeof ctx.extras?.upstream_status === "number"
          ? ctx.extras.upstream_status
          : (statusOf(ctx.error) ?? upstream.status);
      const attribution = failureClassOf(
        outcome,
        ctx.error,
        upstreamStatus,
        upstream,
        Boolean(errorText) || ctx.error !== undefined,
        ctx.extras,
      );
      // Known inside a call once the lookup has answered; an enum, so it survives the
      // restricted-region filter. Lets a failure be sliced by GRR region without a join.
      const accountRegionNow = currentRegionScope()?.account;
      const event: MCPEventPayload = {
        event_type: "MCPInstrumentation",
        event_properties: {
          ...baseProperties(toolName, clientInfo),
          success: ctx.error === undefined && outcome !== "threw",
          duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          outcome,
          ...(upstreamStatus !== undefined
            ? { upstream_status: upstreamStatus }
            : {}),
          ...(attribution ?? {}),
          ...(accountRegionNow !== undefined
            ? { account_region: accountRegionNow }
            : {}),
          ...(ctx.error !== undefined ? errorProperties(ctx.error) : {}),
          ...(outcome === "error_result" && ctx.error === undefined && errorText
            ? { error_message: errorText }
            : {}),
          ...(ctx.extras ?? {}),
        },
      };
      sendEvent(event, ctx.config ?? config);
    } catch {
      /* telemetry must never affect the call */
    }
  }
}
