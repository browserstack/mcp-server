import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { trackMCP } from "../lib/instrumentation.js";
import { getSDKPrefixCommand } from "./sdk-utils/commands.js";

import {
  SDKSupportedBrowserAutomationFramework,
  SDKSupportedLanguage,
  SDKSupportedTestingFramework,
  SDKSupportedLanguageEnum,
  SDKSupportedBrowserAutomationFrameworkEnum,
  SDKSupportedTestingFrameworkEnum,
} from "./sdk-utils/types.js";

import {
  generateBrowserStackYMLInstructions,
  getInstructionsForProjectConfiguration,
  formatInstructionsWithNumbers,
} from "./sdk-utils/instructions.js";

import {
  formatPercyInstructions,
  getPercyInstructions,
} from "./sdk-utils/percy/instructions.js";


/**
 * BrowserStack SDK hooks into your test framework to seamlessly run tests on BrowserStack.
 * This tool gives instructions to setup a browserstack.yml file in the project root and installs the necessary dependencies.
 */
export async function bootstrapProjectWithSDK({
  detectedBrowserAutomationFramework,
  detectedTestingFramework,
  detectedLanguage,
  desiredPlatforms,
  enablePercy,
}: {
  detectedBrowserAutomationFramework: SDKSupportedBrowserAutomationFramework;
  detectedTestingFramework: SDKSupportedTestingFramework;
  detectedLanguage: SDKSupportedLanguage;
  desiredPlatforms: string[];
  enablePercy: boolean;
}): Promise<CallToolResult> {
  // Handle frameworks with unique setup instructions that don't use browserstack.yml
  if (
    detectedBrowserAutomationFramework === "cypress" ||
    detectedTestingFramework === "webdriverio"
  ) {
    let combinedInstructions = getInstructionsForProjectConfiguration(
      detectedBrowserAutomationFramework,
      detectedTestingFramework,
      detectedLanguage,
    );

    if (enablePercy) {
      const percyInstructions = getPercyInstructions(
        detectedLanguage,
        detectedBrowserAutomationFramework,
        detectedTestingFramework,
      );

      if (percyInstructions) {
        combinedInstructions +=
          "\n\n" + formatPercyInstructions(percyInstructions);
      } else {
        throw new Error(
          `Percy is currently not supported through MCP for ${detectedLanguage} with ${detectedTestingFramework}. If you want to run the test cases without Percy, disable Percy and run it again.`,
        );
      }
    }

    // Apply consistent formatting for all configurations
    return formatFinalInstructions(combinedInstructions);
  }

  // Handle default flow using browserstack.yml
  const sdkSetupCommand = getSDKPrefixCommand(
    detectedLanguage,
    detectedTestingFramework,
  );

  const ymlInstructions = generateBrowserStackYMLInstructions(
    desiredPlatforms,
    enablePercy,
  );

  const instructionsForProjectConfiguration =
    getInstructionsForProjectConfiguration(
      detectedBrowserAutomationFramework,
      detectedTestingFramework,
      detectedLanguage,
    );

  let combinedInstructions = "";

  // Step 1: Add SDK setup command
  if (sdkSetupCommand) {
    combinedInstructions += sdkSetupCommand;
  }

  // Step 2: Add browserstack.yml setup
  if (ymlInstructions) {
    combinedInstructions += "\n\n---STEP---\n" + ymlInstructions;
  }

  // Step 3: Add language/framework-specific setup
  if (instructionsForProjectConfiguration) {
    combinedInstructions += "\n\n" + instructionsForProjectConfiguration;
  }

  // Step 4: Add Percy setup if applicable
  if (enablePercy) {
    const percyInstructions = getPercyInstructions(
      detectedLanguage,
      detectedBrowserAutomationFramework,
      detectedTestingFramework,
    );

    if (percyInstructions) {
      combinedInstructions +=
        "\n\n" + formatPercyInstructions(percyInstructions);
    } else {
      throw new Error(
        `Percy is currently not supported through MCP for ${detectedLanguage} with ${detectedTestingFramework}. If you want to run the test cases without Percy, disable Percy and run it again.`,
      );
    }
  }

  // Apply consistent formatting for all configurations
  return formatFinalInstructions(combinedInstructions);
}

// Helper function to apply consistent formatting to all instruction types
function formatFinalInstructions(combinedInstructions: string): CallToolResult {
  const fullInstructions = `⚠️ IMPORTANT: DO NOT SKIP ANY STEP
  All the setup steps described in this file MUST be executed regardless of any existing configuration or setup.
  This ensures proper BrowserStack SDK setup.

  ${formatInstructionsWithNumbers(combinedInstructions)}`;

  return {
    content: [
      {
        type: "text",
        text: fullInstructions,
        isError: false,
      },
    ],
  };
}

export default function addSDKTools(server: McpServer) {
  server.tool(
    "runTestsOnBrowserStack",
    "Use this tool to get instructions for running tests on BrowserStack and browserstack percy",
    {
      detectedBrowserAutomationFramework: z
        .nativeEnum(SDKSupportedBrowserAutomationFrameworkEnum)
        .describe(
          "The automation framework configured in the project. Example: 'playwright', 'selenium'",
        ),

      detectedTestingFramework: z
        .nativeEnum(SDKSupportedTestingFrameworkEnum)
        .describe(
          "The testing framework used in the project. Be precise with framework selection Example: 'webdriverio', 'jest', 'pytest', 'junit4', 'junit5', 'mocha'",
        ),

      detectedLanguage: z
        .nativeEnum(SDKSupportedLanguageEnum)
        .describe(
          "The programming language used in the project. Example: 'nodejs', 'python', 'java', 'csharp'",
        ),

      desiredPlatforms: z
        .array(z.enum(["windows", "macos", "android", "ios"]))
        .describe(
          "The platforms the user wants to test on. Always ask this to the user, do not try to infer this.",
        ),

      enablePercy: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Set to true if the user wants to enable Percy for visual testing. Defaults to false.",
        ),
    },

    async (args) => {
      try {
        trackMCP("runTestsOnBrowserStack", server.server.getClientVersion()!);

        return await bootstrapProjectWithSDK({
          detectedBrowserAutomationFramework:
            args.detectedBrowserAutomationFramework as SDKSupportedBrowserAutomationFramework,

          detectedTestingFramework:
            args.detectedTestingFramework as SDKSupportedTestingFramework,

          detectedLanguage: args.detectedLanguage as SDKSupportedLanguage,

          desiredPlatforms: args.desiredPlatforms,
          enablePercy: args.enablePercy,
        });
      } catch (error) {
        trackMCP(
          "runTestsOnBrowserStack",
          server.server.getClientVersion()!,
          error,
        );

        return {
          content: [
            {
              type: "text",
              text: `Failed to bootstrap project with BrowserStack SDK. Error: ${error}. Please open an issue on GitHub if the problem persists`,
              isError: true,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
