import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A product is normally one host. App Automate is not: the account-level API (devices, app
// builds, plan, session records) and the Appium hub that drives the device are different
// origins, and neither serves the other's paths. A capability says which it needs through
// `host`, resolved against the product's `hosts` map.

const CONFIG = {
  "browserstack-username": "ing_Xx",
  "browserstack-access-key": "SECRET",
} as any;

const SOURCE = {
  base_url: "https://api-cloud.browserstack.com",
  hosts: { hub: "https://hub-cloud.browserstack.com" },
};

const OVERRIDE = "CAPABILITY_REGISTRY_BASE_URL_APPAUTOMATE_HOST_HUB";

describe("a capability served from a named host", () => {
  beforeEach(() => {
    delete process.env[OVERRIDE];
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_APPAUTOMATE;
    delete process.env.CAPABILITY_REGISTRY_ENV;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env[OVERRIDE];
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_APPAUTOMATE;
    delete process.env.CAPABILITY_REGISTRY_ENV;
  });

  it("resolves to the host it names, not the product's own", async () => {
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    expect(
      await resolveBaseUrl("appautomate", CONFIG, SOURCE, undefined, "hub"),
    ).toBe("https://hub-cloud.browserstack.com");
  });

  it("still gives the product's own host to a capability that names none", async () => {
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    expect(await resolveBaseUrl("appautomate", CONFIG, SOURCE)).toBe(
      "https://api-cloud.browserstack.com",
    );
  });

  it("trims a trailing slash, so the index can be authored either way", async () => {
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    expect(
      await resolveBaseUrl(
        "appautomate",
        CONFIG,
        { ...SOURCE, hosts: { hub: "https://hub-cloud.browserstack.com/" } },
        undefined,
        "hub",
      ),
    ).toBe("https://hub-cloud.browserstack.com");
  });

  it("lets config override one named host without touching the others", async () => {
    process.env[OVERRIDE] = "https://hub-preprod.example";
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    expect(
      await resolveBaseUrl("appautomate", CONFIG, SOURCE, undefined, "hub"),
    ).toBe("https://hub-preprod.example");
    expect(await resolveBaseUrl("appautomate", CONFIG, SOURCE)).toBe(
      "https://api-cloud.browserstack.com",
    );
  });

  it("is NOT overridden by the product-level variable, which addresses a different host", async () => {
    // Pointing the product at a preprod API must not silently redirect hub traffic there:
    // the hub is a separate deployment and would answer 404 for every /wd/hub path.
    process.env.CAPABILITY_REGISTRY_BASE_URL_APPAUTOMATE =
      "https://api-preprod.example";
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    expect(
      await resolveBaseUrl("appautomate", CONFIG, SOURCE, undefined, "hub"),
    ).toBe("https://hub-cloud.browserstack.com");
  });

  it("refuses a host the index does not declare, and names the ones it does", async () => {
    // Falling back to base_url would send the call to a host that cannot serve the path,
    // returning a 404 that reads like the caller's mistake.
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    await expect(
      resolveBaseUrl("appautomate", CONFIG, SOURCE, undefined, "terminal"),
    ).rejects.toThrow(/'terminal' host.*does not declare.*hub/s);
  });

  it("refuses a named environment that defines no host for it", async () => {
    // The same reason the product-level resolver refuses: a preprod session must not reach
    // production because nobody configured preprod's hub.
    process.env.CAPABILITY_REGISTRY_ENV = "preprod";
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    await expect(
      resolveBaseUrl("appautomate", CONFIG, SOURCE, undefined, "hub"),
    ).rejects.toThrow(/environment 'preprod' has no 'hub' host/);
  });

  it("takes the environment's host from the _HOST_ variable when one is set", async () => {
    process.env.CAPABILITY_REGISTRY_ENV = "preprod";
    process.env[OVERRIDE] = "https://hub-preprod.example";
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    expect(
      await resolveBaseUrl("appautomate", CONFIG, SOURCE, undefined, "hub"),
    ).toBe("https://hub-preprod.example");
  });
});
