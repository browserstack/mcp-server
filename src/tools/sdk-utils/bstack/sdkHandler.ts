// Handler for BrowserStack SDK only (no Percy) - Sets up BrowserStack SDK with YML configuration
import { RunTestsInstructionResult, RunTestsStep } from "../common/types.js";
import { RunTestsOnBrowserStackInput } from "../common/schema.js";
import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import { getSDKPrefixCommand } from "./commands.js";
import { generateBrowserStackYMLInstructions } from "./configUtils.js";
import { getInstructionsForProjectConfiguration } from "../common/instructionUtils.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { validateDevices } from "../common/device-validator.js";
import { normalizeBrowserDevice } from "../../../schemas/device-types.js";
import {
  SDKSupportedBrowserAutomationFramework,
  SDKSupportedTestingFramework,
  SDKSupportedLanguage,
} from "../common/types.js";

export async function runBstackSDKOnly(
  input: RunTestsOnBrowserStackInput,
  config: BrowserStackConfig,
  isPercyAutomate = false,
): Promise<RunTestsInstructionResult> {
  const steps: RunTestsStep[] = [];
  const authString = getBrowserStackAuth(config);
  const [username, accessKey] = authString.split(":");

  // Normalize devices from either format (tuple or object) to tuple format for validation
  const inputDevices = input.devices ?? [];
  const normalizedDevices = inputDevices.map((device: unknown) => {
    const normalized = normalizeBrowserDevice(device);
    // Convert object to tuple format for validation function
    if (
      normalized &&
      typeof normalized === "object" &&
      !Array.isArray(normalized) &&
      "platform" in normalized
    ) {
      const deviceObj = normalized as {
        platform: string;
        osVersion?: string;
        browser?: string;
        browserVersion?: string;
        deviceName?: string;
      };
      if (deviceObj.platform === "windows") {
        return [
          deviceObj.platform,
          deviceObj.osVersion || "",
          deviceObj.browser || "",
          deviceObj.browserVersion || "",
        ];
      }
      if (deviceObj.platform === "android" || deviceObj.platform === "ios") {
        return [
          deviceObj.platform,
          deviceObj.deviceName || "",
          deviceObj.osVersion || "",
          deviceObj.browser || "",
        ];
      }
      if (deviceObj.platform === "macos") {
        return [
          deviceObj.platform,
          deviceObj.osVersion || "",
          deviceObj.browser || "",
          deviceObj.browserVersion || "",
        ];
      }
    }
    return device;
  }) as Array<Array<string>>;

  // Validate devices against real BrowserStack device data
  const validatedEnvironments = await validateDevices(
    normalizedDevices,
    input.detectedBrowserAutomationFramework,
  );

  // Handle frameworks with unique setup instructions that don't use browserstack.yml
  if (
    input.detectedBrowserAutomationFramework === "cypress" ||
    input.detectedTestingFramework === "webdriverio"
  ) {
    const frameworkInstructions = getInstructionsForProjectConfiguration(
      input.detectedBrowserAutomationFramework as SDKSupportedBrowserAutomationFramework,
      input.detectedTestingFramework as SDKSupportedTestingFramework,
      input.detectedLanguage as SDKSupportedLanguage,
      username,
      accessKey,
    );

    if (frameworkInstructions) {
      if (frameworkInstructions.setup) {
        steps.push({
          type: "instruction",
          title: "Framework-Specific Setup",
          content: frameworkInstructions.setup,
        });
      }

      if (frameworkInstructions.run && !isPercyAutomate) {
        steps.push({
          type: "instruction",
          title: "Run the tests",
          content: frameworkInstructions.run,
        });
      }
    }

    return {
      steps,
      requiresPercy: false,
      missingDependencies: [],
    };
  }

  // Default flow using browserstack.yml
  const sdkSetupCommand = getSDKPrefixCommand(
    input.detectedLanguage as SDKSupportedLanguage,
    input.detectedTestingFramework as SDKSupportedTestingFramework,
    username,
    accessKey,
  );

  if (sdkSetupCommand) {
    steps.push({
      type: "instruction",
      title: "Install BrowserStack SDK",
      content: sdkSetupCommand,
    });
  }

  const frameworkInstructions = getInstructionsForProjectConfiguration(
    input.detectedBrowserAutomationFramework as SDKSupportedBrowserAutomationFramework,
    input.detectedTestingFramework as SDKSupportedTestingFramework,
    input.detectedLanguage as SDKSupportedLanguage,
    username,
    accessKey,
  );

  if (frameworkInstructions) {
    if (frameworkInstructions.setup) {
      steps.push({
        type: "instruction",
        title: "Framework-Specific Setup",
        content: frameworkInstructions.setup,
      });
    }
  }

  const ymlInstructions = generateBrowserStackYMLInstructions(
    {
      validatedEnvironments,
      enablePercy: false,
      projectName: input.projectName,
    },
    config,
  );

  if (ymlInstructions) {
    steps.push({
      type: "instruction",
      title: "Configure browserstack.yml",
      content: ymlInstructions,
    });
  }

  if (frameworkInstructions) {
    if (frameworkInstructions.run && !isPercyAutomate) {
      steps.push({
        type: "instruction",
        title: "Run the tests",
        content: frameworkInstructions.run,
      });
    }
  }

  return {
    steps,
    requiresPercy: false,
    missingDependencies: [],
  };
}
