import { describe, it, expect, vi, beforeEach } from "vitest";

// tests/setup.ts stubs the resolver for every other suite; this one tests the real thing.
vi.unmock("../../src/lib/regional-host");

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const PROD_AUTOMATION = "https://api-automation.browserstack.com";

// Re-imported per test so the stdio-mode region cache and the mocked config stay isolated.
async function loadModule(
  remoteMcp: boolean,
  automationBaseUrl = PROD_AUTOMATION,
) {
  vi.resetModules();
  vi.doUnmock("../../src/lib/regional-host");
  vi.doMock("../../src/config", () => ({
    __esModule: true,
    default: {
      REMOTE_MCP: remoteMcp,
      BROWSERSTACK_AUTOMATION_BASE_URL: automationBaseUrl,
    },
  }));
  const apiClientMod = await import("../../src/lib/apiClient");
  const mod = await import("../../src/lib/regional-host");
  return { get: apiClientMod.apiClient.get as any, ...mod };
}

const config = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
};

const probedUrls = (get: any) => get.mock.calls.map((c: any[]) => c[0].url);

describe("getRegionalHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves a non-GRR account from the US host after one probe", async () => {
    const { get, getRegionalHost } = await loadModule(false);
    get.mockResolvedValueOnce({ ok: true });

    await expect(getRegionalHost("automateApi", config)).resolves.toBe(
      "https://api.browserstack.com",
    );
    expect(probedUrls(get)).toEqual([
      "https://api.browserstack.com/automate/plan.json",
    ]);
  });

  it("routes an EU GRR account to the EU host when the US host refuses it", async () => {
    const { get, getRegionalHost } = await loadModule(false);
    get
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true });

    await expect(getRegionalHost("appAutomateHub", config)).resolves.toBe(
      "hub-eu-only.browserstack.com",
    );
    expect(probedUrls(get)).toEqual([
      "https://api.browserstack.com/app-automate/plan.json",
      "https://api-eu-only.browserstack.com/app-automate/plan.json",
    ]);
  });

  it("probes each product with its own read endpoint", async () => {
    const { get, getRegionalHost } = await loadModule(false);
    get.mockResolvedValue({ ok: true });

    await getRegionalHost("accessibilityApi", config);
    await getRegionalHost("observabilityApi", config);
    await getRegionalHost("automationApi", config);

    expect(probedUrls(get)).toEqual([
      "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans",
      "https://api-observability.browserstack.com/ext/v1/projects",
      "https://api-automation.browserstack.com/ext/v1/projects",
    ]);
  });

  it("keeps trying the next region after a network error", async () => {
    const { get, getRegionalHost } = await loadModule(false);
    get
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce({ ok: true });

    await expect(getRegionalHost("observabilityApi", config)).resolves.toBe(
      "https://api-observability-eu.browserstack.com",
    );
  });

  it("fails closed instead of falling back to the US host when every region refuses", async () => {
    const { get, getRegionalHost } = await loadModule(false);
    get.mockResolvedValue({ ok: false, status: 403 });

    await expect(getRegionalHost("accessibilityApi", config)).rejects.toThrow(
      /accessibility.*us: HTTP 403; eu: HTTP 403; in: HTTP 403/,
    );
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("stdio mode caches the region per product, so hosts of one product share a probe", async () => {
    const { get, getRegionalHost } = await loadModule(false);
    get
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true });

    await getRegionalHost("appAutomateApi", config);
    await expect(getRegionalHost("appAutomateUpload", config)).resolves.toBe(
      "https://api-eu-only.browserstack.com",
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("remote mode never caches, so one user's region cannot reach another", async () => {
    const { get, getRegionalHost } = await loadModule(true);
    get.mockResolvedValue({ ok: true });

    await getRegionalHost("automateApi", config);
    await getRegionalHost("automateApi", config);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("uses an explicit BROWSERSTACK_AUTOMATION_BASE_URL without probing", async () => {
    const staging = "https://api-automation-preprod.bsstag.com";
    const { get, getRegionalHost } = await loadModule(false, staging);

    await expect(getRegionalHost("automationApi", config)).resolves.toBe(
      staging,
    );
    expect(get).not.toHaveBeenCalled();
  });
});

describe("hostFor", () => {
  it("keeps App Automate uploads on api-cloud in the US and on api-<region>-only elsewhere", async () => {
    const { hostFor } = await loadModule(false);
    expect(hostFor("appAutomateUpload", "us")).toBe(
      "https://api-cloud.browserstack.com",
    );
    expect(hostFor("appAutomateUpload", "eu")).toBe(
      "https://api-eu-only.browserstack.com",
    );
    expect(hostFor("appAutomateUpload", "in")).toBe(
      "https://api-aps-only.browserstack.com",
    );
  });
});
