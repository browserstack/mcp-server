import {
  SetUpPercySchema,
  RunTestsOnBrowserStackSchema,
} from "./common/schema.js";
import { BOOTSTRAP_FAILED } from "./common/commonMessages.js";
import { formatToolResult } from "./common/utils.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PercyIntegrationTypeEnum } from "./common/types.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { fetchPercyToken } from "./percy-web/fetchPercyToken.js";
import { runPercyWeb } from "./percy-web/handler.js";
import { runPercyAutomateOnly } from "./percy-automate/handler.js";
import { runBstackSDKOnly } from "./bstack/sdkHandler.js";
import { runPercyWithSDK } from "./percy-bstack/handler.js";
import { checkPercyIntegrationSupport } from "./common/utils.js";

export async function runTestsOnBrowserStackHandler(
  rawInput: unknown,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const input = RunTestsOnBrowserStackSchema.parse(rawInput);

    if (!input.enablePercy) {
      const result = runBstackSDKOnly(input, config);
      return await formatToolResult(result);
    } else {
      const percyWithSDKResult = runPercyWithSDK(input, config);
      const hasPercySDKError = percyWithSDKResult.steps.some(
        (step) => step.isError,
      );
      if (hasPercySDKError) {
        const {
          projectName,
          detectedLanguage,
          detectedBrowserAutomationFramework,
          detectedTestingFramework,
        } = input;

        // Check if standalone Percy Automate supports this configuration.
        const percyWithBrowserstackSDK = checkPercyIntegrationSupport({
          integrationType: PercyIntegrationTypeEnum.AUTOMATE,
          detectedLanguage,
          detectedTestingFramework,
        });

        if (!percyWithBrowserstackSDK.supported) {
          return {
            content: [
              {
                type: "text",
                text:
                  percyWithBrowserstackSDK.errorMessage ||
                  "Percy Automate is not supported for this configuration.",
              },
            ],
            isError: true,
            shouldSkipFormatting: true,
          };
        }

        // Standalone Percy Automate is supported, proceed with its setup flow.
        const percyAutomateInput = {
          projectName,
          detectedLanguage,
          detectedBrowserAutomationFramework,
          detectedTestingFramework,
          integrationType: PercyIntegrationTypeEnum.AUTOMATE,
        };

        const authorization = getBrowserStackAuth(config);
        const percyToken = await fetchPercyToken(projectName, authorization, {
          type: PercyIntegrationTypeEnum.AUTOMATE,
        });

        // 1. Get BrowserStack SDK setup steps (for Automate, without Percy)
        const sdkResult = runBstackSDKOnly(input, config, true);

        // 2. Get Percy Automate setup steps
        const percyAutomateResult = runPercyAutomateOnly(
          percyAutomateInput,
          percyToken,
        );

        // 3. Combine steps: warning, SDK steps, Percy Automate steps
        const combinedSteps = [
          {
            type: "warning" as const,
            content: `Note: Percy with the BrowserStack SDK is not supported for your project's configuration (Language: ${detectedLanguage}, Testing Framework: ${detectedTestingFramework}). Falling back to the standalone Percy Automate SDK setup. You must set up both BrowserStack Automate and Percy Automate.`,
            title: "Percy Automate Fallback",
            isError: false,
          },
          ...(sdkResult.steps || []),
          ...(percyAutomateResult.steps || []),
        ];

        // 4. Pass combined steps to formatToolResult
        return await formatToolResult({
          ...percyAutomateResult,
          steps: combinedSteps,
        });
      }
      return await formatToolResult(percyWithSDKResult);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: BOOTSTRAP_FAILED(error, {
            config,
            percyMode: (rawInput as any)?.enablePercy
              ? "percy-on-bstack"
              : "bstack-only",
          }),
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

    // Create adapter object for Percy handlers
    const percyInput = {
      projectName: input.projectName,
      detectedLanguage: input.detectedLanguage,
      detectedBrowserAutomationFramework:
        input.detectedBrowserAutomationFramework,
      detectedTestingFramework: input.detectedTestingFramework,
      integrationType: PercyIntegrationTypeEnum.WEB,
    };

    const supportCheck = checkPercyIntegrationSupport(percyInput);
    if (!supportCheck.supported) {
      return {
        content: [
          {
            type: "text",
            text:
              supportCheck.errorMessage ||
              "Percy integration not supported for this configuration.",
          },
        ],
        isError: true,
        shouldSkipFormatting: true,
      };
    }

    const percyToken = await fetchPercyToken(input.projectName, authorization, {
      type: PercyIntegrationTypeEnum.WEB,
    });

    const result = runPercyWeb(percyInput, percyToken);

    return await formatToolResult(result);
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: BOOTSTRAP_FAILED(error, {
            config,
            percyMode: (rawInput as any)?.integrationType,
          }),
        },
      ],
      isError: true,
    };
  }
}
