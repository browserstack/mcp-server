// Percy + BrowserStack SDK instructions and utilities
import {
  SDKSupportedBrowserAutomationFramework,
  SDKSupportedLanguage,
  SDKSupportedTestingFramework,
} from "../common/types.js";
import { PERCY_INSTRUCTIONS } from "./frameworks.js";

// Retrieves Percy-specific instructions for a given language and framework
export function getPercyInstructions(
  language: SDKSupportedLanguage,
  automationFramework: SDKSupportedBrowserAutomationFramework,
  testingFramework: SDKSupportedTestingFramework,
): { instructions: string } | null {
  const langConfig = PERCY_INSTRUCTIONS[language];
  if (!langConfig) {
    return null;
  }

  const frameworkConfig = langConfig[automationFramework];
  if (!frameworkConfig) {
    return null;
  }

  const percyInstructions = frameworkConfig[testingFramework];
  if (!percyInstructions) {
    return null;
  }

  return percyInstructions;
}

// Formats the retrieved Percy instructions into a user-friendly string
export function formatPercyInstructions(instructions: {
  instructions: string;
}): string {
  return `---STEP--- Percy Visual Testing Setup
To enable visual testing with Percy, you need to make the following changes to your project configuration and test scripts.
${instructions.instructions}
`;
}
