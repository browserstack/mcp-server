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
  };
}

export function trackMCPEvent(
  toolName: string,
  clientInfo: { name?: string; version?: string },
): void {
  const instrumentationEndpoint = "https://api.browserstack.com/sdk/v1/event";

  const mcpClient = clientInfo?.name || "unknown";
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
    },
  };

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
    .then((response) => {
      logger.info("MCP event tracked successfully", {
        toolName,
        response,
      });
    })
    .catch((error: unknown) => {
      logger.warn(
        `Failed to track MCP event: ${error instanceof Error ? error.message : String(error)}`,
        {
          toolName,
        },
      );
    });
}
