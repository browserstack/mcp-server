// What an App Automate run needs for App Accessibility checks to happen, and how the
// issues are read afterwards. Each point here cost a run that finished green with no
// scans and no warning; the SDK says nothing when it decides not to scan.
import {
  AppSDKSupportedLanguage,
  AppSDKSupportedTestingFramework,
  AppSDKSupportedTestingFrameworkEnum,
  createStep,
} from "../index.js";

const PYTEST_FIXTURE = `For pytest, create the driver in a fixture (\`conftest.py\`):
\`\`\`python
import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options  # XCUITestOptions for iOS


@pytest.fixture
def driver():
    options = UiAutomator2Options()
    drv = webdriver.Remote("https://hub.browserstack.com/wd/hub", options=options)
    yield drv
    drv.quit()
\`\`\``;

/**
 * The frameworks set up without a browserstack.yml whose setup here does not turn App
 * Accessibility on; guidance for a config that was never written would only mislead.
 */
const NOT_SET_UP: Partial<Record<AppSDKSupportedTestingFramework, string>> = {
  [AppSDKSupportedTestingFrameworkEnum.nightwatch]: "Nightwatch",
  [AppSDKSupportedTestingFrameworkEnum.cucumberRuby]: "Cucumber (Ruby)",
};

/** Says the checks were asked for but not set up, for a framework this setup leaves them off. */
export function getAppAccessibilityNotSetUpInstructions(
  testingFramework: AppSDKSupportedTestingFramework,
): string | undefined {
  const label = NOT_SET_UP[testingFramework];
  if (!label) return undefined;
  return createStep(
    "App Accessibility checks",
    `App Accessibility checks are not set up for ${label}: this setup does not turn them on for it, so these tests run without them. To check the app, set the tests up in another framework this tool supports, such as WebdriverIO, pytest, TestNG or JUnit, with accessibility: true.`,
  );
}

function driverAdvice(
  language: AppSDKSupportedLanguage,
  testingFramework: AppSDKSupportedTestingFramework,
): string {
  if (
    language === "python" &&
    testingFramework === AppSDKSupportedTestingFrameworkEnum.pytest
  ) {
    return PYTEST_FIXTURE;
  }
  return "Create the driver in your framework's setup hook (a fixture, `@BeforeMethod`, `@BeforeEach`, `SetUp`, `before`), not inside the test body.";
}

export function getAppAccessibilityChecksInstructions(
  language: AppSDKSupportedLanguage,
  testingFramework: AppSDKSupportedTestingFramework,
): string {
  return createStep(
    "App Accessibility checks: what makes a scan happen, and how to read the issues",
    `- The SDK decides per test, at the test's start, whether to scan, from the drivers that exist at that moment. A driver created inside the test body is never scanned. ${driverAdvice(language, testingFramework)}
- Scans run on interaction commands: click/tap, send keys, actions and navigation (such as back). Reads like \`find_elements\` or \`page_source\` do not scan. Interact with every screen state you want scanned.
- Android 11 or newer, or iOS 14 or newer, is required; older devices are skipped without an error.
- Under \`platforms\` write the OS version as \`osVersion\`, unquoted (\`osVersion: 14.0\`; not \`platformVersion\`, not \`"14.0"\`): with any other spelling the SDK still runs the tests but App Accessibility records no scans, without a message.
- When the run ends, the SDK prints the build id as \`testhub id: <id>\` (also the id in its automation.browserstack.com/builds/<id> link). Read the issues with \`fetchAccessibilityIssues\`, \`buildId: <id>\`; it waits while the report is still processing and links the report on the App Accessibility dashboard (https://app-accessibility.browserstack.com/automated-tests). If it reports no scans, it lists the likely causes.`,
  );
}
