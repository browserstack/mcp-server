// Configuration utilities for BrowserStack App SDK
import {
  APP_DEVICE_CONFIGS,
  AppSDKSupportedTestingFrameworkEnum,
  DEFAULT_APP_PATH,
  createStep,
} from "./index.js";

export function generateAppBrowserStackYMLInstructions(
  platforms: string[],
  username: string,
  accessKey: string,
  appPath: string = DEFAULT_APP_PATH,
  testingFramework: string,
): string {
  if (
    testingFramework === AppSDKSupportedTestingFrameworkEnum.nightwatch ||
    testingFramework === AppSDKSupportedTestingFrameworkEnum.webdriverio ||
    testingFramework === AppSDKSupportedTestingFrameworkEnum.cucumberRuby
  ) {
    return "";
  }

  // Generate platform and device configurations
  const platformConfigs = platforms
    .map((platform) => {
      const devices =
        APP_DEVICE_CONFIGS[platform as keyof typeof APP_DEVICE_CONFIGS];
      if (!devices) return "";

      return devices
        .map(
          (device) => `  - platformName: ${platform}
    deviceName: ${device.deviceName}
    platformVersion: "${device.platformVersion}"`,
        )
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");

  // Construct YAML content
  const configContent = `\`\`\`yaml
userName: ${username}
accessKey: ${accessKey}
app: ${appPath}
platforms:
${platformConfigs}

# Parallels per Platform
# Default: 1
parallelsPerPlatform: 1

# Local Testing
# Set to true if you need to test apps with local/staging servers
# Default: false
browserstackLocal: true

# Project and build names help organize your test runs in BrowserStack dashboard and Percy.
# TODO: Replace these sample values with your actual project details
buildName: bstack-demo
projectName: BrowserStack Sample

# Debugging features
# debug: Provides screenshots and logs (Default: true)
# networkLogs: Capture API/network traffic (Default: false)
debug: true
networkLogs: true

# Percy Visual Testing (Default: false)
percy: false
percyCaptureMode: auto

# Accessibility Testing (Default: false)
accessibility: false

# Optional settings (uncomment only if explicitly required)
# geoLocation: "US"          # Simulate tests from a specific region
# timezone: "New_York"       # Run tests in a custom timezone
# retryOnFailure: 2          # Retries failed tests (Default: 0)
# idleTimeout: 30            # Max idle time in seconds (Default: 30, Range: 0-300)
# commandTimeout: 180        # Max time to wait for a command (Default: 180)
# deviceOrientation: portrait # For mobile, choose portrait or landscape (Default: portrait)
\`\`\`

**Important notes:**
- Replace \`app: ${appPath}\` with the path to your actual app file (e.g., \`./SampleApp.apk\` for Android or \`./SampleApp.ipa\` for iOS).
- You can upload your app using BrowserStack's App Upload API or manually through the dashboard.
- Adjust \`parallelsPerPlatform\` based on your subscription limits`;

  // Return formatted step for instructions
  return createStep(
    "Update browserstack.yml file with App Automate configuration:",
    `Create or update the browserstack.yml file in your project root with the following content:

${configContent}`,
  );
}
