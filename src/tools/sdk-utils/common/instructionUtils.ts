/**
 * Core instruction configuration utilities for runTestsOnBrowserStack tool.
 */

import { SUPPORTED_CONFIGURATIONS } from "../bstack/frameworks.js";
import {
  SDKSupportedLanguage,
  SDKSupportedBrowserAutomationFramework,
  SDKSupportedTestingFramework,
} from "./types.js";

const errorMessageSuffix =
  "Please open an issue at our Github repo: https://github.com/browserstack/browserstack-mcp-server/issues to request support for your project configuration";

export const getInstructionsForProjectConfiguration = (
  detectedBrowserAutomationFramework: SDKSupportedBrowserAutomationFramework,
  detectedTestingFramework: SDKSupportedTestingFramework,
  detectedLanguage: SDKSupportedLanguage,
  username: string,
  accessKey: string,
) => {
  const configuration = SUPPORTED_CONFIGURATIONS[detectedLanguage];

  if (!configuration) {
    throw new Error(
      `BrowserStack MCP Server currently does not support ${detectedLanguage}, ${errorMessageSuffix}`,
    );
  }

  if (!configuration[detectedBrowserAutomationFramework]) {
    throw new Error(
      `BrowserStack MCP Server currently does not support ${detectedBrowserAutomationFramework} for ${detectedLanguage}, ${errorMessageSuffix}`,
    );
  }

  if (
    !configuration[detectedBrowserAutomationFramework][detectedTestingFramework]
  ) {
    throw new Error(
      `BrowserStack MCP Server currently does not support ${detectedTestingFramework} for ${detectedBrowserAutomationFramework} on ${detectedLanguage}, ${errorMessageSuffix}`,
    );
  }

  const instructionFunction =
    configuration[detectedBrowserAutomationFramework][detectedTestingFramework]
      .instructions;

  return instructionFunction(username, accessKey);
};
