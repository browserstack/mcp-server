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

export type ErrorClass =
  | "auth_error"
  | "not_found"
  | "rate_limited"
  | "validation"
  | "timeout"
  | "network"
  | "server_error"
  | "unknown";

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
    error_class?: ErrorClass;
    is_remote?: boolean;
    phase?: "completed";
    duration_ms?: number;
    outcome?: ToolOutcome;
  };
}

const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT"]);
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

function httpStatusOf(error: unknown): number | undefined {
  const e = error as { response?: { status?: unknown }; status?: unknown };
  const direct = e?.response?.status ?? e?.status;
  if (typeof direct === "number") return direct;
  // Plain Errors from utils carry the status only in the message:
  //   "Request failed with status code 404", "Failed to fetch from …: 404 Not Found"
  const message = error instanceof Error ? error.message : String(error ?? "");
  const m = message.match(
    /status code (\d{3})|: (\d{3}) [A-Z]|\bHTTP (\d{3})\b/,
  );
  const found = m && (m[1] || m[2] || m[3]);
  return found ? Number(found) : undefined;
}

/** Bucket a thrown error into a fixed set of causes, so failures group by class. */
export function classifyError(error: unknown): ErrorClass {
  const e = error as { code?: unknown; name?: unknown; issues?: unknown };
  if (typeof e?.code === "string") {
    if (TIMEOUT_CODES.has(e.code)) return "timeout";
    if (NETWORK_CODES.has(e.code)) return "network";
  }
  if (e?.name === "ZodError" || Array.isArray(e?.issues)) return "validation";

  const status = httpStatusOf(error);
  if (status === 401 || status === 403) return "auth_error";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 422) return "validation";
  if (status !== undefined && status >= 500) return "server_error";

  const message = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();
  if (/timed? ?out/.test(message)) return "timeout";
  if (/not enabled for|unauthori[sz]ed|forbidden/.test(message))
    return "auth_error";
  return "unknown";
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

/** Per-invocation row: fired at tool entry (success) and from the catch block (failure). */
export function trackMCP(
  toolName: string,
  clientInfo: ClientInfo,
  error?: unknown,
  config?: any,
): void {
  const isSuccess = !error;

  // Log client information
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
      success: isSuccess,
    },
  };

  // Add error details if applicable
  if (error) {
    event.event_properties.error_message =
      error instanceof Error ? error.message : String(error);
    event.event_properties.error_type =
      error instanceof Error ? error.constructor.name : "Unknown";
    event.event_properties.error_class = classifyError(error);
  }

  sendEvent(event, config);
}

/**
 * Per-completion row, written after the handler settles, with duration and
 * outcome. Same event_type as the entry row because the Rails endpoint
 * allowlists event types; `phase: "completed"` and the absence of `success`
 * keep it out of existing success/failure counts.
 */
export function trackMCPCompleted(
  toolName: string,
  clientInfo: ClientInfo,
  completion: { durationMs: number; outcome: ToolOutcome },
  config?: any,
): void {
  const event: MCPEventPayload = {
    event_type: "MCPInstrumentation",
    event_properties: {
      ...baseProperties(toolName, clientInfo),
      phase: "completed",
      duration_ms: Math.max(0, Math.round(completion.durationMs)),
      outcome: completion.outcome,
    },
  };
  sendEvent(event, config);
}
