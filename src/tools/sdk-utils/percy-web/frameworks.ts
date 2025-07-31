import { ConfigMapping } from "./types.js";
import * as constants from "./constants.js";

export const SUPPORTED_CONFIGURATIONS: ConfigMapping = {
  python: {
    selenium: { instructions: constants.pythonInstructions },
    playwright: { instructions: constants.pythonPlaywrightInstructions },
  },
  javascript: {
    selenium: { instructions: constants.nodejsInstructions },
    playwright: { instructions: constants.jsPlaywrightInstructions },
  },
  java: {
    selenium: { instructions: constants.javaInstructions },
    playwright: { instructions: constants.javaPlaywrightInstructions },
  },
  ruby: {
    selenium: { instructions: constants.rubyInstructions },
  },
  csharp: {
    selenium: { instructions: constants.csharpInstructions },
    playwright: { instructions: constants.csharpPlaywrightInstructions },
  },
};

/**
 * Utility function to check if a given language and testing framework
 * are supported by Percy Web.
 */
export function isPercyWebFrameworkSupported(
  language: string,
  framework: string,
): boolean {
  const languageConfig =
    SUPPORTED_CONFIGURATIONS[language as keyof typeof SUPPORTED_CONFIGURATIONS];
  if (!languageConfig) return false;
  return !!languageConfig[framework as keyof typeof languageConfig];
}
