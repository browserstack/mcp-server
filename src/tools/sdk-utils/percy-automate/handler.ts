import { RunTestsInstructionResult, RunTestsStep } from "../common/types.js";
import { SetUpPercyInput } from "../common/schema.js";
import { SUPPORTED_CONFIGURATIONS } from "./frameworks.js";
import { SDKSupportedLanguage } from "../common/types.js";

export function runPercyAutomateOnly(
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
  const driverConfig = languageConfig[input.detectedBrowserAutomationFramework];
  const testingFrameworkConfig = driverConfig
    ? driverConfig[input.detectedTestingFramework]
    : undefined;

  // Generate instructions for the supported configuration with project name
  const instructions = testingFrameworkConfig
    ? testingFrameworkConfig.instructions
    : "";

  // Prepend a step to set the Percy token in the environment.
  // Placeholder-only — never emit the real token here.
  steps.push({
    type: "instruction",
    title: "Set Percy Token in Environment",
    content: `Retrieve your project's token from the Percy dashboard (https://percy.io → Project Settings → Project Token), then set PERCY_TOKEN in your environment (e.g. export PERCY_TOKEN="<your Percy project token>"). Do not paste the token into chat or commit it.`,
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
