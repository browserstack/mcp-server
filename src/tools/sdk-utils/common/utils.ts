import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PercyIntegrationTypeEnum } from "../common/types.js";
import { isPercyAutomateFrameworkSupported } from "../percy-automate/frameworks.js";
import { isPercyWebFrameworkSupported } from "../percy-web/frameworks.js";
import {
  formatInstructionsWithNumbers,
  generateVerificationMessage,
} from "./formatUtils.js";
import {
  RunTestsInstructionResult,
  PercyAutomateNotImplementedType,
} from "./types.js";
import { IMPORTANT_SETUP_WARNING } from "./index.js";

export function checkPercyIntegrationSupport(input: {
  integrationType: string;
  detectedLanguage: string;
  detectedTestingFramework?: string;
  detectedBrowserAutomationFramework?: string;
}): { supported: boolean; errorMessage?: string } {
  if (input.integrationType === PercyIntegrationTypeEnum.AUTOMATE) {
    const isSupported = isPercyAutomateFrameworkSupported(
      input.detectedLanguage,
      input.detectedBrowserAutomationFramework || "",
      input.detectedTestingFramework || "",
    );
    if (!isSupported) {
      return {
        supported: false,
        errorMessage: `Percy Automate is not supported for this configuration. Language: ${input.detectedLanguage} Testing Framework: ${input.detectedTestingFramework}`,
      };
    }
  } else if (input.integrationType === PercyIntegrationTypeEnum.WEB) {
    const isSupported = isPercyWebFrameworkSupported(
      input.detectedLanguage,
      input.detectedBrowserAutomationFramework || "",
    );
    if (!isSupported) {
      return {
        supported: false,
        errorMessage: `Percy Web is not supported for this configuration. Language: ${input.detectedLanguage} Browser Automation Framework: ${input.detectedBrowserAutomationFramework}`,
      };
    }
  }
  return { supported: true };
}

export async function formatToolResult(
  resultPromise: Promise<RunTestsInstructionResult> | RunTestsInstructionResult,
): Promise<CallToolResult> {
  const { steps, requiresPercy, missingDependencies, shouldSkipFormatting } =
    await resultPromise;

  if (shouldSkipFormatting) {
    return {
      content: steps.map((step) => ({
        type: "text" as const,
        text: step.content,
      })),
      isError: steps.some((s) => s.isError),
      steps,
      requiresPercy,
      missingDependencies,
    };
  }

  const combinedInstructions = steps.map((step) => step.content).join("\n");
  const { formattedSteps, stepCount } =
    formatInstructionsWithNumbers(combinedInstructions);
  const verificationMessage = generateVerificationMessage(stepCount);

  const finalContent = [
    { type: "text" as const, text: IMPORTANT_SETUP_WARNING },
    { type: "text" as const, text: formattedSteps },
    { type: "text" as const, text: verificationMessage },
  ];

  return {
    content: finalContent,
    isError: steps.some((s) => s.isError),
    requiresPercy,
    missingDependencies,
  };
}

export function getPercyAutomateNotImplementedMessage(
  type: PercyAutomateNotImplementedType,
  input: {
    detectedLanguage: string;
    detectedBrowserAutomationFramework: string;
  },
  supported: string[],
): string {
  if (type === PercyAutomateNotImplementedType.LANGUAGE) {
    return `Percy Automate does not support the language: ${input.detectedLanguage}. Supported languages are: ${supported.join(", ")}.`;
  } else {
    return `Percy Automate does not support ${input.detectedBrowserAutomationFramework} for ${input.detectedLanguage}. Supported frameworks for ${input.detectedLanguage} are: ${supported.join(", ")}.`;
  }
}

export function getBootstrapFailedMessage(
  error: unknown,
  context: { config: unknown; percyMode?: string; sdkVersion?: string },
): string {
  return `Failed to bootstrap project with BrowserStack SDK.
Error: ${error}
Percy Mode: ${context.percyMode ?? "automate"}
SDK Version: ${context.sdkVersion ?? "N/A"}
Please open an issue on GitHub if the problem persists.`;
}

export function percyUnsupportedResult(
  integrationType: PercyIntegrationTypeEnum,
  supportCheck?: { errorMessage?: string },
): CallToolResult {
  const defaultMessage = `Percy ${integrationType} integration is not supported for this configuration.`;

  return {
    content: [
      {
        type: "text",
        text: supportCheck?.errorMessage || defaultMessage,
      },
    ],
    isError: true,
    shouldSkipFormatting: true,
  };
}
