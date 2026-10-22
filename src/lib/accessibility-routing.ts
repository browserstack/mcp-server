/**
 * Which product checks what for accessibility, said once to every client, since the tools
 * alone do not tell an agent that a web page and a mobile app are scanned differently.
 */
export const ACCESSIBILITY_ROUTING_INSTRUCTION =
  "Accessibility checks: a web page or site → startAccessibilityScan (Website Scanner); a multi-step web flow → Automate tests with `accessibility: true` in browserstack.yml (setupBrowserStackAutomateTests); a mobile app → its tests on App Automate with accessibility on (setupBrowserStackAppAutomateTests, or runAppTestsOnBrowserStack for Espresso/XCUITest). Then read the issues with fetchAccessibilityIssues.";
