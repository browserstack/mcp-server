/**
 * Dynamic Tools for Product Management
 * Handles the enable_products tool and dynamic tool registration
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ProductManager,
  BrowserStackProduct,
  PRODUCT_CONFIGS,
} from "../lib/product-manager.js";
import { trackMCP } from "../lib/instrumentation.js";
import logger from "../logger.js";

let productManager: ProductManager;

/**
 * Enable one or more BrowserStack products
 */
export async function enableProductsTool(args: {
  products: BrowserStackProduct[];
}): Promise<CallToolResult> {
  const results: string[] = [];
  const errors: string[] = [];

  if (!args.products || args.products.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "❌ No products specified. Please provide at least one product to enable.\n\n" +
            productManager.getProductStatus(),
          isError: true,
        },
      ],
      isError: true,
    };
  }

  // Validate product names
  const validProducts = Object.values(BrowserStackProduct);
  const invalidProducts = args.products.filter(
    (p) => !validProducts.includes(p),
  );

  if (invalidProducts.length > 0) {
    return {
      content: [
        {
          type: "text",
          text:
            `❌ Invalid products: ${invalidProducts.join(", ")}\n\n` +
            `Valid products are: ${validProducts.join(", ")}\n\n` +
            productManager.getProductStatus(),
          isError: true,
        },
      ],
      isError: true,
    };
  }

  // Enable each product
  for (const product of args.products) {
    const result = productManager.enableProduct(product);

    if (result.success) {
      results.push(`✅ ${result.message}`);
      if (result.previouslyEnabled) {
        results.push(
          `ℹ️  Previously enabled product '${PRODUCT_CONFIGS[result.previouslyEnabled].name}' was automatically disabled.`,
        );
      }
    } else {
      errors.push(`❌ ${result.message}`);
    }
  }

  productManager.notifyProductEnabled();

  // Build response
  let responseText = "";

  if (results.length > 0) {
    responseText += results.join("\n") + "\n\n";
  }

  if (errors.length > 0) {
    responseText += errors.join("\n") + "\n\n";
  }

  responseText += productManager.getProductStatus();

  const hasErrors = errors.length > 0;

  return {
    content: [
      {
        type: "text",
        text: responseText,
        isError: hasErrors,
      },
      {
        type: "text",
        text:
          "Don't Directly Call the enabled products tools. " +
          "Ask User for the confirmation and then check for  the enabled products and call the respective tools.",
      },
    ],
    isError: hasErrors,
  };
}

/**
 * Get current product status
 */
export async function getProductStatusTool(): Promise<CallToolResult> {
  return {
    content: [
      {
        type: "text",
        text: productManager.getProductStatus(),
      },
    ],
  };
}

/**
 * Register dynamic tools with the server
 */
export function addDynamicTools(
  server: McpServer,
  manager: ProductManager,
): void {
  productManager = manager;

  // Enable products tool - always available
  server.tool(
    "enable_products",
    "Enable BrowserStack products to access their tools. You can enable up to 2 products simultaneously. Enabling additional products will disable the oldest enabled product. Use this tool to activate specific BrowserStack capabilities based on user needs." +
      "Tools will be dynamically registered based on the enabled products.",
    {
      products: z.array(z.nativeEnum(BrowserStackProduct)).describe(
        `Array of products to enable. Available products:\n` +
          Object.values(BrowserStackProduct)
            .map((product) => {
              const config = PRODUCT_CONFIGS[product];
              return `- ${product}: ${config.name} (${config.category}) - ${config.description}`;
            })
            .join("\n"),
      ),
    },
    async (args) => {
      try {
        trackMCP("enable_products", server.server.getClientVersion()!);
        return await enableProductsTool(args);
      } catch (error) {
        trackMCP("enable_products", server.server.getClientVersion()!, error);
        logger.error("Failed to enable products:", error);

        return {
          content: [
            {
              type: "text",
              text:
                `❌ Failed to enable products: ${error instanceof Error ? error.message : "Unknown error"}\n\n` +
                productManager.getProductStatus(),
              isError: true,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Product status tool - always available
  server.tool(
    "get_product_status",
    "Get the current status of all BrowserStack products (enabled/available) and their capabilities.",
    {},
    async () => {
      try {
        trackMCP("get_product_status", server.server.getClientVersion()!);
        return await getProductStatusTool();
      } catch (error) {
        trackMCP(
          "get_product_status",
          server.server.getClientVersion()!,
          error,
        );
        logger.error("Failed to get product status:", error);

        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to get product status: ${error instanceof Error ? error.message : "Unknown error"}`,
              isError: true,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

export { ProductManager, BrowserStackProduct, PRODUCT_CONFIGS };
