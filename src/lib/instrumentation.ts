import logger from "../logger";
import config from "../config";
import packageJson from "../../package.json";
import axios from "axios";

interface MCPEventPayload {
  event_type: string;
  event_properties: {
    mcp_version: string;
    tool_name: string;
    mcp_client: string;
    success?: boolean;
    error_message?: string;
    error_type?: string;
  };
}

export function trackMCP(
  toolName: string,
  clientInfo: { name?: string; version?: string },
  error?: unknown,
): void {
  
  if (config.DEV_MODE) {
    logger.info("Tracking MCP is disabled in dev mode");
    return;
  }

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
    },
  };

  // Add error details if applicable
  if (error) {
    event.event_properties.error_message =
      error instanceof Error ? error.message : String(error);
    event.event_properties.error_type =
      error instanceof Error ? error.constructor.name : "Unknown";
  }

  axios
    .post(instrumentationEndpoint, event, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(
          `${config.browserstackUsername}:${config.browserstackAccessKey}`,
        ).toString("base64")}`,
      },
      timeout: 2000,
    })
    .catch(() => {});
}
