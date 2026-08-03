import {
  APP_DEVICE_CONFIGS,
  AppSDKSupportedTestingFrameworkEnum,
  DEFAULT_APP_PATH,
  USERNAME_PLACEHOLDER,
  ACCESS_KEY_PLACEHOLDER,
  createStep,
} from "./index.js";
import { ValidatedEnvironment } from "../../sdk-utils/common/device-validator.js";

export function generateAppBrowserStackYMLInstructions(
  config: {
    validatedEnvironments?: ValidatedEnvironment[];
    platforms?: string[];
    testingFramework?: string;
    projectName?: string;
  },
  appPath: string = DEFAULT_APP_PATH,
): string {
  if (
    config.testingFramework ===
      AppSDKSupportedTestingFrameworkEnum.nightwatch ||
    config.testingFramework ===
      AppSDKSupportedTestingFrameworkEnum.webdriverio ||
    config.testingFramework === AppSDKSupportedTestingFrameworkEnum.cucumberRuby
  ) {
    return "";
  }

  const platformConfigs = generatePlatformConfigs(config);

  const projectName = config.projectName || "BrowserStack Sample";
  const buildName = config.projectName
    ? `${config.projectName}-AppAutomate-Build`
    : "bstack-demo";

  const configContent = `\`\`\`yaml
userName: ${USERNAME_PLACEHOLDER}
accessKey: ${ACCESS_KEY_PLACEHOLDER}
app: ${appPath}
platforms:
${platformConfigs}
parallelsPerPlatform: 1
browserstackLocal: true
// TODO: replace projectName and buildName according to actual project
projectName: ${projectName}
buildName: ${buildName}
debug: true
networkLogs: true
percy: false
percyCaptureMode: auto
accessibility: false
\`\`\`

**Important notes:**
- Replace \`app: ${appPath}\` with the path to your actual app file (e.g., \`./SampleApp.apk\` for Android or \`./SampleApp.ipa\` for iOS)
- You can upload your app using BrowserStack's App Upload API or manually through the dashboard
- Set \`browserstackLocal: true\` if you need to test with local/staging servers
- Adjust \`parallelsPerPlatform\` based on your subscription limits`;

  const stepTitle =
    "Update browserstack.yml file with App Automate configuration:";

  const stepDescription = `Create or update the browserstack.yml file in your project root with the following content:
  ${configContent}`;

  return createStep(stepTitle, stepDescription);
}

function generatePlatformConfigs(config: {
  validatedEnvironments?: ValidatedEnvironment[];
  platforms?: string[];
}): string {
  if (config.validatedEnvironments && config.validatedEnvironments.length > 0) {
    return config.validatedEnvironments
      .filter((env) => env.platform === "android" || env.platform === "ios")
      .map((env) => {
        return `  - platformName: ${env.platform}
    deviceName: "${env.deviceName}"
    platformVersion: "${env.osVersion}"`;
      })
      .join("\n");
  } else if (config.platforms && config.platforms.length > 0) {
    return config.platforms
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
  }

  return "";
}
