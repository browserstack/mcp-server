import { beforeEach, describe, expect, it, vi, Mock } from "vitest";
import { startBrowserSession } from "../../src/tools/live-utils/start-session";
import { getDevicesAndBrowsers } from "../../src/lib/device-cache";
import * as local from "../../src/lib/local";

vi.mock("../../src/lib/device-cache", () => ({
  getDevicesAndBrowsers: vi.fn(),
  BrowserStackProducts: { LIVE: "live" },
}));
vi.mock("../../src/lib/local", () => ({
  isLocalURL: vi.fn(),
  ensureLocalBinarySetup: vi.fn(),
  killExistingBrowserStackLocalProcesses: vi.fn(),
}));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("user:key"),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const config = {} as any;

const mobileData = {
  mobile: [
    {
      os: "ios",
      devices: [
        { display_name: "iPhone 15 Pro", os_version: "27 Beta" },
        { display_name: "iPhone 15 Pro", os_version: "17.0" },
        { display_name: "iPhone 17", os_version: "27 Beta" },
      ],
    },
    {
      os: "android",
      devices: [
        { display_name: "Google Pixel 9", os_version: "16 Beta" },
        { display_name: "Google Pixel 9", os_version: "15.0" },
      ],
    },
  ],
};

function mobileArgs(overrides: Record<string, string>) {
  return {
    platformType: "mobile" as const,
    url: "https://example.com",
    os: "ios",
    osVersion: "latest",
    device: "iPhone 15 Pro",
    browser: "safari",
    ...overrides,
  };
}

function osVersionIn(result: string): string | null {
  const url = result.match(/https:\/\/live\.browserstack\.com\/dashboard#\S+/);
  if (!url) return null;
  return new URLSearchParams(url[0].split("#")[1]).get("os_version");
}

describe("startBrowserSession (mobile os_version)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDevicesAndBrowsers as Mock).mockResolvedValue(mobileData);
    (local.isLocalURL as Mock).mockReturnValue(false);
    (local.killExistingBrowserStackLocalProcesses as Mock).mockResolvedValue(
      undefined,
    );
  });

  it("resolves 'latest' to the newest stable version", async () => {
    const result = await startBrowserSession(mobileArgs({}), config);
    expect(osVersionIn(result)).toBe("17.0");
  });

  it("does not fall back to a pre-release build for an unavailable version", async () => {
    const result = await startBrowserSession(
      mobileArgs({ osVersion: "26" }),
      config,
    );
    expect(osVersionIn(result)).toBe("17.0");
    expect(result).toContain("Os version 26 was not found. Using 17.0 instead.");
  });

  it("sends a pre-release iOS build as <major>.0, not the cache label", async () => {
    const result = await startBrowserSession(
      mobileArgs({ osVersion: "27" }),
      config,
    );
    expect(osVersionIn(result)).toBe("27.0");
    expect(result).not.toContain("os_version=27+Beta");
    expect(result).not.toContain("os_version=27%20Beta");
  });

  it("sends a pre-release Android build as <major>.0 too", async () => {
    const result = await startBrowserSession(
      mobileArgs({
        os: "android",
        device: "Google Pixel 9",
        osVersion: "16",
        browser: "chrome",
      }),
      config,
    );
    expect(osVersionIn(result)).toBe("16.0");
  });

  it("leaves a stable version untouched", async () => {
    const result = await startBrowserSession(
      mobileArgs({ osVersion: "17.0" }),
      config,
    );
    expect(osVersionIn(result)).toBe("17.0");
  });
});
