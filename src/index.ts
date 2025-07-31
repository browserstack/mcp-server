#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import "dotenv/config";
import logger from "./logger.js";
import { BrowserStackMcpServer } from "./server-factory.js";

async function main() {
  logger.info(
    "Launching BrowserStack MCP server, version %s",
    packageJson.version,
  );

  const remoteMCP = process.env.REMOTE_MCP === "true";
  if (remoteMCP) {
    logger.info("Running in remote MCP mode");
    return;
  }

  const username = process.env.BROWSERSTACK_USERNAME;
  const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;

  if (!username) {
    throw new Error("BROWSERSTACK_USERNAME environment variable is required");
  }

  if (!accessKey) {
    throw new Error("BROWSERSTACK_ACCESS_KEY environment variable is required");
  }

  const transport = new StdioServerTransport();

  const mcpServer = new BrowserStackMcpServer({
    "browserstack-username": username,
    "browserstack-access-key": accessKey,
  });

  await mcpServer.getInstance().connect(transport);
}

main().catch(console.error);

// Ensure logs are flushed before exit
process.on("exit", () => {
  logger.flush();
});

export { setLogger } from "./logger.js";
export { BrowserStackMcpServer } from "./server-factory.js";
