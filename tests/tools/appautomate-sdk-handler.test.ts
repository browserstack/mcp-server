import { beforeEach, describe, expect, it, vi } from "vitest";

// What setupBrowserStackAppAutomateTests tells the agent when App Accessibility checks are
// wanted: how the SDK decides to scan, and how to read the issues afterwards.

vi.mock("../../src/tools/sdk-utils/common/device-validator.js", () => ({
  validateAppAutomateDevices: vi.fn(async () => [
    { platform: "android", deviceName: "Google Pixel 8", osVersion: "14.0" },
  ]),
}));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
// The SDK instruction modules reach the server entry for its version; it must not start.
vi.mock("../../src/index.js", () => ({
  trackMCP: vi.fn(),
  PackageJsonVersion: "0.0.0",
}));

import { setupAppAutomateHandler } from "../../src/tools/appautomate-utils/appium-sdk/handler.js";

const CONFIG = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
} as any;

const PYTEST = {
  detectedFramework: "appium",
  detectedTestingFramework: "pytest",
  detectedLanguage: "python",
  devices: [],
  appPath: "./app.apk",
  project: "Checkout",
};

const text = (result: any) =>
  result.content.map((c: { text: string }) => c.text).join("\n");

describe("setupBrowserStackAppAutomateTests and App Accessibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says nothing about accessibility checks unless they are asked for", async () => {
    const body = text(await setupAppAutomateHandler(PYTEST, CONFIG));

    expect(body).toContain("accessibility: false");
    expect(body).not.toContain("App Accessibility checks");
    expect(body).not.toContain("fetchAccessibilityIssues");
  });

  it("turns the checks on and explains what makes a scan happen and how to read the issues", async () => {
    const body = text(
      await setupAppAutomateHandler({ ...PYTEST, accessibility: true }, CONFIG),
    );

    expect(body).toContain("accessibility: true");
    expect(body).toContain("App Accessibility checks");
    // The SDK enables scanning per test at its start, from the drivers that already exist.
    expect(body).toMatch(/fixture|setup hook/);
    // Scans run on interaction commands, not on reads.
    expect(body).toContain("click");
    expect(body).toContain("find_elements");
    expect(body).toContain("Android 11");
    expect(body).toContain("iOS 14");
    // The SDK's run summary carries the build id the issues are read by.
    expect(body).toContain("testhub id");
    expect(body).toContain("fetchAccessibilityIssues");
    expect(body).toContain("buildId");
  });

  it("gives a pytest fixture when the project uses pytest", async () => {
    const body = text(
      await setupAppAutomateHandler({ ...PYTEST, accessibility: true }, CONFIG),
    );

    expect(body).toContain("@pytest.fixture");
    expect(body).toContain("webdriver.Remote(");
  });
});

// Nightwatch and Cucumber (Ruby) are set up without a browserstack.yml, and this setup does
// not turn App Accessibility on for them, so the guidance for it would only mislead.
vi.mock("../../src/tools/appautomate-utils/native-execution/appautomate.js", () => ({
  uploadApp: vi.fn(async () => "bs://app-id"),
}));

describe.each([
  ["nightwatch", "nodejs", "Nightwatch"],
  ["cucumberRuby", "ruby", "Cucumber (Ruby)"],
])("App Accessibility asked for on %s", (testingFramework, language, label) => {
  it("says the checks are not set up rather than giving guidance for a config it did not write", async () => {
    const body = text(
      await setupAppAutomateHandler(
        { ...PYTEST, detectedTestingFramework: testingFramework, detectedLanguage: language, accessibility: true },
        CONFIG,
      ),
    );

    expect(body).toContain(`App Accessibility checks are not set up for ${label}`);
    expect(body).not.toContain("osVersion");
    expect(body).not.toContain("testhub id");
  });
});
