import {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import logger from "./logger.js";
import addSDKTools from "./tools/bstack-sdk.js";
import addPercyTools from "./tools/percy-sdk.js";
import addBrowserLiveTools from "./tools/live.js";
import addAccessibilityTools from "./tools/accessibility.js";
import addTestManagementTools from "./tools/testmanagement.js";
import addAppAutomationTools from "./tools/appautomate.js";
import addFailureLogsTools from "./tools/get-failure-logs.js";
import addAutomateTools from "./tools/automate.js";
import addSelfHealTools from "./tools/selfheal.js";
import addAppLiveTools from "./tools/applive.js";
import { setupOnInitialized } from "./oninitialized.js";
import { BrowserStackConfig } from "./lib/types.js";

/**
 * Wrapper class for BrowserStack MCP Server
 * Stores a map of registered tools by name
 */
export class BrowserStackMcpServer {
  public server: McpServer;
  public tools: Record<string, RegisteredTool> = {};

  constructor(private config: BrowserStackConfig) {
    logger.info(
      "Creating BrowserStack MCP Server, version %s",
      packageJson.version,
    );

    this.server = new McpServer({
      name: "BrowserStack MCP Server",
      version: packageJson.version,
    });

    setupOnInitialized(this.server, this.config);
    this.registerTools();
  }

  /**
   * Calls each tool-adder function and collects their returned tools
   */
  private registerTools() {
    const toolAdders = [
      addAccessibilityTools,
      addSDKTools,
      addPercyTools,
      addAppLiveTools,
      addBrowserLiveTools,
      addTestManagementTools,
      addAppAutomationTools,
      addFailureLogsTools,
      addAutomateTools,
      addSelfHealTools,
    ];

    toolAdders.forEach((adder) => {
      // Each adder now returns a Record<string, Tool>
      const added: Record<string, RegisteredTool> = adder(
        this.server,
        this.config,
      );
      Object.assign(this.tools, added);
    });
  }

  /**
   * Expose the underlying MCP server instance
   */
  public getInstance(): McpServer {
    return this.server;
  }

  /**
   * Get all registered tools
   */
  public getTools(): Record<string, RegisteredTool> {
    return this.tools;
  }

  public getTool(name: string): RegisteredTool | undefined {
    return this.tools[name];
  }
}
