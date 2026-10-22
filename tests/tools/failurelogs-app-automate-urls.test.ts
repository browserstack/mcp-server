import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient } from "../../src/lib/apiClient";
import {
  retrieveDeviceLogs,
  retrieveAppiumLogs,
  retrieveCrashLogs,
} from "../../src/tools/failurelogs-utils/app-automate";

vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn(() => "user:key"),
}));

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
} as any;

const base =
  "https://api.browserstack.com/app-automate/builds/build123/sessions/session456";

describe("App Automate log endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // The REST API routes are case-sensitive: /deviceLogs returns a 404.
  it.each([
    ["device", retrieveDeviceLogs, `${base}/devicelogs`],
    ["appium", retrieveAppiumLogs, `${base}/appiumlogs`],
    ["crash", retrieveCrashLogs, `${base}/crashlogs`],
  ])("requests the lowercase %s logs path", async (_, retrieve, url) => {
    const get = vi
      .spyOn(apiClient, "get")
      .mockResolvedValue({ ok: true, status: 200, data: "" } as any);

    await retrieve("session456", "build123", config);

    expect(get).toHaveBeenCalledWith(expect.objectContaining({ url }));
  });
});
