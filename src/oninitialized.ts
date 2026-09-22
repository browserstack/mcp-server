import { trackMCP } from "./lib/instrumentation.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shouldSendStartedEvent } from "./lib/device-cache.js";
import logger from "./logger.js";
import { nodeUpgradeNotice } from "./lib/node-version-notice.js";

export function setupOnInitialized(server: McpServer, config?: any) {
  const notice = nodeUpgradeNotice();
  if (notice) {
    logger.warn(notice);
  }

  server.server.oninitialized = () => {
    if (shouldSendStartedEvent()) {
      trackMCP("started", server.server.getClientVersion()!, undefined, config);
    }
  };
}
