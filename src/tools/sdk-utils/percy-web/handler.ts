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

  void percyToken;

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
    content: `Retrieve your project's token from the Percy dashboard (https://percy.io → Project Settings → Project Token), then set it locally:
        macOS/Linux:    export PERCY_TOKEN="<your Percy project token>"
        Windows (PS):   $env:PERCY_TOKEN="<your Percy project token>"
        Windows (CMD):  set PERCY_TOKEN=<your Percy project token>`,
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
