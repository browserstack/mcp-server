// Steps for the two modes setupBrowserStackAutomateTests adds to a plain BrowserStack run:
// accessibility (the SDK scans every page state the tests drive) and a local browser
// (browserstackAutomation: false: the tests drive Chrome on the user's machine, so no Automate
// session or license is used). Both were run end to end with the Python SDK against
// bstackdemo.com; the local run found the same issues as the same test on BrowserStack.

import { SDKSupportedLanguage } from "../common/types.js";

/**
 * Cypress and WebdriverIO are set up through their own config files, not browserstack.yml, and
 * BrowserStack documents a local accessibility run for neither, so a local run is refused for
 * them rather than half-configured.
 */
export function localRunUnsupported(framework: string): string {
  return (
    `runOnLocalBrowser covers Selenium and Playwright tests, which the BrowserStack SDK sets up ` +
    `through browserstack.yml. For ${framework}, run the tests on BrowserStack instead ` +
    `(runOnLocalBrowser off), or set up a Selenium or Playwright test for the flow.`
  );
}

/** Where a Cypress or WebdriverIO suite turns accessibility on, as BrowserStack's setup guides put it. */
export const FRAMEWORK_ACCESSIBILITY_SETTING: Record<string, string> = {
  cypress: `Turn on accessibility checks: in \`browserstack.json\`, add \`"accessibility": true\` to \`run_settings\`.`,
  webdriverio: `Turn on accessibility checks: in \`wdio.conf.js\`, add \`accessibility: true\` to the \`browserstack\` service options.`,
};

export function localRunIntro(devicesRequested: boolean): string {
  const devices = devicesRequested
    ? " The devices requested are not used: a local run has one browser, this machine's Chrome."
    : "";
  return `---STEP---
These tests run in Chrome on this machine, not on BrowserStack (\`browserstackAutomation: false\` below), so no Automate session or license is used. The SDK loads its accessibility scanner into that browser itself; nothing has to be installed in the browser.${devices}`;
}

/**
 * Local runs keep getting SDK fixes, so each language takes its latest SDK. Node names a floor:
 * 1.73.2 fixed "accessibility scans timing out for Playwright tests run in a local browser".
 * Python 1.51.2 (the latest on PyPI) is the release the local run was checked with.
 */
const LOCAL_RUN_SDK: Partial<Record<SDKSupportedLanguage, string>> = {
  python: `If the BrowserStack SDK was already installed, upgrade it: local runs depend on recent fixes.
\`\`\`bash
python3 -m pip install -U browserstack-sdk
\`\`\``,
  nodejs: `Use browserstack-node-sdk 1.73.2 or later; earlier releases do not scan reliably in a local browser:
\`\`\`bash
npm i -D browserstack-node-sdk@latest
\`\`\``,
  java: "Use the latest browserstack-java-sdk (the LATEST version above).",
  csharp: "Use the latest BrowserStack.TestAdapter package.",
};

export function localSdkVersion(language: SDKSupportedLanguage): string {
  const content = LOCAL_RUN_SDK[language];
  return content ? `---STEP---\n${content}` : "";
}

/**
 * Chrome 142 and later block the extension the SDK loads, so the run needs a browser that still
 * takes one: Chrome for Testing for Selenium, Playwright's full Chromium for Playwright. Playwright's
 * default headless browser is a "headless shell" that takes no extension either: a local run on it
 * reported every scan as succeeded, ~10 s each, and saved a report with no issues.
 */
export function localBrowser(framework: string): string {
  if (framework === "playwright") {
    return `---STEP---
Run Playwright on its full Chromium: set \`channel: "chromium"\` in the \`use\` block of playwright.config (and install it with \`npx playwright install chromium\`). Playwright's default headless shell cannot load the accessibility scanner, so its scans come back empty; branded Chrome and Edge 142 and later (\`channel: "chrome"\` / \`"msedge"\`) block it too.`;
  }
  return `---STEP---
Run on Chrome for Testing: installed Chrome 142 and later blocks the accessibility scanner. Set this before the test run, and Selenium Manager downloads Chrome for Testing and uses it in place of the installed Chrome; the test code does not change:
\`\`\`bash
export SE_FORCE_BROWSER_DOWNLOAD=true
\`\`\`
(Windows PowerShell: \`$env:SE_FORCE_BROWSER_DOWNLOAD="true"\`)`;
}

/**
 * A user who asks for a flow's accessibility issues often has no test for it. Getting the test to
 * pass with the plain test command first keeps each try to seconds, where a scanned run takes
 * minutes and a report a few more to process.
 */
export const FLOW_TEST_STEP = `---STEP---
If there is no test yet for the flow the user wants checked, write one: a single test that opens the start URL and performs each step of the flow in order, waiting for each page or element before acting on it. Read any login the site needs from environment variables, never from the file. Get it passing with the plain test command (without the BrowserStack SDK) before the run below: each try then takes seconds instead of a full scanned run. Give the test a timeout of several minutes (e.g. 10): in the scanned run every action waits for a scan of a few seconds, so Playwright's default 30-second test timeout fails.`;

export const READ_ACCESSIBILITY_ISSUES_STEP = `---STEP---
Read the accessibility issues. When the run ends, the SDK prints a line like \`Visit https://accessibility.browserstack.com/automated-tests/...?thBuildId=<id> to view accessibility report\`. Pass that thBuildId as buildId to fetchAccessibilityIssues; it waits while the report finishes processing (a few minutes). Run the tests with the same BrowserStack account this MCP server uses, or the build is not found.`;
