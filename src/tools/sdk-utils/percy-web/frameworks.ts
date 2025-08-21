import { ConfigMapping } from "./types.js";
import * as constants from "./constants.js";

export const SUPPORTED_CONFIGURATIONS: ConfigMapping = {
  python: {
    selenium: {
      instructions: constants.pythonInstructions,
      snapshotInstruction: constants.pythonInstructionsSnapshot,
    },
    playwright: {
      instructions: constants.pythonPlaywrightInstructions,
      snapshotInstruction: constants.pythonPlaywrightInstructionsSnapshot,
    },
  },
  nodejs: {
    selenium: {
      instructions: constants.nodejsInstructions,
      snapshotInstruction: constants.nodejsInstructionsSnapshot,
    },
    playwright: {
      instructions: constants.nodejsPlaywrightInstructions,
      snapshotInstruction: constants.nodejsPlaywrightInstructionsSnapshot,
    },
    webdriverio: {
      instructions: constants.nodejsWebdriverioInstructions,
      snapshotInstruction: constants.nodejsWebdriverioInstructionsSnapshot,
    },
    ember: {
      instructions: constants.nodejsEmberInstructions,
      snapshotInstruction: constants.nodejsEmberInstructionsSnapshot,
    },
    cypress: {
      instructions: constants.nodejsCypressInstructions,
      snapshotInstruction: constants.nodejsCypressInstructionsSnapshot,
    },
    puppeteer: {
      instructions: constants.nodejsPuppeteerInstructions,
      snapshotInstruction: constants.nodejsPuppeteerInstructionsSnapshot,
    },
    nightmare: {
      instructions: constants.nodejsNightmareInstructions,
      snapshotInstruction: constants.nodejsNightmareInstructionsSnapshot,
    },
    nightwatch: {
      instructions: constants.nodejsNightwatchInstructions,
      snapshotInstruction: constants.nodejsNightwatchInstructionsSnapshot,
    },
    protractor: {
      instructions: constants.nodejsProtractorInstructions,
      snapshotInstruction: constants.nodejsProtractorInstructionsSnapshot,
    },
    testcafe: {
      instructions: constants.nodejsTestcafeInstructions,
      snapshotInstruction: constants.nodejsTestcafeInstructionsSnapshot,
    },
    gatsby: {
      instructions: constants.nodejsGatsbyInstructions,
      snapshotInstruction: constants.nodejsGatsbyInstructionsSnapshot,
    },
    storybook: {
      instructions: constants.nodejsStorybookInstructions,
      snapshotInstruction: constants.nodejsStorybookInstructionsSnapshot,
    },
  },
  java: {
    selenium: {
      instructions: constants.javaInstructions,
      snapshotInstruction: constants.javaInstructionsSnapshot,
    },
    playwright: {
      instructions: constants.javaPlaywrightInstructions,
      snapshotInstruction: constants.javaPlaywrightInstructionsSnapshot,
    },
  },
  ruby: {
    selenium: {
      instructions: constants.rubyInstructions,
      snapshotInstruction: constants.rubyInstructionsSnapshot,
    },
    capybara: {
      instructions: constants.rubyCapybaraInstructions,
      snapshotInstruction: constants.rubyCapybaraInstructionsSnapshot,
    },
  },
  csharp: {
    selenium: {
      instructions: constants.csharpInstructions,
      snapshotInstruction: constants.csharpInstructionsSnapshot,
    },
    playwright: {
      instructions: constants.csharpPlaywrightInstructions,
      snapshotInstruction: constants.csharpPlaywrightInstructionsSnapshot,
    },
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
