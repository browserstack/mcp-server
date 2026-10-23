/**
 * Which product checks what for accessibility, said once to every client, since the tools
 * alone do not tell an agent that a web page and a mobile app are scanned differently. An
 * app with no tests is a path too: the agent writes them, in the user's choice of framework.
 */
export const ACCESSIBILITY_ROUTING_INSTRUCTION =
  "Accessibility checks: a web page or site → startAccessibilityScan (Website Scanner); a multi-step web flow → Automate tests with `accessibility: true` in browserstack.yml (setupBrowserStackAutomateTests); a mobile app → its tests on App Automate with accessibility on (setupBrowserStackAppAutomateTests for Appium, runAppTestsOnBrowserStack for Espresso/XCUITest). An app with no tests yet: offer to write them, in the framework the user picks (Appium in any language the SDK supports, Espresso or XCUITest); if they leave it to you, pick one and say which. Then read the issues with fetchAccessibilityIssues.";
