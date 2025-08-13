import {
  SetUpPercySchema,
  RunTestsOnBrowserStackSchema,
} from "./common/schema.js";
import { getBootstrapFailedMessage } from "./common/utils.js";
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
import { checkPercyIntegrationSupport } from "./common/utils.js";
import {
  PERCY_SIMULATE_INSTRUCTION,
  PERCY_REPLACE_REGEX,
  PERCY_SIMULATION_DRIVER_INSTRUCTION,
} from "./common/constants.js";

export async function runTestsOnBrowserStackHandler(
  rawInput: unknown,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const input = RunTestsOnBrowserStackSchema.parse(rawInput);

    // Only handle BrowserStack SDK setup for functional/integration tests.
    const result = runBstackSDKOnly(input, config);
    return await formatToolResult(result);
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: getBootstrapFailedMessage(error, { config }),
        },
      ],
      isError: true,
    };
  }
}

export async function setUpPercyHandler(
  rawInput: unknown,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const input = SetUpPercySchema.parse(rawInput);
    const authorization = getBrowserStackAuth(config);

    const percyInput = {
      projectName: input.projectName,
      detectedLanguage: input.detectedLanguage,
      detectedBrowserAutomationFramework:
        input.detectedBrowserAutomationFramework,
      detectedTestingFramework: input.detectedTestingFramework,
      integrationType: input.integrationType,
      folderPaths: input.folderPaths || [],
    };

    if (input.integrationType === PercyIntegrationTypeEnum.WEB) {
      const supportCheck = checkPercyIntegrationSupport(percyInput);
      if (!supportCheck.supported) {
        return {
          content: [
            {
              type: "text",
              text:
                supportCheck.errorMessage ||
                "Percy Web integration is not supported for this configuration.",
            },
          ],
          isError: true,
          shouldSkipFormatting: true,
        };
      }
      const percyToken = await fetchPercyToken(
        input.projectName,
        authorization,
        { type: PercyIntegrationTypeEnum.WEB },
      );
      const result = runPercyWeb(percyInput, percyToken);
      return await formatToolResult(result);
    } else if (input.integrationType === PercyIntegrationTypeEnum.AUTOMATE) {
      // First try Percy with BrowserStack SDK
      const percyWithBrowserstackSDKResult = runPercyWithBrowserstackSDK(
        {
          ...percyInput,
          desiredPlatforms: [],
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
          return {
            content: [
              {
                type: "text",
                text:
                  supportCheck.errorMessage ||
                  "Percy Automate integration is not supported for this configuration.",
              },
            ],
            isError: true,
            shouldSkipFormatting: true,
          };
        }
        // SDK setup instructions (for Automate, without Percy)
        const sdkInput = {
          projectName: input.projectName,
          detectedLanguage: input.detectedLanguage,
          detectedBrowserAutomationFramework:
            input.detectedBrowserAutomationFramework,
          detectedTestingFramework: input.detectedTestingFramework,
          desiredPlatforms: [],
        };
        const sdkResult = runBstackSDKOnly(sdkInput, config, true);
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
    return {
      content: [
        {
          type: "text",
          text: getBootstrapFailedMessage(error, {
            config,
            percyMode: (rawInput as any)?.integrationType,
          }),
        },
      ],
      isError: true,
    };
  }
}

export async function setUpSimulatePercyChangeHandler(
  rawInput: unknown,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const percyInstruction = await setUpPercyHandler(rawInput, config);

    if (percyInstruction.isError) {
      return percyInstruction;
    }

    if (Array.isArray(percyInstruction.content)) {
      percyInstruction.content.forEach((item) => {
        if (
          typeof item.text === "string" &&
          PERCY_REPLACE_REGEX.test(item.text)
        ) {
          item.text = item.text.replace(
            PERCY_REPLACE_REGEX,
            PERCY_SIMULATE_INSTRUCTION,
          );
        }
      });
    }

    percyInstruction.content?.push({
      type: "text" as const,
      text: PERCY_SIMULATION_DRIVER_INSTRUCTION,
    });

    return percyInstruction;
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: getBootstrapFailedMessage(error, { config }),
        },
      ],
      isError: true,
    };
  }
}
