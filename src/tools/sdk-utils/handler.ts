import { formatToolResult } from "./common/utils.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PercyIntegrationTypeEnum } from "./common/types.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { fetchPercyToken } from "./percy-web/fetchPercyToken.js";
import { runPercyWeb } from "./percy-web/handler.js";
import { runPercyAutomateOnly } from "./percy-automate/handler.js";
import { runBstackSDKOnly } from "./bstack/sdkHandler.js";
import { runPercyWithBrowserstackSDK } from "./percy-bstack/handler.js";
import {
  checkPercyIntegrationSupport,
  validatePercyPathandFolders,
} from "./common/utils.js";
import {
  SetUpPercySchema,
  RunTestsOnBrowserStackSchema,
} from "./common/schema.js";
import { storedPercyResults } from "../../lib/inmemory-store.js";
import {
  getBootstrapFailedMessage,
  percyUnsupportedResult,
} from "./common/utils.js";
import {
  PERCY_SIMULATE_INSTRUCTION,
  PERCY_REPLACE_REGEX,
  PERCY_SIMULATION_DRIVER_INSTRUCTION,
  PERCY_VERIFICATION_REGEX,
} from "./common/constants.js";

export async function runTestsOnBrowserStackHandler(
  rawInput: unknown,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const input = RunTestsOnBrowserStackSchema.parse(rawInput);
  const result = await runBstackSDKOnly(input, config);
  return await formatToolResult(result);
}

export async function setUpPercyHandler(
  rawInput: unknown,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const input = SetUpPercySchema.parse(rawInput);
    validatePercyPathandFolders(input);

    // Clear any previous Percy results for a fresh start
    storedPercyResults.clear();

    storedPercyResults.set({
      projectName: input.projectName,
      detectedLanguage: input.detectedLanguage,
      detectedBrowserAutomationFramework:
        input.detectedBrowserAutomationFramework,
      detectedTestingFramework: input.detectedTestingFramework,
      integrationType: input.integrationType,
      folderPaths: input.folderPaths || [],
      filePaths: input.filePaths || [],
      testFiles: {},
    });

    const authorization = getBrowserStackAuth(config);

    const folderPaths = input.folderPaths || [];
    const filePaths = input.filePaths || [];

    const percyInput = {
      projectName: input.projectName,
      detectedLanguage: input.detectedLanguage,
      detectedBrowserAutomationFramework:
        input.detectedBrowserAutomationFramework,
      detectedTestingFramework: input.detectedTestingFramework,
      integrationType: input.integrationType,
      folderPaths,
      filePaths,
    };

    // Check for Percy Web integration support
    if (input.integrationType === PercyIntegrationTypeEnum.WEB) {
      const supportCheck = checkPercyIntegrationSupport(percyInput);
      if (!supportCheck.supported) {
        return percyUnsupportedResult(
          PercyIntegrationTypeEnum.WEB,
          supportCheck,
        );
      }

      // Fetch the Percy token
      const percyToken = await fetchPercyToken(
        input.projectName,
        authorization,
        { type: PercyIntegrationTypeEnum.WEB },
      );

      const result = runPercyWeb(percyInput, percyToken);
      return await formatToolResult(result, "percy-web");
    } else if (input.integrationType === PercyIntegrationTypeEnum.AUTOMATE) {
      // First try Percy with BrowserStack SDK
      const percyWithBrowserstackSDKResult = runPercyWithBrowserstackSDK(
        {
          ...percyInput,
          devices: [],
        },
        config,
      );
      const hasPercySDKError =
        percyWithBrowserstackSDKResult.steps &&
        percyWithBrowserstackSDKResult.steps.some((step) => step.isError);

      if (!hasPercySDKError) {
        // Percy with SDK is supported, prepend warning and return those steps
        if (percyWithBrowserstackSDKResult.steps) {
          percyWithBrowserstackSDKResult.steps.unshift({
            type: "instruction" as const,
            title: "Important: Existing SDK Setup",
            content:
              "If you have already set up the BrowserStack SDK, do not override it unless you have explicitly decided to do so.",
          });
        }
        return await formatToolResult(percyWithBrowserstackSDKResult);
      } else {
        // Fallback to standalone Percy Automate if supported
        const supportCheck = checkPercyIntegrationSupport({
          ...percyInput,
          integrationType: PercyIntegrationTypeEnum.AUTOMATE,
        });
        if (!supportCheck.supported) {
          return percyUnsupportedResult(
            PercyIntegrationTypeEnum.AUTOMATE,
            supportCheck,
          );
        }
        // SDK setup instructions (for Automate, without Percy)
        const sdkInput = {
          projectName: input.projectName,
          detectedLanguage: input.detectedLanguage,
          detectedBrowserAutomationFramework:
            input.detectedBrowserAutomationFramework,
          detectedTestingFramework: input.detectedTestingFramework,
          devices: [],
        };
        const sdkResult = await runBstackSDKOnly(sdkInput, config, true);
        // Percy Automate instructions
        const percyToken = await fetchPercyToken(
          input.projectName,
          authorization,
          { type: PercyIntegrationTypeEnum.AUTOMATE },
        );
        const percyAutomateResult = runPercyAutomateOnly(
          percyInput,
          percyToken,
        );

        // Combine steps: warning, SDK steps, Percy Automate steps
        const steps = [
          {
            type: "instruction" as const,
            title: "Important: Existing SDK Setup",
            content:
              "If you have already set up the BrowserStack SDK, do not override it unless you have explicitly decided to do so.",
          },
          ...(sdkResult.steps || []),
          ...(percyAutomateResult.steps || []),
        ];

        // Combine all steps into the final result
        return await formatToolResult({
          ...percyAutomateResult,
          steps,
        });
      }
    } else {
      return {
        content: [
          {
            type: "text",
            text: "Unknown or unsupported Percy integration type requested.",
          },
        ],
        isError: true,
        shouldSkipFormatting: true,
      };
    }
  } catch (error) {
    throw new Error(getBootstrapFailedMessage(error, { config }));
  }
}

export async function simulatePercyChangeHandler(
  rawInput: unknown,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    let percyInstruction;

    try {
      percyInstruction = await setUpPercyHandler(rawInput, config);
    } catch {
      throw new Error("Failed to set up Percy");
    }

    if (percyInstruction.isError) {
      return percyInstruction;
    }

    if (Array.isArray(percyInstruction.content)) {
      percyInstruction.content = percyInstruction.content.map((item) => {
        if (item.type === "text" && typeof item.text === "string") {
          const updatedText = item.text
            .replace(PERCY_REPLACE_REGEX, PERCY_SIMULATE_INSTRUCTION)
            .replace(PERCY_VERIFICATION_REGEX, "");
          return { ...item, text: updatedText };
        }
        return item;
      });
    }

    percyInstruction.content?.push({
      type: "text" as const,
      text: PERCY_SIMULATION_DRIVER_INSTRUCTION,
    });

    return percyInstruction;
  } catch (error) {
    throw new Error(getBootstrapFailedMessage(error, { config }));
  }
}
