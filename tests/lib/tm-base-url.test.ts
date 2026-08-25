import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

// Re-imported per-test by resetting modules so the module-level
// `cachedBaseUrl` and the mocked `appConfig.REMOTE_MCP` stay isolated
// across cases.
async function loadModule(remoteMcp: boolean) {
  vi.resetModules();
  vi.doMock("../../src/config", () => ({
    __esModule: true,
    default: { REMOTE_MCP: remoteMcp },
  }));
  const apiClientMod = await import("../../src/lib/apiClient");
  const tmMod = await import("../../src/lib/tm-base-url");
  return {
    apiClient: apiClientMod.apiClient,
    getTMBaseURL: tmMod.getTMBaseURL,
    resolveTMBaseUrls: tmMod.resolveTMBaseUrls,
    TM_BASE_URLS: tmMod.TM_BASE_URLS,
  };
}

const BUILT_IN = [
  "https://test-management.browserstack.com",
  "https://test-management-eu.browserstack.com",
  "https://test-management-in.browserstack.com",
];
const PREPROD = "https://test-management-preprod.bsstag.com";

const mockConfig = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
};

describe("getTMBaseURL — multi-tenant cache discipline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stdio mode (REMOTE_MCP=false): caches the discovered base URL across calls", async () => {
    const { apiClient, getTMBaseURL } = await loadModule(false);
    (apiClient.get as any).mockResolvedValueOnce({ ok: true });

    const first = await getTMBaseURL(mockConfig);
    expect(first).toBe("https://test-management.browserstack.com");
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    // Second call must hit the cache; no additional HTTP call.
    const second = await getTMBaseURL(mockConfig);
    expect(second).toBe(first);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("remote mode (REMOTE_MCP=true): never caches, re-discovers each call", async () => {
    const { apiClient, getTMBaseURL } = await loadModule(true);
    // First user — region 1 succeeds on the first URL.
    (apiClient.get as any).mockResolvedValueOnce({ ok: true });
    const userA = await getTMBaseURL(mockConfig);
    expect(userA).toBe("https://test-management.browserstack.com");

    // Second user (different region) — first URL fails, EU succeeds.
    (apiClient.get as any)
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const userB = await getTMBaseURL(mockConfig);
    expect(userB).toBe("https://test-management-eu.browserstack.com");

    // Three HTTP calls total: one for user A, two for user B.
    // If the cache leaked across users, user B would have been served userA's URL with zero new calls.
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });
});

describe("getTMBaseURL — failure details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the HTTP status when requests complete (auth/permission failure)", async () => {
    const { apiClient, getTMBaseURL } = await loadModule(false);
    (apiClient.get as any).mockResolvedValue({ ok: false, status: 401 });

    const err = (await getTMBaseURL(mockConfig).catch(
      (e) => e as Error,
    )) as unknown as Error;
    expect(err.message).toMatch(/HTTP 401/);
  });

  it("reports the Node error code when requests never complete (network failure)", async () => {
    const { apiClient, getTMBaseURL } = await loadModule(false);
    (apiClient.get as any).mockRejectedValue(
      Object.assign(new Error("self signed cert"), {
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      }),
    );

    const err = (await getTMBaseURL(mockConfig).catch(
      (e) => e as Error,
    )) as unknown as Error;
    expect(err.message).toMatch(/UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
  });

  it("passes through any other status verbatim (not just auth codes)", async () => {
    const { apiClient, getTMBaseURL } = await loadModule(false);
    (apiClient.get as any).mockResolvedValue({ ok: false, status: 503 });

    const err = (await getTMBaseURL(mockConfig).catch(
      (e) => e as Error,
    )) as unknown as Error;
    expect(err.message).toMatch(/HTTP 503/);
  });
});

