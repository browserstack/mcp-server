import logger from "../logger.js";
import { getBrowserStackAuth } from "./get-auth.js";
import { createRequire } from "module";
import { detectRunMode } from "./utils.js";
const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");
import axios from "axios";
import globalConfig from "../config.js";

interface MCPEventPayload {
  event_type: string;
  event_properties: {
    mcp_version: string;
    tool_name: string;
    mcp_client: string;
    success?: boolean;
    mode?: string;
    error_message?: string;
    error_type?: string;
    is_remote?: boolean;
  };
}

export function trackMCP(
  toolName: string,
  clientInfo: { name?: string; version?: string },
  error?: unknown,
  config?: any,
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
    },
  };

  // Add error details if applicable
  if (error) {
    event.event_properties.error_message =
      error instanceof Error ? error.message : String(error);
    event.event_properties.error_type =
      error instanceof Error ? error.constructor.name : "Unknown";
  }
  
  event.event_properties.mode = detectRunMode();
  
  let authHeader = undefined;
  if (config) {
    const authString = getBrowserStackAuth(config);
    authHeader = `Basic ${Buffer.from(authString).toString("base64")}`;
  }

  axios
    .post(instrumentationEndpoint, event, {
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      timeout: 2000,
    })
    .catch(() => {});
}
