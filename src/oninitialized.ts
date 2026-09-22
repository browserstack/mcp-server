import { trackMCP } from "./lib/instrumentation.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shouldSendStartedEvent } from "./lib/device-cache.js";
import logger from "./logger.js";

export function setupOnInitialized(server: McpServer, config?: any) {
  // Numeric Node.js version check (string compare mishandles e.g. "9" vs "18").
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const isBelow20_9 = major < 20 || (major === 20 && minor < 9);

  // Advisory nudge only — the server still runs on older Node (image
  // compression degrades gracefully), and a future release will require
  // Node >= 22. We don't throw so existing users are never hard-broken.
  if (isBelow20_9) {
    logger.warn(
      `Node ${process.versions.node} detected. Image compression is disabled on ` +
        `Node < 20.9, and an upcoming release will require Node >= 22. ` +
        `Please upgrade (Node 22 LTS recommended).`,
    );
  }

  server.server.oninitialized = () => {
    if (shouldSendStartedEvent()) {
      trackMCP("started", server.server.getClientVersion()!, undefined, config);
    }
  };
}
