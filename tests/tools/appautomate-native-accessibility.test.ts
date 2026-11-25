import { beforeEach, describe, expect, it, vi } from "vitest";

// runAppTestsOnBrowserStack with App Accessibility on: the build API gets the flag, and the
// answer says how the issues are read once the build finishes.

const m = vi.hoisted(() => ({
  post: vi.fn(),
  triggerEspressoBuild: vi.fn(),
  triggerXcuiBuild: vi.fn(),
}));

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn(), post: m.post },
}));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/index.js", () => ({
  trackMCP: vi.fn(),
  PackageJsonVersion: "0.0.0",
}));
vi.mock("webdriverio", () => ({ remote: vi.fn() }));
vi.mock("../../src/tools/sdk-utils/common/device-validator.js", () => ({
  validateAppAutomateDevices: vi.fn(async () => []),
}));

import {
  triggerEspressoBuild,
  triggerXcuiBuild,
} from "../../src/tools/appautomate-utils/native-execution/appautomate.js";

const CONFIG = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
} as any;

describe("native build requests and App Accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.post.mockResolvedValue({ data: { build_id: "b1" } });
  });

  it.each([
    ["Espresso", triggerEspressoBuild],
    ["XCUITest", triggerXcuiBuild],
  ])("asks for accessibility checks on an %s build when wanted", async (_f, trigger) => {
    await trigger("bs://app", "bs://suite", ["Google Pixel 8-14.0"], "p", CONFIG, {
      accessibility: true,
    });

    expect(m.post.mock.calls[0][0].body).toMatchObject({
      app: "bs://app",
      testSuite: "bs://suite",
      accessibility: true,
    });
  });

  // Espresso App Accessibility reports need Test Observability on; XCUITest's do not.
  it("turns Test Observability on with accessibility for Espresso, as its reports need it", async () => {
    await triggerEspressoBuild("bs://app", "bs://suite", ["Google Pixel 8-14.0"], "p", CONFIG, {
      accessibility: true,
    });

    expect(m.post.mock.calls[0][0].body).toMatchObject({
      accessibility: true,
      testObservability: true,
    });
  });

  it("leaves Test Observability alone for XCUITest", async () => {
    await triggerXcuiBuild("bs://app", "bs://suite", ["iPhone 15-17.0"], "p", CONFIG, {
      accessibility: true,
    });

    expect(m.post.mock.calls[0][0].body).not.toHaveProperty("testObservability");
  });

  it.each([
    ["Espresso", triggerEspressoBuild],
    ["XCUITest", triggerXcuiBuild],
  ])("sends no accessibility flag on an %s build by default", async (_f, trigger) => {
    await trigger("bs://app", "bs://suite", ["Google Pixel 8-14.0"], "p", CONFIG);

    expect(m.post.mock.calls[0][0].body).not.toHaveProperty("accessibility");
  });
});

describe("runAppTestsOnBrowserStack and App Accessibility", () => {
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    m.post.mockResolvedValue({ data: { build_id: "b1" } });
    const { default: addAppAutomationTools } = await import(
      "../../src/tools/appautomate.js"
    );
    handlers = {};
    const server: any = {
      tool: vi.fn((...args: any[]) => {
        handlers[args[0]] = args[args.length - 1];
      }),
      server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
    };
    addAppAutomationTools(server, CONFIG);
  });

  const run = (extra: Record<string, unknown>) =>
    handlers.runAppTestsOnBrowserStack({
      browserstackAppUrl: "bs://app",
      browserstackTestSuiteUrl: "bs://suite",
      devices: [{ platform: "android", deviceName: "Google Pixel 8", osVersion: "14.0" }],
      project: "p",
      detectedAutomationFramework: "espresso",
      ...extra,
    });

  it("tells the agent how to read the issues once the build finishes", async () => {
    const result = await run({ accessibility: true });

    const body = result.content.map((c: any) => c.text).join("\n");
    expect(m.post.mock.calls[0][0].body).toMatchObject({ accessibility: true });
    expect(body).toContain("Build ID: b1");
    expect(body).toContain("App Accessibility checks are on");
    expect(body).toContain("fetchAccessibilityIssues");
    expect(body).toContain("reportUrl: https://app-automate.browserstack.com/builds/b1");
  });

  it("says an Espresso suite must be built with BrowserStack's Gradle plugin and SDK to be scanned", async () => {
    const result = await run({ accessibility: true });

    const body = result.content.map((c: any) => c.text).join("\n");
    expect(body).toContain("com.browserstack.gradle-tool");
    expect(body).toContain("browserstack-java-sdk");
  });

  it("says it turns Test Observability on for an Espresso build with the checks", async () => {
    const result = await run({ accessibility: true });

    const body = result.content.map((c: any) => c.text).join("\n");
    expect(m.post.mock.calls[0][0].body).toMatchObject({ testObservability: true });
    expect(body).toContain("Test Observability is turned on for the build");
  });

  it("says an XCUITest suite must embed and initialize the BrowserStack Swift SDK to be scanned", async () => {
    const result = await run({
      accessibility: true,
      detectedAutomationFramework: "xcuitest",
      devices: [{ platform: "ios", deviceName: "iPhone 15", osVersion: "17.0" }],
    });

    const body = result.content.map((c: any) => c.text).join("\n");
    expect(body).toContain("BrowserstackSwiftSDK");
    expect(body).not.toContain("gradle");
  });

  it("says nothing about accessibility when it was not asked for", async () => {
    const result = await run({});

    const body = result.content.map((c: any) => c.text).join("\n");
    expect(m.post.mock.calls[0][0].body).not.toHaveProperty("accessibility");
    expect(body).not.toContain("fetchAccessibilityIssues");
  });
});

