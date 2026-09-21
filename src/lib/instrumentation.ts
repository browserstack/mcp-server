import logger from "../logger.js";
import { getBrowserStackAuth } from "./get-auth.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");
import { apiClient } from "./apiClient.js";
import globalConfig from "../config.js";

const INSTRUMENTATION_ENDPOINT = "https://api.browserstack.com/sdk/v1/event";

export type ClientInfo = { name?: string; version?: string };

/** How a tool call ended, as seen by the completion wrapper. */
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

/** Fire-and-forget POST. Never throws, never delays the caller. */
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

/**
 * The per-invocation event. Fired at tool entry with `success: true` (meaning
 * "invoked"), and again from the catch block with `success: false` when the
 * handler throws. A failing call therefore produces two rows.
 */
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
  }

  sendEvent(event, config);
}

/**
 * The per-completion event: one row per tool call, written AFTER the handler
 * settles, carrying wall-clock duration and how it ended.
 *
 * Deliberately a separate `event_type` from `MCPInstrumentation`, so every
 * existing query and dashboard keyed on that name keeps its row counts.
 *
 *   outcome = "ok"           handler returned a result without `isError`
 *   outcome = "error_result" handler returned `{ isError: true }` (a failure the
 *                            entry/catch rows never see today)
 *   outcome = "threw"        handler threw; the catch row also exists
 *
 * A call with an entry row and no completion row was killed before it finished
 * (client closed the IDE, process exit), which is the closest thing to a
 * timeout signal this event can give.
 */
export function trackMCPCompleted(
  toolName: string,
  clientInfo: ClientInfo,
  completion: { durationMs: number; outcome: ToolOutcome },
  config?: any,
): void {
  const event: MCPEventPayload = {
    event_type: "MCPToolCompleted",
    event_properties: {
      ...baseProperties(toolName, clientInfo),
      duration_ms: Math.max(0, Math.round(completion.durationMs)),
      outcome: completion.outcome,
    },
  };
  sendEvent(event, config);
}
