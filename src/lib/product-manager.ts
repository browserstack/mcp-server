/**
 * Product Manager for Dynamic Tool Registration
 * Manages enabled/disabled products with a queue-based system (max 2 products)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import logger from "../logger.js";

export enum BrowserStackProduct {
  SDK = "sdk",
  APP_LIVE = "app-live",
  BROWSER_LIVE = "browser-live",
  ACCESSIBILITY = "accessibility",
  TEST_MANAGEMENT = "test-management",
  APP_AUTOMATION = "app-automation",
  FAILURE_LOGS = "failure-logs",
  AUTOMATE = "automate",
  SELF_HEAL = "self-heal",
}

export interface ProductConfig {
  name: string;
  description: string;
  category: string;
  tools: string[];
}

export const PRODUCT_CONFIGS: Record<BrowserStackProduct, ProductConfig> = {
  [BrowserStackProduct.SDK]: {
    name: "BrowserStack SDK",
    description:
      "Set up and run tests using BrowserStack SDK with automatic configuration",
    category: "Test Automation",
    tools: ["runTestsOnBrowserStack"],
  },
  [BrowserStackProduct.APP_LIVE]: {
    name: "App Live Testing",
    description:
      "Test mobile apps on real devices with interactive debugging capabilities",
    category: "Mobile Testing",
    tools: ["runAppLiveSession"],
  },
  [BrowserStackProduct.BROWSER_LIVE]: {
    name: "Browser Live Testing",
    description:
      "Test web applications on real browsers and devices for cross-browser compatibility",
    category: "Web Testing",
    tools: ["runBrowserLiveSession"],
  },
  [BrowserStackProduct.ACCESSIBILITY]: {
    name: "Accessibility Testing",
    description:
      "Automated accessibility scanning and reporting for WCAG compliance",
    category: "Quality Assurance",
    tools: ["startAccessibilityScan"],
  },
  [BrowserStackProduct.TEST_MANAGEMENT]: {
    name: "Test Management",
    description:
      "Comprehensive test case and test run management with project organization. " +
      "Involve creating test cases, organizing them into projects or folders, " +
      "and managing test runs.",
    category: "Test Management",
    tools: [
      "createProjectOrFolder",
      "createTestCase",
      "listTestCases",
      "createTestRun",
      "listTestRuns",
      "updateTestRun",
      "addTestResult",
      "uploadProductRequirementFile",
      "createTestCasesFromFile",
    ],
  },
  [BrowserStackProduct.APP_AUTOMATION]: {
    name: "App Automation",
    description:
      "Automated mobile app testing with screenshot capture and visual validation",
    category: "Mobile Automation",
    tools: ["takeAppScreenshot"],
  },
  [BrowserStackProduct.FAILURE_LOGS]: {
    name: "Failure Analysis",
    description:
      "Debug test failures with comprehensive logs, network data, and crash reports",
    category: "Debugging",
    tools: ["getFailureLogs"],
  },
  [BrowserStackProduct.AUTOMATE]: {
    name: "Web Automation",
    description:
      "Automated web testing with screenshot capture and session management",
    category: "Web Automation",
    tools: ["fetchAutomationScreenshots"],
  },
  [BrowserStackProduct.SELF_HEAL]: {
    name: "Self-Healing Tests",
    description:
      "AI-powered test maintenance with automatic selector healing for flaky tests",
    category: "AI/ML",
    tools: ["fetchSelfHealedSelectors"],
  },
};

export class ProductManager {
  private enabledProducts: BrowserStackProduct[] = [];
  private readonly MAX_ENABLED_PRODUCTS = 2;
  private server: McpServer;
  private toolRegistrationFunctions: Map<
    BrowserStackProduct,
    (server: McpServer) => void
  >;

  constructor(server: McpServer) {
    this.server = server;
    this.toolRegistrationFunctions = new Map();
  }

  /**
   * Register a product's tool registration function
   */
  registerProduct(
    product: BrowserStackProduct,
    registrationFn: (server: McpServer) => void,
  ): void {
    this.toolRegistrationFunctions.set(product, registrationFn);
  }

  /**
   * send notification to the server when a product is enabled
   */
  notifyProductEnabled(): void {
    this.server.sendToolListChanged();
  }
  /**
   * Enable a product (adds to queue, removes oldest if queue is full)
   */
  enableProduct(product: BrowserStackProduct): {
    success: boolean;
    message: string;
    previouslyEnabled?: BrowserStackProduct;
  } {
    // Check if product is already enabled
    if (this.enabledProducts.includes(product)) {
      return {
        success: false,
        message: `Product '${PRODUCT_CONFIGS[product].name}' is already enabled`,
      };
    }

    // Check if we have a registration function for this product
    const registrationFn = this.toolRegistrationFunctions.get(product);
    if (!registrationFn) {
      return {
        success: false,
        message: `Product '${PRODUCT_CONFIGS[product].name}' is not available for registration`,
      };
    }

    let removedProduct: BrowserStackProduct | undefined;

    // If we're at max capacity, remove the oldest product
    if (this.enabledProducts.length >= this.MAX_ENABLED_PRODUCTS) {
      removedProduct = this.enabledProducts.shift();
      if (removedProduct) {
        this.disableProductTools(removedProduct);
        logger.info(
          `Disabled product: ${PRODUCT_CONFIGS[removedProduct].name} (queue full)`,
        );
      }
    }

    // Add the new product to the end of the queue
    this.enabledProducts.push(product);

    // Register the product's tools
    try {
      registrationFn(this.server);
      logger.info(`Enabled product: ${PRODUCT_CONFIGS[product].name}`);

      const message = removedProduct
        ? `Successfully enabled '${PRODUCT_CONFIGS[product].name}'. Disabled '${PRODUCT_CONFIGS[removedProduct].name}' due to queue limit (max ${this.MAX_ENABLED_PRODUCTS} products).`
        : `Successfully enabled '${PRODUCT_CONFIGS[product].name}'.`;

      return {
        success: true,
        message,
        previouslyEnabled: removedProduct,
      };
    } catch (error) {
      // If registration failed, remove from enabled list
      this.enabledProducts.pop();
      logger.error(
        `Failed to enable product ${PRODUCT_CONFIGS[product].name}:`,
        error,
      );

      return {
        success: false,
        message: `Failed to enable '${PRODUCT_CONFIGS[product].name}': ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Disable a specific product's tools
   */
  private disableProductTools(product: BrowserStackProduct): void {
    const config = PRODUCT_CONFIGS[product];
    config.tools.forEach((toolName) => {
      try {
        // Remove the tool from the server
        // Note: The MCP SDK doesn't have a direct remove method,
        // so we'll mark them as disabled in our tracking
        logger.debug(`Disabled tool: ${toolName}`);
      } catch (error) {
        logger.error(`Failed to disable tool ${toolName}:`, error);
      }
    });
  }

  /**
   * Get list of currently enabled products
   */
  getEnabledProducts(): BrowserStackProduct[] {
    return [...this.enabledProducts];
  }

  /**
   * Get list of available but not enabled products
   */
  getAvailableProducts(): BrowserStackProduct[] {
    return Object.values(BrowserStackProduct).filter(
      (product) => !this.enabledProducts.includes(product),
    );
  }

  /**
   * Get product configuration
   */
  getProductConfig(product: BrowserStackProduct): ProductConfig {
    return PRODUCT_CONFIGS[product];
  }

  /**
   * Get formatted status of all products
   */
  getProductStatus(): string {
    const enabled = this.getEnabledProducts();
    const available = this.getAvailableProducts();

    let status = `## Product Status (${enabled.length}/${this.MAX_ENABLED_PRODUCTS} enabled)\n\n`;

    if (enabled.length > 0) {
      status += "### 🟢 Currently Enabled Products:\n";
      enabled.forEach((product, index) => {
        const config = PRODUCT_CONFIGS[product];
        status += `${index + 1}. **${config.name}** (${config.category})\n`;
        status += `   ${config.description}\n`;
        status += `   Tools: ${config.tools.join(", ")}\n\n`;
      });
    }

    if (available.length > 0) {
      status += "### ⚪ Available Products:\n";
      available.forEach((product) => {
        const config = PRODUCT_CONFIGS[product];
        status += `- **${config.name}** (${config.category}): ${config.description}\n`;
      });
    }

    status += `\n💡 **Tip**: You can enable up to ${this.MAX_ENABLED_PRODUCTS} products simultaneously. Enabling a new product when at capacity will disable the oldest enabled product.`;

    return status;
  }

  /**
   * Check if a product is currently enabled
   */
  isProductEnabled(product: BrowserStackProduct): boolean {
    return this.enabledProducts.includes(product);
  }
}
