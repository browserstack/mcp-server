// Handler for Percy Web only mode - Visual testing without BrowserStack infrastructure
import { RunTestsInstructionResult, RunTestsStep } from "../common/types.js";
import { SetUpPercyInput } from "../common/schema.js";
import { SUPPORTED_CONFIGURATIONS } from "./frameworks.js";

import {
  SDKSupportedBrowserAutomationFramework,
  SDKSupportedLanguage,
} from "../common/types.js";

export let percyWebSetupInstructions = "";

export function runPercyWeb(
  input: SetUpPercyInput,
  percyToken: string,
): RunTestsInstructionResult {
  const steps: RunTestsStep[] = [];

  // Assume configuration is supported due to guardrails at orchestration layer
  const languageConfig =
    SUPPORTED_CONFIGURATIONS[input.detectedLanguage as SDKSupportedLanguage];
  const frameworkConfig =
    languageConfig[
      input.detectedBrowserAutomationFramework as SDKSupportedBrowserAutomationFramework
    ];

  // Generate instructions for the supported configuration
  const instructions = frameworkConfig.instructions;
  percyWebSetupInstructions = frameworkConfig.snapshotInstruction;

  // Prepend a step to set the Percy token in the environment
  steps.push({
    type: "instruction",
    title: "Set Percy Token in Environment",
    content: `---STEP---Set the environment variable generated for your project before running your tests:\n\nexport PERCY_TOKEN="${percyToken}"\n\n(For Windows, use 'setx PERCY_TOKEN "${percyToken}"' or 'set PERCY_TOKEN=${percyToken}' as appropriate.)---STEP---`,
  });

  steps.push({
    type: "instruction",
    title: `Percy Web Setup Instructions`,
    content: instructions,
  });

  return {
    steps,
    requiresPercy: true,
    missingDependencies: [],
  };
}
