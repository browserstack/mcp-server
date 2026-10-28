import { describe, it, expect, vi, afterEach } from "vitest";

const PROD_AUTOMATION = "https://api-automation.browserstack.com";

// Re-imported per test so each case sees its own mocked config.
async function loadModule(
  region: string | undefined,
  automationBaseUrl: string | undefined = PROD_AUTOMATION,
) {
  vi.resetModules();
  vi.doMock("../../src/config", () => ({
    __esModule: true,
    default: {
      BROWSERSTACK_GRR_REGION: region,
      BROWSERSTACK_AUTOMATION_BASE_URL: automationBaseUrl,
    },
  }));
  return import("../../src/lib/regional-host");
}

describe("getRegionalHost", () => {
  it.each([undefined, "us"])(
    "keeps every host on its US default when the region is %s",
    async (region) => {
      const { getRegionalHost } = await loadModule(region);
      expect(getRegionalHost("automateApi")).toBe(
        "https://api.browserstack.com",
      );
      expect(getRegionalHost("appAutomateUpload")).toBe(
        "https://api-cloud.browserstack.com",
      );
      expect(getRegionalHost("appAutomateHub")).toBe("hub.browserstack.com");
      expect(getRegionalHost("accessibilityApi")).toBe(
        "https://api-accessibility.browserstack.com",
      );
      expect(getRegionalHost("observabilityApi")).toBe(
        "https://api-observability.browserstack.com",
      );
      expect(getRegionalHost("automationApi")).toBe(PROD_AUTOMATION);
    },
  );

  it("routes every product to its EU host when the region is eu", async () => {
    const { getRegionalHost } = await loadModule("eu");
    expect(getRegionalHost("automateApi")).toBe(
      "https://api-eu-only.browserstack.com",
    );
    expect(getRegionalHost("appAutomateApi")).toBe(
      "https://api-eu-only.browserstack.com",
    );
    expect(getRegionalHost("appAutomateUpload")).toBe(
      "https://api-eu-only.browserstack.com",
    );
    expect(getRegionalHost("appAutomateHub")).toBe(
      "hub-eu-only.browserstack.com",
    );
    expect(getRegionalHost("accessibilityApi")).toBe(
      "https://api-accessibility-eu.browserstack.com",
    );
    expect(getRegionalHost("accessibilityDashboard")).toBe(
      "https://accessibility-eu.browserstack.com",
    );
    expect(getRegionalHost("appAccessibilityApi")).toBe(
      "https://api-app-accessibility-eu.browserstack.com",
    );
    expect(getRegionalHost("appAccessibilityDashboard")).toBe(
      "https://app-accessibility-eu.browserstack.com",
    );
    expect(getRegionalHost("observabilityApi")).toBe(
      "https://api-observability-eu.browserstack.com",
    );
    expect(getRegionalHost("automationApi")).toBe(
      "https://api-automation-eu.browserstack.com",
    );
  });

  it("routes Automate to api-aps-only when the region is in", async () => {
    const { getRegionalHost } = await loadModule("in");
    expect(getRegionalHost("automateApi")).toBe(
      "https://api-aps-only.browserstack.com",
    );
    expect(getRegionalHost("appAutomateHub")).toBe(
      "hub-aps-only.browserstack.com",
    );
  });

  it("uses an explicit BROWSERSTACK_AUTOMATION_BASE_URL in any region", async () => {
    const staging = "https://api-automation-preprod.bsstag.com";
    const { getRegionalHost } = await loadModule("eu", staging);
    expect(getRegionalHost("automationApi")).toBe(staging);
  });

  it("falls back to the US api-automation host when the config omits it", async () => {
    const { getRegionalHost } = await loadModule(undefined, undefined);
    expect(getRegionalHost("automationApi")).toBe(PROD_AUTOMATION);
  });
});

describe("BROWSERSTACK_GRR_REGION parsing", () => {
  const original = process.env.BROWSERSTACK_GRR_REGION;

  afterEach(() => {
    if (original === undefined) delete process.env.BROWSERSTACK_GRR_REGION;
    else process.env.BROWSERSTACK_GRR_REGION = original;
  });

  async function loadConfig(value: string | undefined) {
    vi.resetModules();
    vi.doUnmock("../../src/config");
    if (value === undefined) delete process.env.BROWSERSTACK_GRR_REGION;
    else process.env.BROWSERSTACK_GRR_REGION = value;
    return (await import("../../src/config")).default;
  }

  it.each([
    [undefined, undefined],
    ["", undefined],
    ["us", "us"],
    [" EU ", "eu"],
    ["in", "in"],
  ])("reads %j as %s", async (value, expected) => {
    expect((await loadConfig(value)).BROWSERSTACK_GRR_REGION).toBe(expected);
  });

  it("refuses an unknown region at startup instead of defaulting to US", async () => {
    await expect(loadConfig("uk")).rejects.toThrow(
      /Invalid BROWSERSTACK_GRR_REGION "uk"/,
    );
  });
});
