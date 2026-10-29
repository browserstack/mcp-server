import { describe, it, expect, vi } from "vitest";

async function baseUrl(region: string | undefined, o11yBaseUrl: string) {
  vi.resetModules();
  vi.doMock("../../src/config", () => ({
    __esModule: true,
    default: { O11Y_TFA_RCA_BASE_URL: o11yBaseUrl },
  }));
  const { getO11yBaseUrl } = await import(
    "../../src/tools/tfa-rca-utils/constants"
  );
  const { withAccountRegion } = await import("../../src/lib/region-context");
  return withAccountRegion(region as any, () => getO11yBaseUrl());
}

const DEFAULT = "https://api-automation.browserstack.com";

describe("getO11yBaseUrl", () => {
  it.each([undefined, "us", "unknown"])(
    "keeps the US host when the region is %s",
    async (region) => {
      expect(await baseUrl(region, DEFAULT)).toBe(DEFAULT);
    },
  );

  it.each([
    ["eu", "https://api-automation-eu.browserstack.com"],
    ["in", "https://api-automation-in.browserstack.com"],
  ])("follows the %s region", async (region, host) => {
    expect(await baseUrl(region, DEFAULT)).toBe(host);
  });

  it("lets an explicit O11Y_TFA_RCA_BASE_URL win", async () => {
    const staging = "https://api-observability-rengg-tfa.bsstag.com";
    expect(await baseUrl("eu", staging)).toBe(staging);
  });
});
