import { SUPPORTED_CONFIGURATIONS } from "./constants.js";
import { SDKSupportedLanguage } from "./types.js";
import { SDKSupportedBrowserAutomationFramework } from "./types.js";
import { SDKSupportedTestingFramework } from "./types.js";

const errorMessageSuffix =
  "Please open an issue at our Github repo: https://github.com/browserstack/browserstack-mcp-server/issues to request support for your project configuration";

export const getInstructionsForProjectConfiguration = (
  detectedBrowserAutomationFramework: SDKSupportedBrowserAutomationFramework,
  detectedTestingFramework: SDKSupportedTestingFramework,
  detectedLanguage: SDKSupportedLanguage,
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

  return configuration[detectedBrowserAutomationFramework][
    detectedTestingFramework
  ].instructions;
};

export function generateBrowserStackYMLInstructions(
  desiredPlatforms: string[],
) {
  return `
      Create a browserstack.yml file in the project root. The file should be in the following format:

      \`\`\`yaml
# ======================
# BrowserStack Reporting
# ======================
projectName: BrowserStack MCP Runs
build: mcp-run

# =======================================
# Platforms (Browsers / Devices to test)
# =======================================
# Platforms object contains all the browser / device combinations you want to test on.
# Generate this on the basis of the following platforms requested by the user:
# Requested platforms: ${desiredPlatforms}
platforms:
  - os: Windows
    osVersion: 11
    browserName: chrome
    browserVersion: latest
  
# =======================
# Parallels per Platform
# =======================
# The number of parallel threads to be used for each platform set.
# BrowserStack's SDK runner will select the best strategy based on the configured value
#
# Example 1 - If you have configured 3 platforms and set \`parallelsPerPlatform\` as 2, a total of 6 (2 * 3) parallel threads will be used on BrowserStack
#
# Example 2 - If you have configured 1 platform and set \`parallelsPerPlatform\` as 5, a total of 5 (1 * 5) parallel threads will be used on BrowserStack
parallelsPerPlatform: 1

browserstackLocal: true

# ===================
# Debugging features
# ===================
debug: true
testObservability: true
      \`\`\`
      \n`;
}
