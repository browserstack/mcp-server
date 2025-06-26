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
  enablePercy: boolean = false,
) {
  let ymlContent = `
# ======================
# BrowserStack Reporting
# ======================
# A single name for your project to organize all your tests. This is required for Percy.
projectName: BrowserStack Sample
# A name for the group of tests you are running
buildName: mcp-run

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

# =================
# Local Testing
# =================
# Set to true to test local
browserstackLocal: true

# ===================
# Debugging features
# ===================
debug: true # Visual logs, text logs, etc.
testObservability: true # For Test Observability`;

  if (enablePercy) {
    ymlContent += `

# =====================
# Percy Visual Testing
# =====================
# Set percy to true to enable visual testing.
# Set percyCaptureMode to 'manual' to control when screenshots are taken.
percy: true
percyCaptureMode: manual`;
  }
  return `
      Create a browserstack.yml file in the project root. The file should be in the following format:

      \`\`\`yaml${ymlContent}
      \`\`\`
      \n`;
}

export function formatInstructionsWithNumbers(
  instructionText: string,
  separator: string = "---STEP---",
): string {
  // Split the instructions by the separator
  const steps = instructionText
    .split(separator)
    .map((step) => step.trim())
    .filter((step) => step.length > 0);

  // If no separators found, treat the entire text as one step
  if (steps.length === 1 && !instructionText.includes(separator)) {
    return `**Step 1:**\n${instructionText.trim()}\n\n**✅ Verification:**\nPlease verify that you have completed all the steps above to ensure proper setup.`;
  }

  // Format each step with numbering
  const formattedSteps = steps
    .map((step, index) => {
      return `**Step ${index + 1}:**\n${step.trim()}`;
    })
    .join("\n\n");

  // Add verification statement at the end
  const verificationText = `\n\n**✅ Verification:**\nPlease verify that you have completed all ${steps.length} steps above to ensure proper setup. If you encounter any issues, double-check each step and ensure all commands executed successfully.`;

  return formattedSteps + verificationText;
}
