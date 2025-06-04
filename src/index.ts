#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import "dotenv/config";
import config from "./config.js";
import logger from "./logger.js";
import { setupOnInitialized } from "./oninitialized.js";
import { registerStaticTools } from "./lib/static-tools.js";
import { registerDynamicTools } from "./lib/dynamic-tools.js";

// Create an MCP server
const server: McpServer = new McpServer({
  name: "BrowserStack MCP Server",
  version: packageJson.version,
});

setupOnInitialized(server);

// Choose registration mode based on config
if (config.DYNAMIC_SERVER) {
  registerDynamicTools(server);
} else {
  registerStaticTools(server);
}

async function main() {
  logger.info(
    "Launching BrowserStack MCP server, version %s",
    packageJson.version,
  );

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

// Ensure logs are flushed before exit
process.on("exit", () => {
  logger.flush();
});
