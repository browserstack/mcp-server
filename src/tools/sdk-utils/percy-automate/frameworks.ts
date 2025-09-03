import { ConfigMapping } from "./types.js";
import * as instructions from "./constants.js";

export const SUPPORTED_CONFIGURATIONS: ConfigMapping = {
  python: {
    selenium: {
      pytest: {
        instructions: instructions.pythonPytestSeleniumInstructions,
      },
    },
    playwright: {
      pytest: {
        instructions: instructions.pythonPytestPlaywrightInstructions,
      },
    },
  },
  java: {
    playwright: {
      junit: { instructions: instructions.javaPlaywrightJunitInstructions },
    },
  },
  nodejs: {
    selenium: {
      mocha: { instructions: instructions.mochaPercyAutomateInstructions },
      jest: { instructions: instructions.jestPercyAutomateInstructions },
      webdriverio: {
        instructions: instructions.webdriverioPercyAutomateInstructions,
      },
      testcafe: {
        instructions: instructions.testcafePercyAutomateInstructions,
      },
    },
    playwright: {
      mocha: { instructions: instructions.mochaPercyPlaywrightInstructions },
      jest: { instructions: instructions.jestPercyAutomateInstructions },
    },
  },
};

/**
 * Utility function to check if a given language, driver, and testing framework
 * are supported by Percy Automate.
 * This now expects the structure: language -> driver -> framework
 */
export function isPercyAutomateFrameworkSupported(
  language: string,
  driver: string,
  framework: string,
): boolean {
  const languageConfig =
    SUPPORTED_CONFIGURATIONS[language as keyof typeof SUPPORTED_CONFIGURATIONS];
  if (!languageConfig) return false;
  const driverConfig = languageConfig[driver as keyof typeof languageConfig];
  if (!driverConfig) return false;
  return !!driverConfig[framework as keyof typeof driverConfig];
}
