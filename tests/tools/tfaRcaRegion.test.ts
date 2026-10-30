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
  it.each([undefined, "us", "in"])(
    "keeps the US host when the region is %s",
    async (region) => {
      expect(await baseUrl(region, DEFAULT)).toBe(DEFAULT);
    },
  );

  it("refuses to pick a host when the region is unknown", async () => {
    await expect(baseUrl("unknown", DEFAULT)).rejects.toThrow(
      /Could not confirm your BrowserStack account's region/,
    );
  });

  it("follows the eu region", async () => {
    expect(await baseUrl("eu", DEFAULT)).toBe(
      "https://api-automation-eu.browserstack.com",
    );
  });

  it("lets an explicit O11Y_TFA_RCA_BASE_URL win", async () => {
    const staging = "https://api-observability-rengg-tfa.bsstag.com";
    expect(await baseUrl("eu", staging)).toBe(staging);
  });
});
