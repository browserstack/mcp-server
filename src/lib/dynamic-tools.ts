/**
 * Dynamic Tools Registration
 * Sets up the product manager and dynamic tool registration system
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import logger from "../logger.js";
import { ProductManager, BrowserStackProduct } from "./product-manager.js";
import { addDynamicTools } from "../tools/dynamic.js";
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
 * Set up the product manager with all available products
 */
function setupDynamicProductManager(server: McpServer): ProductManager {
  const productManager = new ProductManager(server);

  logger.info("Registering product tool registration functions...");

  // Register all product tool registration functions
  productManager.registerProduct(BrowserStackProduct.SDK, addSDKTools);
  productManager.registerProduct(BrowserStackProduct.APP_LIVE, addAppLiveTools);
  productManager.registerProduct(
    BrowserStackProduct.BROWSER_LIVE,
    addBrowserLiveTools,
  );
  productManager.registerProduct(
    BrowserStackProduct.ACCESSIBILITY,
    addAccessibilityTools,
  );
  productManager.registerProduct(
    BrowserStackProduct.TEST_MANAGEMENT,
    addTestManagementTools,
  );
  productManager.registerProduct(
    BrowserStackProduct.APP_AUTOMATION,
    addAppAutomationTools,
  );
  productManager.registerProduct(
    BrowserStackProduct.FAILURE_LOGS,
    addFailureLogsTools,
  );
  productManager.registerProduct(
    BrowserStackProduct.AUTOMATE,
    addAutomateTools,
  );
  productManager.registerProduct(
    BrowserStackProduct.SELF_HEAL,
    addSelfHealTools,
  );

  logger.info("Product registration functions setup completed.");
  return productManager;
}

/**
 * Register dynamic tools and product management system
 * Only enable_products and get_product_status tools will be available initially
 */
export function registerDynamicTools(server: McpServer): void {
  logger.info("Starting dynamic tools registration...");

  // Set up the product manager
  const productManager = setupDynamicProductManager(server);

  // Add the dynamic tools (enable_products and get_product_status)
  addDynamicTools(server, productManager);

  logger.info(
    "Dynamic product management initialized. Use 'enable_products' tool to activate specific BrowserStack capabilities.",
  );
}
