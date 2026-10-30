import { describe, it, expect, vi } from "vitest";

const PROD_AUTOMATION = "https://api-automation.browserstack.com";

// Re-imported per test so each case sees its own mocked config; every export is called
// inside a tool call for an account in `region`.
async function loadModule(
  region: string | undefined,
  automationBaseUrl: string | undefined = PROD_AUTOMATION,
) {
  vi.resetModules();
  vi.doMock("../../src/config", () => ({
    __esModule: true,
    default: { BROWSERSTACK_AUTOMATION_BASE_URL: automationBaseUrl },
  }));
  const mod = await import("../../src/lib/regional-host");
  const { withAccountRegion } = await import("../../src/lib/region-context");
  const inRegion = <T extends (...args: any[]) => any>(fn: T) =>
    ((...args: Parameters<T>) =>
      withAccountRegion(region as any, () => fn(...args))) as T;
  return {
    getRegionalHost: inRegion(mod.getRegionalHost),
    sessionApiHost: inRegion(mod.sessionApiHost),
    isRegionalHostname: inRegion(mod.isRegionalHostname),
  };
}

describe("getRegionalHost", () => {
  it.each([undefined, "us"])(
    "keeps every host on its US default when the region is %s",
    async (region) => {
      const { getRegionalHost } = await loadModule(region);
      expect(getRegionalHost("automateApi")).toBe(
        "https://api.browserstack.com",
      );
      expect(getRegionalHost("appAutomateCloud")).toBe(
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

  it("refuses to pick a host when the region is unknown", async () => {
    const { getRegionalHost, sessionApiHost } = await loadModule("unknown");
    expect(() => getRegionalHost("automateApi")).toThrow(
      /Could not confirm your BrowserStack account's region/,
    );
    expect(() => getRegionalHost("accessibilityApi")).toThrow();
    expect(() => sessionApiHost("automate")).toThrow();
  });

  it("routes every product to its EU host when the region is eu", async () => {
    const { getRegionalHost } = await loadModule("eu");
    expect(getRegionalHost("automateApi")).toBe(
      "https://api-eu-only.browserstack.com",
    );
    expect(getRegionalHost("appAutomateApi")).toBe(
      "https://api-eu-only.browserstack.com",
    );
    expect(getRegionalHost("appAutomateCloud")).toBe(
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

  it("keeps the default hosts for a region it does not route", async () => {
    const { getRegionalHost } = await loadModule("in");
    expect(getRegionalHost("automateApi")).toBe("https://api.browserstack.com");
    expect(getRegionalHost("appAutomateHub")).toBe("hub.browserstack.com");
    expect(getRegionalHost("testManagement")).toBe(
      "https://test-management.browserstack.com",
    );
  });

  it("uses an explicit BROWSERSTACK_AUTOMATION_BASE_URL in any region", async () => {
    const staging = "https://api-automation-preprod.bsstag.com";
    const { getRegionalHost } = await loadModule("eu", staging);
    expect(getRegionalHost("automationApi")).toBe(staging);
  });

  it.each([`${PROD_AUTOMATION}/`, " https://API-AUTOMATION.browserstack.com "])(
    "treats %j as the default, not an override",
    async (spelling) => {
      const { getRegionalHost } = await loadModule("eu", spelling);
      expect(getRegionalHost("automationApi")).toBe(
        "https://api-automation-eu.browserstack.com",
      );
    },
  );

  it("drops a trailing slash from a real override", async () => {
    const { getRegionalHost } = await loadModule(
      "eu",
      "https://api-automation-preprod.bsstag.com/",
    );
    expect(getRegionalHost("automationApi")).toBe(
      "https://api-automation-preprod.bsstag.com",
    );
  });

  it("falls back to the US api-automation host when the config omits it", async () => {
    const { getRegionalHost } = await loadModule(undefined, undefined);
    expect(getRegionalHost("automationApi")).toBe(PROD_AUTOMATION);
  });
});

describe("sessionApiHost", () => {
  it("picks the session's product host in the account's region", async () => {
    const { sessionApiHost } = await loadModule("eu");
    expect(sessionApiHost("automate")).toBe(
      "https://api-eu-only.browserstack.com",
    );
    expect(sessionApiHost("app-automate")).toBe(
      "https://api-eu-only.browserstack.com",
    );
  });
});

describe("isRegionalHostname", () => {
  it("accepts a link from any region, whatever the configured region", async () => {
    const { isRegionalHostname } = await loadModule("eu");
    for (const host of [
      "app-accessibility.browserstack.com",
      "app-accessibility-eu.browserstack.com",
    ]) {
      expect(isRegionalHostname("appAccessibilityDashboard", host)).toBe(true);
    }
    expect(
      isRegionalHostname("appAccessibilityDashboard", "evil.example.com"),
    ).toBe(false);
  });
});
