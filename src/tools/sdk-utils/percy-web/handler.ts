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

  // SECURITY: percyToken is intentionally NOT interpolated into any returned
  // step content. The token is fetched from a privileged BrowserStack backend
  // and echoing it in tool output would expose it across a trust boundary
  // (HackerOne #3576387). The parameter is retained for upstream compatibility.
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

  // Prepend a step to set the Percy token in the environment.
  // Placeholder-only — never emit the real token here.
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
