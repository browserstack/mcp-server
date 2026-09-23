import logger from "../logger.js";
import { getBrowserStackAuth } from "./get-auth.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");
import { apiClient } from "./apiClient.js";
import globalConfig from "../config.js";

/**
 * Extra fields a caller may attach to its own row (the capability registry records what
 * it invoked and how the product answered). Values are scalars so every field stays one
 * queryable column; nothing here is free text written by a user.
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
    success?: boolean;
    error_message?: string;
    error_type?: string;
    is_remote?: boolean;
  } & MCPEventExtras;
}

export function trackMCP(
  toolName: string,
  clientInfo: { name?: string; version?: string },
  error?: unknown,
  config?: any,
  extras?: MCPEventExtras,
): void {
  const instrumentationEndpoint = "https://api.browserstack.com/sdk/v1/event";
  const isSuccess = !error;
  const mcpClient = clientInfo?.name || "unknown";

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
      mcp_version: packageJson.version,
      tool_name: toolName,
      mcp_client: mcpClient,
      success: isSuccess,
      is_remote: globalConfig.REMOTE_MCP,
      // Undefined entries are dropped by JSON.stringify, so an absent extra is an
      // absent column rather than a null one.
      ...(extras ?? {}),
    },
  };

  // Add error details if applicable
  if (error) {
    event.event_properties.error_message =
      error instanceof Error ? error.message : String(error);
    event.event_properties.error_type =
      error instanceof Error ? error.constructor.name : "Unknown";
  }

  let authHeader = undefined;
  if (config) {
    const authString = getBrowserStackAuth(config);
    authHeader = `Basic ${Buffer.from(authString).toString("base64")}`;
  }

  apiClient
    .post({
      url: instrumentationEndpoint,
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