// Screen Reader Automation rides on the same build request: App Automate forwards
// accessibilityOptions to the accessibility run when accessibility is on.
describe("Screen Reader Automation on native builds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.post.mockResolvedValue({ data: { build_id: "b1" } });
  });

  it.each([
    ["Espresso", triggerEspressoBuild],
    ["XCUITest", triggerXcuiBuild],
  ])("asks for a Screen Reader report on an %s build", async (_f, trigger) => {
    await trigger("bs://app", "bs://suite", ["Google Pixel 8-14.0"], "p", CONFIG, {
      accessibility: true,
      screenReader: {},
    });

    expect(m.post.mock.calls[0][0].body).toMatchObject({
      accessibility: true,
      accessibilityOptions: { screenReaderAutomation: { autoReport: true } },
    });
    expect(
      m.post.mock.calls[0][0].body.accessibilityOptions.screenReaderAutomation,
    ).not.toHaveProperty("linearNavigation");
  });

  it("adds linear navigation with its timeout when asked", async () => {
    await triggerEspressoBuild("bs://app", "bs://suite", ["Google Pixel 8-14.0"], "p", CONFIG, {
      accessibility: true,
      screenReader: { linearNavigation: true },
    });

    expect(m.post.mock.calls[0][0].body.accessibilityOptions).toEqual({
      screenReaderAutomation: {
        autoReport: true,
        linearNavigation: true,
        linearNavigationTimeout: 300000,
      },
    });
  });

  it("sends no screen reader options without accessibility", async () => {
    await triggerEspressoBuild("bs://app", "bs://suite", ["Google Pixel 8-14.0"], "p", CONFIG, {
      screenReader: {},
    });

    expect(m.post.mock.calls[0][0].body).not.toHaveProperty("accessibilityOptions");
  });
});

describe("runAppTestsOnBrowserStack and Screen Reader Automation", () => {
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    m.post.mockResolvedValue({ data: { build_id: "b1" } });
    const { default: addAppAutomationTools } = await import(
      "../../src/tools/appautomate.js"
    );
    handlers = {};
    const server: any = {
      tool: vi.fn((...args: any[]) => {
        handlers[args[0]] = args[args.length - 1];
      }),
      server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
    };
    addAppAutomationTools(server, CONFIG);
  });

  const run = (extra: Record<string, unknown>) =>
    handlers.runAppTestsOnBrowserStack({
      browserstackAppUrl: "bs://app",
      browserstackTestSuiteUrl: "bs://suite",
      devices: [{ platform: "android", deviceName: "Google Pixel 8", osVersion: "14.0" }],
      project: "p",
      detectedAutomationFramework: "espresso",
      ...extra,
    });

  it("turns the accessibility checks on with the screen reader, which needs them", async () => {
    await run({ screenReader: true });

    expect(m.post.mock.calls[0][0].body).toMatchObject({
      accessibility: true,
      accessibilityOptions: { screenReaderAutomation: { autoReport: true } },
    });
  });

  it("passes linear navigation through", async () => {
    await run({ screenReader: true, screenReaderLinearNavigation: true });

    expect(
      m.post.mock.calls[0][0].body.accessibilityOptions.screenReaderAutomation,
    ).toMatchObject({ linearNavigation: true });
  });

  it("turns the screen reader on when only linear navigation is asked for", async () => {
    await run({ screenReaderLinearNavigation: true });

    const body = m.post.mock.calls[0][0].body;
    expect(body.accessibility).toBe(true);
    expect(body.accessibilityOptions.screenReaderAutomation).toMatchObject({
      autoReport: true,
      linearNavigation: true,
    });
  });

  it("tells the agent where the Screen Reader report lands and what it needs", async () => {
    const result = await run({ screenReader: true });

    const body = result.content.map((c: any) => c.text).join("\n");
    expect(body).toContain("Screen Reader Automation is on");
    expect(body).toContain("list_app_accessibility_screen_reader_builds");
    expect(body).toMatch(/plan/);
  });

  it("keeps the argument descriptions within budget", async () => {
    const { RUN_APP_AUTOMATE_SCHEMA } = await import(
      "../../src/tools/appautomate-utils/native-execution/constants.js"
    );
    for (const key of ["screenReader", "screenReaderLinearNavigation"]) {
      const description = (RUN_APP_AUTOMATE_SCHEMA as any)[key].description ?? "";
      expect(description.length, key).toBeGreaterThan(0);
      expect(description.length, key).toBeLessThanOrEqual(60);
    }
  });
});

// A native suite records App Accessibility scans only when it was built with BrowserStack's
// instrumentation; saying so where the agent chooses the flag lets it check before a run
// that would otherwise finish, 10 to 20 minutes later, with no scans.
describe("the accessibility flag's description", () => {
  it("names the SDK the suite must be built with, within the argument budget", async () => {
    const { RUN_APP_AUTOMATE_SCHEMA } = await import(
      "../../src/tools/appautomate-utils/native-execution/constants.js"
    );
    const description = RUN_APP_AUTOMATE_SCHEMA.accessibility.description ?? "";

    expect(description).toMatch(/BrowserStack's SDK/);
    expect(description.length).toBeLessThanOrEqual(120);
  });
});