describe("BROWSERSTACK_TM_BASE_URLS — the test-harness override", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BROWSERSTACK_TM_BASE_URLS;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  /** The URLs actually probed, in the order they were probed. */
  function probed(apiClient: any): string[] {
    return (apiClient.get as any).mock.calls.map((args: any[]) => args[0].url);
  }

  it("the built-in list is exactly the three production regions, in order", async () => {
    const { TM_BASE_URLS } = await loadModule(false);
    // If this ever changes, it is a production change and not a harness one.
    expect([...(TM_BASE_URLS as readonly string[])]).toEqual(BUILT_IN);
  });

  it("unset: probes exactly the built-in list, in order", async () => {
    const { apiClient, getTMBaseURL, resolveTMBaseUrls } = await loadModule(false);
    expect(resolveTMBaseUrls()).toEqual({ urls: BUILT_IN, source: "built-in" });

    (apiClient.get as any).mockResolvedValue({ ok: false, status: 401 });
    await getTMBaseURL(mockConfig).catch(() => undefined);
    expect(probed(apiClient)).toEqual(BUILT_IN.map((u) => `${u}/api/v2/projects/`));
  });

  it("one URL: REPLACES the list, so production is never probed first", async () => {
    // Appending would leave the prod hosts ahead of it and the 401s would come straight
    // back, which is the entire problem this exists to remove.
    process.env.BROWSERSTACK_TM_BASE_URLS = PREPROD;
    const { apiClient, getTMBaseURL, resolveTMBaseUrls } = await loadModule(false);
    expect(resolveTMBaseUrls()).toEqual({ urls: [PREPROD], source: "env" });

    (apiClient.get as any).mockResolvedValueOnce({ ok: true });
    expect(await getTMBaseURL(mockConfig)).toBe(PREPROD);
    expect(probed(apiClient)).toEqual([`${PREPROD}/api/v2/projects/`]);
  });

  it("two comma-separated URLs: both, in the given order", async () => {
    process.env.BROWSERSTACK_TM_BASE_URLS = `${PREPROD},https://tm-two.bsstag.com`;
    const { apiClient, getTMBaseURL } = await loadModule(false);
    (apiClient.get as any)
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true });

    expect(await getTMBaseURL(mockConfig)).toBe("https://tm-two.bsstag.com");
    expect(probed(apiClient)).toEqual([
      `${PREPROD}/api/v2/projects/`,
      "https://tm-two.bsstag.com/api/v2/projects/",
    ]);
  });

  it("trims whitespace, drops empty entries and a trailing slash", async () => {
    process.env.BROWSERSTACK_TM_BASE_URLS = `  ${PREPROD}/ , , https://tm-two.bsstag.com  ,`;
    const { resolveTMBaseUrls } = await loadModule(false);
    expect(resolveTMBaseUrls()).toEqual({
      urls: [PREPROD, "https://tm-two.bsstag.com"],
      source: "env",
    });
  });

  it("drops an entry with no scheme, keeping the rest", async () => {
    process.env.BROWSERSTACK_TM_BASE_URLS = `tm-preprod.bsstag.com,${PREPROD}`;
    const { resolveTMBaseUrls } = await loadModule(false);
    expect(resolveTMBaseUrls()).toEqual({ urls: [PREPROD], source: "env" });
  });

  it("all garbage: falls back to the built-in list rather than probing nothing", async () => {
    // An empty probe loop would surface as "unable to connect" with no detail.
    process.env.BROWSERSTACK_TM_BASE_URLS = "not-a-url, ,???";
    const { apiClient, getTMBaseURL, resolveTMBaseUrls } = await loadModule(false);
    expect(resolveTMBaseUrls()).toEqual({
      urls: BUILT_IN,
      source: "built-in (override unusable)",
    });

    (apiClient.get as any).mockResolvedValue({ ok: false, status: 401 });
    await getTMBaseURL(mockConfig).catch(() => undefined);
    expect(probed(apiClient)).toEqual(BUILT_IN.map((u) => `${u}/api/v2/projects/`));
  });

  it("warns when it falls back, because silently using production is the danger", async () => {
    process.env.BROWSERSTACK_TM_BASE_URLS = "not-a-url";
    const { apiClient, getTMBaseURL } = await loadModule(false);
    const logger = (await import("../../src/logger")).default;
    (apiClient.get as any).mockResolvedValue({ ok: false, status: 401 });
    await getTMBaseURL(mockConfig).catch(() => undefined);

    const warning = (logger.warn as any).mock.calls.map(String).join(" ");
    expect(warning).toMatch(/BROWSERSTACK_TM_BASE_URLS/);
    expect(warning).toMatch(/go to production/);
  });

  it("does not serve a cached URL minted under a DIFFERENT list", async () => {
    // The cache is module-level; without keying it, an override would appear to work while
    // quietly returning the previous environment's host.
    const { apiClient, getTMBaseURL } = await loadModule(false);
    (apiClient.get as any).mockResolvedValueOnce({ ok: true });
    expect(await getTMBaseURL(mockConfig)).toBe(BUILT_IN[0]);
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    // Same process, override now set: the cached production host must NOT come back.
    process.env.BROWSERSTACK_TM_BASE_URLS = PREPROD;
    (apiClient.get as any).mockResolvedValueOnce({ ok: true });
    expect(await getTMBaseURL(mockConfig)).toBe(PREPROD);
    expect(apiClient.get).toHaveBeenCalledTimes(2);

    // ...and it still caches within one list.
    expect(await getTMBaseURL(mockConfig)).toBe(PREPROD);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});
