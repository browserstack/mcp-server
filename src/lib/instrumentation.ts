import { AsyncLocalStorage } from "node:async_hooks";
import logger from "../logger.js";
import { getBrowserStackAuth } from "./get-auth.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");
import { apiClient } from "./apiClient.js";
import globalConfig from "../config.js";

const INSTRUMENTATION_ENDPOINT = "https://api.browserstack.com/sdk/v1/event";

export type ClientInfo = { name?: string; version?: string };

export type ToolOutcome = "ok" | "error_result" | "threw";

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
  };
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

function sendEvent(event: MCPEventPayload, config?: any): void {
  let authHeader: string | undefined;
  if (config) {
    const authString = getBrowserStackAuth(config);
    authHeader = `Basic ${Buffer.from(authString).toString("base64")}`;
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
): void {
  const ctx = callContext.getStore();
  if (ctx) {
    if (clientInfo?.name && !ctx.clientInfo?.name) ctx.clientInfo = clientInfo;
    if (config && !ctx.config) ctx.config = config;
    if (error) ctx.error = error;
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
    },
  };
  sendEvent(event, config);
}

function isErrorResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

/**
 * Runs a tool handler and writes one MCPInstrumentation row when it settles: success,
 * duration_ms, outcome (ok / error_result / threw), error fields on failure.
 */
export async function withToolCall<T>(
  toolName: string,
  getClientInfo: () => ClientInfo,
  config: any,
  fn: () => Promise<T> | T,
): Promise<T> {
  const ctx: CallContext = { toolName, clientInfo: {}, config };
  const startedAt = performance.now();
  let outcome: ToolOutcome = "ok";
  try {
    const result = await callContext.run(ctx, fn);
    if (isErrorResult(result)) outcome = "error_result";
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
      const event: MCPEventPayload = {
        event_type: "MCPInstrumentation",
        event_properties: {
          ...baseProperties(toolName, clientInfo),
          success: ctx.error === undefined && outcome !== "threw",
          duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          outcome,
          ...(ctx.error !== undefined ? errorProperties(ctx.error) : {}),
        },
      };
      sendEvent(event, ctx.config ?? config);
    } catch {
      /* telemetry must never affect the call */
    }
  }
}
