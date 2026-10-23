import { beforeEach, describe, expect, it, vi } from "vitest";

// The device a native (Espresso / XCUITest) run asks App Automate for. App Automate lists
// devices with versions such as "14.0"; a run requested as "14" must be sent as "14.0", or it
// waits for a device that never matches and fails after about an hour.

const m = vi.hoisted(() => ({
  triggerEspressoBuild: vi.fn(),
  triggerXcuiBuild: vi.fn(),
}));

vi.mock("../../src/lib/device-cache.js", () => ({
  BrowserStackProducts: { APP_AUTOMATE: "app_automate" },
  getDevicesAndBrowsers: vi.fn().mockResolvedValue({
    mobile: [
      {
        os: "android",
        devices: [
          { display_name: "Google Pixel 8", os_version: "14.0" },
          { display_name: "Google Pixel 8 Pro", os_version: "14.0" },
        ],
      },
      {
        os: "ios",
        devices: [
          { display_name: "iPhone 15", os_version: "17.0" },
          { display_name: "iPhone 15", os_version: "18.0" },
        ],
      },
    ],
  }),
}));
vi.mock(
  "../../src/tools/appautomate-utils/native-execution/appautomate.js",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    uploadEspressoApp: vi.fn().mockResolvedValue("bs://app"),
    uploadEspressoTestSuite: vi.fn().mockResolvedValue("bs://suite"),
    uploadXcuiApp: vi.fn().mockResolvedValue("bs://app"),
    uploadXcuiTestSuite: vi.fn().mockResolvedValue("bs://suite"),
    triggerEspressoBuild: m.triggerEspressoBuild,
    triggerXcuiBuild: m.triggerXcuiBuild,
  }),
);
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/index.js", () => ({ trackMCP: vi.fn(), PackageJsonVersion: "0.0.0" }));

import addAppAutomationTools from "../../src/tools/appautomate.js";

function runTests() {
  let handler: (args: any) => Promise<any> = async () => undefined;
  const server: any = {
    tool: vi.fn((...args: any[]) => {
      if (args[0] === "runAppTestsOnBrowserStack") handler = args[args.length - 1];
    }),
    server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
  };
  addAppAutomationTools(server, {
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  } as any);
  return handler;
}

const RUN = {
  appPath: "./app.apk",
  testSuitePath: "./suite.apk",
  project: "Checkout",
};

describe("runAppTestsOnBrowserStack devices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.triggerEspressoBuild.mockResolvedValue("espresso-build");
    m.triggerXcuiBuild.mockResolvedValue("xcui-build");
  });

  it("asks for an Espresso device in App Automate's own name and version", async () => {
    const result = await runTests()({
      ...RUN,
      detectedAutomationFramework: "espresso",
      devices: [{ platform: "android", deviceName: "google pixel 8", osVersion: "14" }],
    });

    expect(result.isError).toBeFalsy();
    expect(m.triggerEspressoBuild).toHaveBeenCalledWith(
      "bs://app",
      "bs://suite",
      ["Google Pixel 8-14.0"],
      "Checkout",
      expect.anything(),
      expect.anything(),
    );
  });

  it("asks for an XCUITest device in App Automate's own version", async () => {
    await runTests()({
      ...RUN,
      appPath: "./app.ipa",
      testSuitePath: "./suite.zip",
      detectedAutomationFramework: "xcuitest",
      devices: [{ platform: "ios", deviceName: "iPhone 15", osVersion: "17" }],
    });

    expect(m.triggerXcuiBuild).toHaveBeenCalledWith(
      "bs://app",
      "bs://suite",
      ["iPhone 15-17.0"],
      "Checkout",
      expect.anything(),
      expect.anything(),
    );
  });

  it("still sends no devices when none were asked for", async () => {
    await runTests()({ ...RUN, detectedAutomationFramework: "espresso", devices: [] });

    expect(m.triggerEspressoBuild).toHaveBeenCalledWith(
      "bs://app",
      "bs://suite",
      [],
      "Checkout",
      expect.anything(),
      expect.anything(),
    );
  });
});
