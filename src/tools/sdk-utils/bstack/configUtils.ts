import { ValidatedEnvironment } from "../common/device-validator.js";

// browserstackAutomation: false runs the tests in a browser on this machine; the SDK loads its
// accessibility scanner into that browser, so no Automate session (or license) is used.
const LOCAL_BROWSER_AUTOMATION = `
# Run the tests in a browser on this machine instead of on BrowserStack:
# no Automate session is used.
browserstackAutomation: false
`;

// A local run drives this machine's Chrome, so there is one platform and no device to pick.
// browserVersion has to stay: without it SDK 1.51.2 still scans every page, but reports the test
// as not an accessibility test, so none of its issues reach the dashboard.
const LOCAL_BROWSER_PLATFORM = `  - browserName: chrome
    browserVersion: latest # required: without it no accessibility results are saved`;

export function generateBrowserStackYMLInstructions(config: {
  validatedEnvironments?: ValidatedEnvironment[];
  platforms?: string[];
  enablePercy?: boolean;
  accessibility?: boolean;
  runOnLocalBrowser?: boolean;
  projectName: string;
}): string {
  const enablePercy = config.enablePercy || false;
  const runOnLocalBrowser = config.runOnLocalBrowser || false;
  const projectName = config.projectName || "BrowserStack Automate Build";

  // Generate platform configurations using the utility function
  const platformConfigs = runOnLocalBrowser
    ? LOCAL_BROWSER_PLATFORM
    : generatePlatformConfigs(config);

  const stepTitle =
    "Create a browserstack.yml file in the project root with your validated device configurations:If already exists, update it with the following content for devices and project details.";

  const buildName = `${projectName}-Build`;

  let ymlContent = `
# ======================
# BrowserStack Reporting
# ======================

userName: <your_browserstack_username>
accessKey: <your_browserstack_access_key>

# TODO: Replace these sample values with your actual project details
projectName: ${projectName}
buildName: ${buildName}
${runOnLocalBrowser ? LOCAL_BROWSER_AUTOMATION : ""}
# =======================================
# Platforms (Browsers / Devices to test)
# =======================================`;

  ymlContent += `
# Platforms object contains all the browser / device combinations you want to test on.
platforms:
${platformConfigs}`;

  ymlContent += `

# =======================
# Parallels per Platform
# =======================
# The number of parallel threads to be used for each platform set.
# BrowserStack's SDK runner will select the best strategy based on the configured value
# The number of parallel threads to be used for each platform set.
parallelsPerPlatform: 1

# =================
# Local Testing
# =================
${
  runOnLocalBrowser
    ? `# Not needed: the local browser reaches localhost and private sites directly
browserstackLocal: false`
    : `# Set to true to test local
browserstackLocal: true`
}

# ===================
# Debugging features
# ===================
debug: true # Visual logs, text logs, etc.
testObservability: true # For Test Observability`;

  if (config.accessibility) {
    ymlContent += `

# ========================
# Accessibility Automation
# ========================
# Scans every page state the tests drive for accessibility issues.
accessibility: true`;
  }

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
---STEP---
${stepTitle}

\`\`\`yaml${ymlContent}
\`\`\`
\n`;
}

function generatePlatformConfigs(config: {
  validatedEnvironments?: ValidatedEnvironment[];
  platforms?: string[];
}): string {
  if (config.validatedEnvironments && config.validatedEnvironments.length > 0) {
    // Generate platforms array from validated environments
    const platforms = config.validatedEnvironments.map((env) => {
      if (env.platform === "windows" || env.platform === "macos") {
        // Desktop configuration
        return {
          os: env.platform === "windows" ? "Windows" : "OS X",
          osVersion: env.osVersion,
          browserName: env.browser,
          browserVersion: env.browserVersion || "latest",
        };
      } else {
        // Mobile configuration (android/ios)
        return {
          deviceName: env.deviceName,
          osVersion: env.osVersion,
          browserName: env.browser,
        };
      }
    });

    // Convert platforms to YAML format
    return platforms
      .map((platform) => {
        if (platform.deviceName) {
          // Mobile platform
          return `  - deviceName: "${platform.deviceName}"
    osVersion: "${platform.osVersion}"
    browserName: ${platform.browserName}`;
        } else {
          // Desktop platform
          return `  - os: ${platform.os}
    osVersion: "${platform.osVersion}"
    browserName: ${platform.browserName}
    browserVersion: ${platform.browserVersion}`;
        }
      })
      .join("\n");
  } else if (config.platforms && config.platforms.length > 0) {
    // Fallback to default platforms configuration
    return `  - os: Windows
    osVersion: 11
    browserName: chrome
    browserVersion: latest`;
  }

  return "";
}
