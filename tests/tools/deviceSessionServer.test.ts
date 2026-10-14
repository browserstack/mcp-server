import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/instrumentation", () => ({
  trackMCP: vi.fn(),
  withToolCall: (_n: string, fn: any) => fn(),
}));

import { BrowserStackMcpServer } from "../../src/server-factory";

// Tools that shipped before the device-session work. Adding the new groups must
// leave every one of them registered under the same name.
const EXISTING = [
  "runAppLiveSession",
  "runBrowserLiveSession",
  "takeAppScreenshot",
  "runAppTestsOnBrowserStack",
  "setupBrowserStackAppAutomateTests",
  "setupBrowserStackAutomateTests",
  "getFailureLogs",
  "fetchAutomationScreenshots",
  "listSessions",
  "listTestIds",
  "fetchRCA",
  "fetchSelfHealedSelectors",
  "createTestCase",
  "createLCASteps",
  "startAccessibilityScan",
];

const ADDED = [
  "listMobileDevices",
  "uploadMobileApp",
  "listUploadedApps",
  "getAppAutomatePlan",
  "startDeviceSession",
  "getDeviceSession",
  "endDeviceSession",
  "takeDeviceScreenshot",
  "readDeviceScreen",
  "tapOnDevice",
  "typeOnDevice",
  "swipeOnDevice",
  "pressDeviceKey",
  "manageDeviceApp",
  "uninstallDeviceApp",
  "setDeviceState",
  "uploadMediaFile",
  "listDedicatedDevices",
  "getTeamDefaultDevices",
  "simulateBiometric",
  "runAdbShellCommand",
  "pushFileToDevice",
  "pullFileFromDevice",
  "injectCameraImage",
  "setDeviceLocation",
  "setNetworkConditions",
  "listBrowsers",
  "getAutomatePlan",
  "startBrowserSession",
  "getBrowserSession",
  "endBrowserSession",
  "navigateBrowser",
  "clickInBrowser",
  "typeInBrowser",
  "scrollBrowser",
  "switchBrowserContext",
  "takeBrowserScreenshot",
  "readBrowserPage",
];

describe("server factory with device session tools", () => {
  it("keeps existing tools and adds the new groups without name clashes", () => {
    // McpServer throws on a duplicate tool name, so constructing is itself the clash check.
    const server = new BrowserStackMcpServer({
      "browserstack-username": "u",
      "browserstack-access-key": "k",
    });
    const names = Object.keys(server.getTools());
    for (const name of [...EXISTING, ...ADDED]) {
      expect(names, name).toContain(name);
    }
  });
});
