import { trackMCP } from "./lib/instrumentation.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shouldSendStartedEvent } from "./lib/device-cache.js";

export function setupOnInitialized(server: McpServer, config?: any) {
  const nodeVersion = process.versions.node;

  // Check for Node.js version
  if (nodeVersion < "18.0.0") {
    throw new Error(
      "Node version is not supported. Please upgrade to 18.0.0 or later.",
    );
  }

  server.server.oninitialized = () => {
    if (shouldSendStartedEvent()) {
      trackMCP("started", server.server.getClientVersion()!, undefined, config);
    }
  };
}
