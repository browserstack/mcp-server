import { ConfigMapping } from "./types.js";
import * as constants from "./constants.js";

export const PERCY_INSTRUCTIONS: ConfigMapping = {
  java: {
    selenium: {
      testng: { instructions: constants.javaSeleniumInstructions },
      cucumber: { instructions: constants.javaSeleniumInstructions },
      junit4: { instructions: constants.javaSeleniumInstructions },
      junit5: { instructions: constants.javaSeleniumInstructions },
    },
  },
  csharp: {
    selenium: {
      nunit: { instructions: constants.csharpSeleniumInstructions },
    },
  },
  nodejs: {
    selenium: {
      mocha: { instructions: constants.nodejsSeleniumInstructions },
      jest: { instructions: constants.nodejsSeleniumInstructions },
      webdriverio: { instructions: constants.webdriverioPercyInstructions },
    },
  },
};
