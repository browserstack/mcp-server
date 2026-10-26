// Handler for BrowserStack SDK only (no Percy) - Sets up BrowserStack SDK with YML configuration
import { RunTestsInstructionResult, RunTestsStep } from "../common/types.js";
import { RunTestsOnBrowserStackInput } from "../common/schema.js";
import { getSDKPrefixCommand } from "./commands.js";
import { generateBrowserStackYMLInstructions } from "./configUtils.js";
import { getInstructionsForProjectConfiguration } from "../common/instructionUtils.js";
import { CREDENTIALS_SUBSTITUTION_NOTE } from "../common/credentials.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { validateDevices } from "../common/device-validator.js";
import {
  SDKSupportedBrowserAutomationFramework,
  SDKSupportedTestingFramework,
  SDKSupportedLanguage,
} from "../common/types.js";

export async function runBstackSDKOnly(
  input: RunTestsOnBrowserStackInput,
  // Retained for tool-handler signature stability (callers pass the per-request
  // config); setup instructions no longer embed credentials, so it is unused here.
  config: BrowserStackConfig,
  isPercyAutomate = false,
): Promise<RunTestsInstructionResult> {
  void config;
  const steps: RunTestsStep[] = [
    {
      type: "instruction",
      title: "Set your BrowserStack credentials",
      content: CREDENTIALS_SUBSTITUTION_NOTE,
    },
  ];

  const tupleTargets: Array<Array<string>> =
    input.devices?.map((device) => {
      const platform = device.platform.toLowerCase();
      if (platform === "windows" || platform === "macos") {
        // Desktop: ["platform", "osVersion", "browser", "browserVersion"]
        return [
          platform,
          device.osVersion || "latest",
          device.browser || "",
          device.browserVersion || "latest",
        ];
      } else {
        // Mobile: ["platform", "deviceName", "osVersion", "browser"]
        return [
          platform,
          device.deviceName || "",
          device.osVersion || "latest",
          device.browser || "",
        ];
      }
    }) || [];

  const validatedEnvironments = await validateDevices(
    tupleTargets,
    input.detectedBrowserAutomationFramework,
  );

  // Handle frameworks with unique setup instructions that don't use browserstack.yml
  if (
    input.detectedBrowserAutomationFramework === "cypress" ||
    input.detectedBrowserAutomationFramework === "webdriverio"
  ) {
    const frameworkInstructions = getInstructionsForProjectConfiguration(
      input.detectedBrowserAutomationFramework as SDKSupportedBrowserAutomationFramework,
      input.detectedTestingFramework as SDKSupportedTestingFramework,
      input.detectedLanguage as SDKSupportedLanguage,
    );

    if (frameworkInstructions) {
      if (frameworkInstructions.setup) {
        steps.push({
          type: "instruction",
          title: "Framework-Specific Setup",
          content: frameworkInstructions.setup,
        });
      }

      // Neither framework reads browserstack.yml: each turns accessibility on in its own file.
      if (input.accessibility) {
        steps.push({
          type: "instruction",
          title: "Turn on Accessibility Testing",
          content:
            input.detectedBrowserAutomationFramework === "cypress"
              ? 'In browserstack.json, add "accessibility": true under run_settings, keeping the file\'s other settings. It runs Accessibility (WCAG) checks on the pages the tests visit.'
              : "In your WebdriverIO config, add accessibility: true to the browserstack service's options (services: [['browserstack', { accessibility: true, ... }]]), keeping its other options. It runs Accessibility (WCAG) checks on the pages the tests visit.",
        });
      }

      if (frameworkInstructions.run && !isPercyAutomate) {
        steps.push({
          type: "instruction",
          title: "Run the tests",
          content: frameworkInstructions.run,
        });
      }

      if (input.accessibility) {
        steps.push({
          type: "instruction",
          title: "Read the accessibility issues",
          content:
            "When the run finishes, read its accessibility issues with fetchAccessibilityIssues: pass the Automate build's dashboard link, printed during the run, as reportUrl.",
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

  const ymlInstructions = generateBrowserStackYMLInstructions({
    validatedEnvironments,
    enablePercy: false,
    projectName: input.projectName,
    accessibility: input.accessibility,
  });

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

  if (input.accessibility) {
    steps.push({
      type: "instruction",
      title: "Read the accessibility issues",
      content:
        "When the run finishes, read its accessibility issues with fetchAccessibilityIssues: pass the Automate build's dashboard link as reportUrl, or the build id the BrowserStack SDK prints at the end of the run as buildId.",
    });
  }

  return {
    steps,
    requiresPercy: false,
    missingDependencies: [],
  };
}
