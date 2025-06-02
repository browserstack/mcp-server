#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import "dotenv/config";
import logger from "./logger.js";
import addSDKTools from "./tools/bstack-sdk.js";
import addAppLiveTools from "./tools/applive.js";
import addBrowserLiveTools from "./tools/live.js";
import addAccessibilityTools from "./tools/accessibility.js";
import addTestManagementTools from "./tools/testmanagement.js";
import addAppAutomationTools from "./tools/appautomate.js";
import addFailureLogsTools from "./tools/getFailureLogs.js";
import addAutomateTools from "./tools/automate.js";
import addSelfHealTools from "./tools/selfheal.js";
import addObservabilityTools from "./tools/observability.js";
import { setupOnInitialized } from "./oninitialized.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Product categories and their associated tool registration functions
const PRODUCT_TOOLS = {
  automate: [addAutomateTools, addFailureLogsTools, addObservabilityTools],
  "app-automate": [addAppAutomationTools, addFailureLogsTools],
  live: [addBrowserLiveTools],
  "app-live": [addAppLiveTools],
  accessibility: [addAccessibilityTools],
  "test-management": [addTestManagementTools],
  sdk: [addSDKTools],
  "self-heal": [addSelfHealTools],
} as const;

type ProductName = keyof typeof PRODUCT_TOOLS;

// Track enabled products and registered tools
const enabledProducts: Set<ProductName> = new Set();

// Reference to the server instance for use in enableProductsTool
let serverInstance: McpServer;

async function enableProductsTool(args: {
  products: ProductName[];
}): Promise<CallToolResult> {
  const { products } = args;

  // Validate products
  const validProducts = Object.keys(PRODUCT_TOOLS) as ProductName[];
  const invalidProducts = products.filter((p) => !validProducts.includes(p));

  if (invalidProducts.length > 0) {
    return {
      content: [
        {
          type: "text",
          text: `Invalid products: ${invalidProducts.join(", ")}. Valid products are: ${validProducts.join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  // Track newly enabled products
  const newProducts = products.filter((p) => !enabledProducts.has(p));

  if (newProducts.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `All specified products are already enabled. Currently enabled: ${Array.from(enabledProducts).join(", ")}`,
        },
      ],
    };
  }

  // Register tools for new products
  for (const product of newProducts) {
    const toolRegisters = PRODUCT_TOOLS[product];
    for (const registerFn of toolRegisters) {
      registerFn(serverInstance);
    }
    enabledProducts.add(product);
  }

  return {
    content: [
      {
        type: "text",
        text: `Successfully enabled products: ${newProducts.join(", ")}. Total enabled products: ${Array.from(enabledProducts).join(", ")}`,
      },
    ],
  };
}

function registerInitialTools(server: McpServer) {
  // Store server reference for later use
  serverInstance = server;

  // Only register the enableProducts tool initially
  server.tool(
    "enableProducts",
    "Enable tools for specific BrowserStack products. This must be called before using any other tools.",
    {
      products: z
        .array(
          z.enum([
            "automate",
            "app-automate",
            "live",
            "app-live",
            "accessibility",
            "test-management",
            "sdk",
            "self-heal",
          ]),
        )
        .describe("List of BrowserStack products to enable tools for"),
    },
    enableProductsTool,
  );
}

// Create an MCP server
const server: McpServer = new McpServer({
  name: "BrowserStack MCP Server",
  version: packageJson.version,
});

setupOnInitialized(server);

registerInitialTools(server);

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
