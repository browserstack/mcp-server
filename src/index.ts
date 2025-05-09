#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../package.json";
import "dotenv/config";
import logger from "./logger";
import addSDKTools from "./tools/bstack-sdk";
import addAppLiveTools from "./tools/applive";
import addObservabilityTools from "./tools/observability";
import addBrowserLiveTools from "./tools/live";
import addAccessibilityTools from "./tools/accessibility";
import addAutomateTools from "./tools/automate";
import addTestManagementTools from "./tools/testmanagement";
import { trackMCP } from "./lib/instrumentation";

function registerTools(server: McpServer) {
  addSDKTools(server);
  addAppLiveTools(server);
  addBrowserLiveTools(server);
  addObservabilityTools(server);
  addAccessibilityTools(server);
  addAutomateTools(server);
  addTestManagementTools(server);
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
