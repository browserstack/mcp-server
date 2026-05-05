import { RunTestsInstructionResult, RunTestsStep } from "../common/types.js";
import { SetUpPercyInput } from "../common/schema.js";
import { SUPPORTED_CONFIGURATIONS } from "./frameworks.js";
import { SDKSupportedLanguage } from "../common/types.js";

export function runPercyAutomateOnly(
  input: SetUpPercyInput,
): RunTestsInstructionResult {
  const steps: RunTestsStep[] = [];

  // Assume configuration is supported due to guardrails at orchestration layer
  const languageConfig =
    SUPPORTED_CONFIGURATIONS[input.detectedLanguage as SDKSupportedLanguage];
  const driverConfig = languageConfig[input.detectedBrowserAutomationFramework];
  const testingFrameworkConfig = driverConfig
    ? driverConfig[input.detectedTestingFramework]
    : undefined;

  // Generate instructions for the supported configuration with project name
  const instructions = testingFrameworkConfig
    ? testingFrameworkConfig.instructions
    : "";

  // Prepend a step to set the Percy token in the environment
  steps.push({
    type: "instruction",
    title: "Set Percy Token in Environment",
    content: `Retrieve your project's token from the Percy dashboard (https://percy.io → Project Settings → Project Token) and add it to your project's .env file (PERCY_TOKEN=<your Percy project token>) or export it in your shell (e.g. export PERCY_TOKEN="<your Percy project token>"). Do not paste the token into chat or commit it.`,
  });

  steps.push({
    type: "instruction",
    title: `Percy Automate Setup for ${input.detectedLanguage} with ${input.detectedTestingFramework}`,
    content: instructions,
  });

  return {
    steps,
    requiresPercy: true,
    missingDependencies: [],
  };
}
