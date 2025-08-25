// Python instructions and commands for App SDK utilities
import {
  AppSDKSupportedTestingFramework,
  AppSDKSupportedTestingFrameworkEnum,
  createStep,
  createEnvStep,
  combineInstructions,
  PLATFORM_UTILS,
} from "../index.js";

export function getPythonAppInstructions(
  testingFramework: AppSDKSupportedTestingFramework,
): string {
  switch (testingFramework) {
    case AppSDKSupportedTestingFrameworkEnum.robot:
      return createStep(
        "Run your App Automate test suite with Robot Framework:",
        `\`\`\`bash
browserstack-sdk robot <path-to-test-files>
\`\`\``,
      );
    case AppSDKSupportedTestingFrameworkEnum.pytest:
      return createStep(
        "Run your App Automate test suite with Pytest:",
        `\`\`\`bash
browserstack-sdk pytest -s <file-name.py>
\`\`\``,
      );
    case AppSDKSupportedTestingFrameworkEnum.behave:
      return createStep(
        "Run your App Automate test suite with Behave:",
        `\`\`\`bash
browserstack-sdk behave <path-to-test-files>
\`\`\``,
      );
    case AppSDKSupportedTestingFrameworkEnum.lettuce:
      return createStep(
        "Run your test with Lettuce:",
        `\`\`\`bash
# Run using paver
paver run first_test
\`\`\``,
      );
    default:
      return "";
  }
}

export function getPythonSDKCommand(
  framework: string,
  username: string,
  accessKey: string,
): string {
  const { isWindows, getPlatformLabel } = PLATFORM_UTILS;

  switch (framework) {
    case "robot":
    case "pytest":
    case "behave":
      return getPythonCommonSDKCommand(
        username,
        accessKey,
        isWindows,
        getPlatformLabel(),
      );
    case "lettuce":
      return getLettuceCommand(
        username,
        accessKey,
        isWindows,
        getPlatformLabel(),
      );
    default:
      return "";
  }
}

function getPythonCommonSDKCommand(
  username: string,
  accessKey: string,
  isWindows: boolean,
  platformLabel: string,
): string {
  const envStep = createEnvStep(
    username,
    accessKey,
    isWindows,
    platformLabel,
    "Set your BrowserStack credentials as environment variables:",
  );

  const installStep = createStep(
    "Install BrowserStack Python SDK:",
    `\`\`\`bash
python3 -m pip install browserstack-sdk
\`\`\``,
  );

  const setupStep = createStep(
    "Set up BrowserStack SDK:",
    `\`\`\`bash
browserstack-sdk setup --username "${username}" --key "${accessKey}"
\`\`\``,
  );

  return combineInstructions(envStep, installStep, setupStep);
}

function getLettuceCommand(
  username: string,
  accessKey: string,
  isWindows: boolean,
  platformLabel: string,
): string {
  const envStep = createEnvStep(
    username,
    accessKey,
    isWindows,
    platformLabel,
    "Set your BrowserStack credentials as environment variables:",
  );

  const configStep = createStep(
    "Configure Appium's desired capabilities in config.json:",
    `**Android example:**
\`\`\`json
{
    "capabilities": {
      "browserstack.user" : "${username}",
      "browserstack.key" : "${accessKey}",
      "project": "First Lettuce Android Project",
      "build": "Lettuce Android",
      "name": "first_test",
      "browserstack.debug": true,
      "app": "bs://<app-id>",
      "device": "Google Pixel 3",
      "os_version": "9.0"
    }
}
\`\`\``,
  );

  const initStep = createStep(
    "Initialize remote WebDriver in terrain.py:",
    `\`\`\`python
# Initialize the remote Webdriver using BrowserStack remote URL
# and desired capabilities defined above
context.browser = webdriver.Remote(
    desired_capabilities=desired_capabilities,
    command_executor="https://hub-cloud.browserstack.com/wd/hub"
)
\`\`\``,
  );

  return combineInstructions(envStep, configStep, initStep);
}
