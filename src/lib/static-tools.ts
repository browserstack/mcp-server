/**
 * Static Tools Registration
 * Registers all BrowserStack tools immediately when the server starts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import logger from "../logger.js";
import addSDKTools from "../tools/bstack-sdk.js";
import addAppLiveTools from "../tools/applive.js";
import addBrowserLiveTools from "../tools/live.js";
import addAccessibilityTools from "../tools/accessibility.js";
import addTestManagementTools from "../tools/testmanagement.js";
import addAppAutomationTools from "../tools/appautomate.js";
import addFailureLogsTools from "../tools/getFailureLogs.js";
import addAutomateTools from "../tools/automate.js";
import addSelfHealTools from "../tools/selfheal.js";

/**
 * Register all BrowserStack tools statically
 * All tools will be available immediately when the server starts
 */
export function registerStaticTools(server: McpServer): void {
  logger.info("Starting static tool registration...");

  // Register all tools
  addSDKTools(server);
  addAppLiveTools(server);
  addBrowserLiveTools(server);
  addAccessibilityTools(server);
  addTestManagementTools(server);
  addAppAutomationTools(server);
  addFailureLogsTools(server);
  addAutomateTools(server);
  addSelfHealTools(server);

  logger.info(
    "Static tool registration completed. All BrowserStack tools are available.",
  );
}
