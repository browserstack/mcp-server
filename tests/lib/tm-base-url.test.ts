import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
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
  return { apiClient: apiClientMod.apiClient, getTMBaseURL: tmMod.getTMBaseURL };
}

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
