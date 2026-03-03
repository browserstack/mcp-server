import { ConfigMapping } from "../common/types.js";
import * as constants from "./constants.js";

export const SUPPORTED_CONFIGURATIONS: ConfigMapping = {
  python: {
    playwright: {
      pytest: { instructions: constants.pythonInstructions },
    },
    selenium: {
      pytest: { instructions: constants.pytestInstructions },
      robot: { instructions: constants.robotInstructions },
      behave: { instructions: constants.behaveInstructions },
    },
  },
  java: {
    playwright: {
      junit4: { instructions: constants.javaInstructions },
      junit5: { instructions: constants.javaInstructions },
      testng: { instructions: constants.javaInstructions },
    },
    selenium: {
      testng: { instructions: constants.javaInstructions },
      cucumber: { instructions: constants.javaInstructions },
      junit4: { instructions: constants.javaInstructions },
      junit5: { instructions: constants.javaInstructions },
    },
  },
  csharp: {
    playwright: {
      nunit: { instructions: constants.csharpPlaywrightCommonInstructions },
      mstest: { instructions: constants.csharpPlaywrightCommonInstructions },
    },
    selenium: {
      xunit: { instructions: constants.csharpCommonInstructions },
      nunit: { instructions: constants.csharpCommonInstructions },
      mstest: { instructions: constants.csharpCommonInstructions },
      specflow: { instructions: constants.csharpCommonInstructions },
      reqnroll: { instructions: constants.csharpCommonInstructions },
    },
  },
  nodejs: {
    playwright: {
      jest: { instructions: constants.nodejsInstructions },
      codeceptjs: { instructions: constants.nodejsInstructions },
      playwright: { instructions: constants.nodejsInstructions },
    },
    selenium: {
      jest: { instructions: constants.nodejsInstructions },
      mocha: { instructions: constants.nodejsInstructions },
      cucumber: { instructions: constants.nodejsInstructions },
      nightwatch: { instructions: constants.nodejsInstructions },
      codeceptjs: { instructions: constants.nodejsInstructions },
    },
    cypress: {
      cypress: { instructions: constants.cypressInstructions },
    },
    webdriverio: {
      mocha: { instructions: constants.webdriverioInstructions },
      cucumber: { instructions: constants.webdriverioInstructions },
    },
  },
};
