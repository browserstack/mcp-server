import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateBrowserStackYMLInstructions } from "../../src/tools/sdk-utils/bstack/configUtils";
import { runBstackSDKOnly } from "../../src/tools/sdk-utils/bstack/sdkHandler";
import { validateDevices } from "../../src/tools/sdk-utils/common/device-validator";

vi.mock("../../src/tools/sdk-utils/common/device-validator", () => ({
  validateDevices: vi.fn().mockResolvedValue([
    {
      platform: "windows",
      osVersion: "11",
      browser: "chrome",
      browserVersion: "latest",
    },
  ]),
}));

const config = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
} as any;

const pytestSelenium = {
  projectName: "Checkout flow",
  detectedLanguage: "python",
  detectedBrowserAutomationFramework: "selenium",
  detectedTestingFramework: "pytest",
  devices: [],
} as const;

/** Every step's text, in order, as the tool returns it. */
async function run(input: Record<string, unknown>) {
  const result = await runBstackSDKOnly(input as any, config);
  return { result, text: result.steps.map((s) => s.content).join("\n") };
}

describe("browserstack.yml for a local or accessibility run", () => {
  it("runs a local run in this machine's Chrome, with no tunnel", () => {
    const yml = generateBrowserStackYMLInstructions({
      projectName: "Checkout flow",
      accessibility: true,
      runOnLocalBrowser: true,
    });

    expect(yml).toContain("browserstackAutomation: false");
    expect(yml).toMatch(/- browserName: chrome\n\s+browserVersion: latest/);
    expect(yml).toContain("browserstackLocal: false");
    expect(yml).toContain("accessibility: true");
    expect(yml).not.toContain("os: Windows");
  });

  it("turns accessibility on for a run on BrowserStack", () => {
    const yml = generateBrowserStackYMLInstructions({
      projectName: "Checkout flow",
      accessibility: true,
      platforms: ["windows"],
    });

    expect(yml).toContain("accessibility: true");
    expect(yml).toContain("browserstackLocal: true");
    expect(yml).not.toContain("browserstackAutomation");
  });

  it("leaves a plain run as it was", () => {
    const yml = generateBrowserStackYMLInstructions({
      projectName: "Checkout flow",
      platforms: ["windows"],
    });

    expect(yml).not.toContain("accessibility:");
    expect(yml).not.toContain("browserstackAutomation");
    expect(yml).toContain("browserstackLocal: true");
  });
});

describe("setupBrowserStackAutomateTests steps", () => {
  beforeEach(() => vi.mocked(validateDevices).mockClear());

  it("sets up a local accessibility run of a pytest flow", async () => {
    const { text } = await run({
      ...pytestSelenium,
      devices: [{ platform: "windows", osVersion: "11", browser: "chrome" }],
      accessibility: true,
      runOnLocalBrowser: true,
    });

    expect(validateDevices).not.toHaveBeenCalled();
    expect(text).toContain("no Automate session or license is used");
    expect(text).toContain("The devices requested are not used");
    expect(text).toContain("python3 -m pip install -U browserstack-sdk");
    expect(text).toContain("SE_FORCE_BROWSER_DOWNLOAD=true");
    expect(text).toContain("browserstackAutomation: false");

    // The flow's test comes before the scanned run, and the issues are read after it.
    const flowTest = text.indexOf("If there is no test yet for the flow");
    const runTests = text.indexOf("browserstack-sdk pytest");
    const readIssues = text.indexOf("fetchAccessibilityIssues");
    expect(flowTest).toBeGreaterThan(-1);
    expect(runTests).toBeGreaterThan(flowTest);
    expect(readIssues).toBeGreaterThan(runTests);
  });

  it("points a local Playwright run at Playwright's own Chromium", async () => {
    const { text } = await run({
      projectName: "Checkout flow",
      detectedLanguage: "nodejs",
      detectedBrowserAutomationFramework: "playwright",
      detectedTestingFramework: "playwright",
      devices: [],
      accessibility: true,
      runOnLocalBrowser: true,
    });

    expect(text).toContain("bundled Chromium");
    expect(text).toContain("1.73.2");
    expect(text).not.toContain("SE_FORCE_BROWSER_DOWNLOAD");
  });

  it("refuses a local run for a framework set up without browserstack.yml", async () => {
    const { result } = await run({
      projectName: "Checkout flow",
      detectedLanguage: "nodejs",
      detectedBrowserAutomationFramework: "cypress",
      detectedTestingFramework: "cypress",
      devices: [],
      runOnLocalBrowser: true,
    });

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].isError).toBe(true);
    expect(result.steps[0].content).toContain(
      "runOnLocalBrowser covers Selenium and Playwright tests",
    );
  });

  it("says where WebdriverIO turns accessibility on", async () => {
    const { text } = await run({
      projectName: "Checkout flow",
      detectedLanguage: "nodejs",
      detectedBrowserAutomationFramework: "webdriverio",
      detectedTestingFramework: "mocha",
      devices: [],
      accessibility: true,
    });

    expect(text).toContain(
      "add `accessibility: true` to the `browserstack` service options",
    );
    expect(text).toContain("fetchAccessibilityIssues");
  });

  it("adds nothing to a plain run on BrowserStack", async () => {
    const { text } = await run(pytestSelenium);

    expect(validateDevices).toHaveBeenCalled();
    expect(text).not.toContain("accessibility: true");
    expect(text).not.toContain("browserstackAutomation");
    expect(text).not.toContain("fetchAccessibilityIssues");
  });
});
