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
import {
  FLOW_TEST_STEP,
  FRAMEWORK_ACCESSIBILITY_SETTING,
  READ_ACCESSIBILITY_ISSUES_STEP,
  localBrowser,
  localRunIntro,
  localRunUnsupported,
  localSdkVersion,
} from "./localRunSteps.js";

function instruction(title: string, content: string): RunTestsStep {
  return { type: "instruction", title, content };
}

export async function runBstackSDKOnly(
  input: RunTestsOnBrowserStackInput,
  // Retained for tool-handler signature stability (callers pass the per-request
  // config); setup instructions no longer embed credentials, so it is unused here.
  config: BrowserStackConfig,
  isPercyAutomate = false,
): Promise<RunTestsInstructionResult> {
  void config;
  const accessibility = input.accessibility === true;
  const runOnLocalBrowser = input.runOnLocalBrowser === true;
  const framework = input.detectedBrowserAutomationFramework;

  if (
    runOnLocalBrowser &&
    (framework === "cypress" || framework === "webdriverio")
  ) {
    return {
      steps: [
        {
          type: "error",
          title: "Local run not supported",
          content: localRunUnsupported(framework),
          isError: true,
        },
      ],
      requiresPercy: false,
      missingDependencies: [],
    };
  }

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

  // A local run has one browser, this machine's Chrome, so there are no devices to validate.
  const validatedEnvironments = runOnLocalBrowser
    ? []
    : await validateDevices(
        tupleTargets,
        input.detectedBrowserAutomationFramework,
      );

  if (runOnLocalBrowser) {
    steps.push(
      instruction(
        "Run in a local browser",
        localRunIntro(tupleTargets.length > 0),
      ),
    );
  }

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

      if (accessibility) {
        steps.push(
          instruction(
            "Turn on accessibility checks",
            `---STEP---\n${FRAMEWORK_ACCESSIBILITY_SETTING[framework]}`,
          ),
        );
      }

      if (frameworkInstructions.run && !isPercyAutomate) {
        steps.push({
          type: "instruction",
          title: "Run the tests",
          content: frameworkInstructions.run,
        });
      }
    }

    if (accessibility) {
      steps.push(
        instruction(
          "Read the accessibility issues",
          READ_ACCESSIBILITY_ISSUES_STEP,
        ),
      );
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

  if (runOnLocalBrowser) {
    const sdkVersion = localSdkVersion(
      input.detectedLanguage as SDKSupportedLanguage,
    );
    if (sdkVersion) {
      steps.push(instruction("SDK version for a local run", sdkVersion));
    }
    steps.push(instruction("Browser for a local run", localBrowser(framework)));
  }

  const ymlInstructions = generateBrowserStackYMLInstructions({
    validatedEnvironments,
    enablePercy: false,
    accessibility,
    runOnLocalBrowser,
    projectName: input.projectName,
  });

  if (ymlInstructions) {
    steps.push({
      type: "instruction",
      title: "Configure browserstack.yml",
      content: ymlInstructions,
    });
  }

  if (accessibility) {
    steps.push(instruction("Write a test for the flow", FLOW_TEST_STEP));
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

  if (accessibility) {
    steps.push(
      instruction(
        "Read the accessibility issues",
        READ_ACCESSIBILITY_ISSUES_STEP,
      ),
    );
  }

  return {
    steps,
    requiresPercy: false,
    missingDependencies: [],
  };
}
