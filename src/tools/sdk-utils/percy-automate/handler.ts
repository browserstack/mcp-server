import { RunTestsInstructionResult, RunTestsStep } from "../common/types.js";
import { SetUpPercyInput } from "../common/schema.js";
import { SUPPORTED_CONFIGURATIONS } from "./frameworks.js";
import { SDKSupportedLanguage } from "../common/types.js";

export function runPercyAutomateOnly(
  input: SetUpPercyInput,
  percyToken: string,
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
    content: `---STEP---Set the environment variable generated for your project before running your tests:\n\nexport PERCY_TOKEN="${percyToken}"\n\n(For Windows, use 'setx PERCY_TOKEN "${percyToken}"' or 'set PERCY_TOKEN=${percyToken}' as appropriate.)---STEP---`,
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
