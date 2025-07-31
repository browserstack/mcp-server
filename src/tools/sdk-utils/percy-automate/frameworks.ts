import { ConfigMapping } from "./types.js";
import * as instructions from "./constants.js";

export const SUPPORTED_CONFIGURATIONS: ConfigMapping = {
  python: {
    pytest: {
      instructions: instructions.pythonPytestPercyAutomateInstructions,
    },
  },
  javascript: {
    cypress: { instructions: instructions.jsCypressPercyAutomateInstructions },
    mocha: { instructions: instructions.mochaPercyAutomateInstructions },
    jest: { instructions: instructions.jestPercyAutomateInstructions },
    webdriverio: {
      instructions: instructions.webdriverioPercyAutomateInstructions,
    },
    testcafe: { instructions: instructions.testcafePercyAutomateInstructions },
  },
  java: {
    testng: { instructions: instructions.testngPercyAutomateInstructions },
  },
};

/**
 * Utility function to check if a given language and testing framework
 * are supported by Percy Automate.
 */
export function isPercyAutomateFrameworkSupported(
  language: string,
  framework: string,
): boolean {
  const languageConfig =
    SUPPORTED_CONFIGURATIONS[language as keyof typeof SUPPORTED_CONFIGURATIONS];
  if (!languageConfig) return false;
  return !!languageConfig[framework as keyof typeof languageConfig];
}
