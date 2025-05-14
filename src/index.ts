#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../package.json" with { type: "json" };
import "dotenv/config";
import logger from "./logger.js";
import addSDKTools from "./tools/bstack-sdk.js";
import addAppLiveTools from "./tools/applive.js";
import addObservabilityTools from "./tools/observability.js";
import addBrowserLiveTools from "./tools/live.js";
import addAccessibilityTools from "./tools/accessibility.js";
import addTestManagementTools from "./tools/testmanagement.js";
import addAppAutomationTools from "./tools/appautomate.js";
import addFailureLogsTools from "./tools/getFailureLogs.js";
import { trackMCP } from "./lib/instrumentation.js";

function registerTools(server: McpServer) {
  addSDKTools(server);
  addAppLiveTools(server);
  addBrowserLiveTools(server);
  addObservabilityTools(server);
  addAccessibilityTools(server);
  addTestManagementTools(server);
  addAppAutomationTools(server);
  addFailureLogsTools(server);
}

// Create an MCP server
const server: McpServer = new McpServer({
  name: "BrowserStack MCP Server",
  version: packageJson.version,
});

registerTools(server);

async function main() {
  logger.info(
    "Launching BrowserStack MCP server, version %s",
    packageJson.version,
  );

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP server started successfully");
  trackMCP("started", server.server.getClientVersion()!);
}

main().catch(console.error);

// Ensure logs are flushed before exit
process.on("exit", () => {
  logger.flush();
});
