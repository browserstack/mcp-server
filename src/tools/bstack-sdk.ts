import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  SDKSupportedBrowserAutomationFramework,
  SDKSupportedLanguage,
  SDKSupportedTestingFramework,
} from "./sdk-utils/types";
import {
  generateBrowserStackYMLInstructions,
  getInstructionsForProjectConfiguration,
} from "./sdk-utils/instructions";
import { trackMCPEvent } from "../lib/instrumentation";

/**
 * BrowserStack SDK hooks into your test framework to seamlessly run tests on BrowserStack.
 * This tool gives instructions to setup a browserstack.yml file in the project root and installs the necessary dependencies.
 */
export async function bootstrapProjectWithSDK({
  detectedBrowserAutomationFramework,
  detectedTestingFramework,
  detectedLanguage,
  desiredPlatforms,
}: {
  detectedBrowserAutomationFramework: SDKSupportedBrowserAutomationFramework;
  detectedTestingFramework: SDKSupportedTestingFramework;
  detectedLanguage: SDKSupportedLanguage;
  desiredPlatforms: string[];
}): Promise<CallToolResult> {
  const instructions = generateBrowserStackYMLInstructions(desiredPlatforms);
  const instructionsForProjectConfiguration =
    getInstructionsForProjectConfiguration(
      detectedBrowserAutomationFramework,
      detectedTestingFramework,
      detectedLanguage,
    );

  return {
    content: [
      {
        type: "text",
        text: `${instructions}\n\n After creating the browserstack.yml file above, do the following: ${instructionsForProjectConfiguration}`,
        isError: false,
      },
    ],
  };
}

export default function addSDKTools(server: McpServer) {
  server.tool(
    "runTestsOnBrowserStack",
    "Use this tool to get instructions for running tests on BrowserStack.",
    {
      detectedBrowserAutomationFramework: z
        .string()
        .describe(
          "The automation framework configured in the project. Example: 'playwright', 'selenium'",
        ),
      detectedTestingFramework: z
        .string()
        .describe(
          "The testing framework used in the project. Example: 'jest', 'pytest'",
        ),
      detectedLanguage: z
        .string()
        .describe(
          "The programming language used in the project. Example: 'nodejs', 'python'",
        ),
      desiredPlatforms: z
        .array(z.enum(["windows", "macos", "android", "ios"]))
        .describe(
          "The platforms the user wants to test on. Always ask this to the user, do not try to infer this.",
        ),
    },
    async (args) => {
      const detectedBrowserAutomationFramework =
        args.detectedBrowserAutomationFramework as SDKSupportedBrowserAutomationFramework;
      const detectedTestingFramework =
        args.detectedTestingFramework as SDKSupportedTestingFramework;
      const detectedLanguage = args.detectedLanguage as SDKSupportedLanguage;
      const desiredPlatforms = args.desiredPlatforms;

      try {
        trackMCPEvent("runTestsOnBrowserStack");
        return bootstrapProjectWithSDK({
          detectedBrowserAutomationFramework,
          detectedTestingFramework,
          detectedLanguage,
          desiredPlatforms,
        });
      } catch (error) {
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
