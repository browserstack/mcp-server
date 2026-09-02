import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

// The package discovers which region an account's Test Management lives on. Hardcoding the
// default host would fail every EU and IN account on every call, so this asserts the
// registry defers to that resolver rather than to a constant of its own.
vi.mock("../../src/lib/tm-base-url.js", () => ({
  getTMBaseURL: vi.fn(async () => "https://test-management-eu.browserstack.com"),
}));

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
const CONFIG = {
  "browserstack-username": "ing_Xx",
  "browserstack-access-key": "SECRET",
} as any;

describe("base URL resolution", () => {
  beforeEach(() => {
    process.env.CAPABILITY_REGISTRY_INDEX = FIXTURE;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    vi.unstubAllGlobals();
  });

  it("sends the request to the region the account actually lives on", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ projects: [{ id: 1, name: "P" }], info: { count: 1 } }),
      };
    });

    const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
    const server = new BrowserStackMcpServer(CONFIG);
    const result: any = await (server.getTools().invokeEndpoint as any).handler(
      { method: "GET", path: "/api/v1/projects/basic" }, {} as any,
    );

    expect(JSON.parse(result.content[0].text).ok).toBe(true);
    expect(calls[0].startsWith("https://test-management-eu.browserstack.com/")).toBe(true);
  });

  it("an explicit override still wins, which is how a non-prod environment is reached", async () => {
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm-preprod.example";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ projects: [], info: { count: 0 } }),
      };
    });

    const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
    const server = new BrowserStackMcpServer(CONFIG);
    await (server.getTools().invokeEndpoint as any).handler(
      { method: "GET", path: "/api/v1/projects/basic" }, {} as any,
    );
    expect(calls[0].startsWith("https://tm-preprod.example/")).toBe(true);
  });

  it("refuses a product whose host is unknown instead of guessing one", async () => {
    // A guessed host fails as a DNS error or a 404 that reads like the caller's problem.
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    await expect(resolveBaseUrl("a11y", CONFIG)).rejects.toThrow(/no host is configured/);
  });
});

describe("the host declared in the product's own index file", () => {
  const DECLARED = "https://tm.declared-in-index.example";

  it("uses it for a product that is not region-sharded", async () => {
    const { resolveBaseUrl, isRegionSharded } =
      await import("../../src/tools/capability-registry/config.js");
    expect(isRegionSharded("a11y")).toBe(false);
    // Trailing slash trimmed, so the caller can author it either way.
    expect(await resolveBaseUrl("a11y", CONFIG, { base_url: `${DECLARED}/` })).toBe(DECLARED);
  });

  it("lets config override it", async () => {
    process.env.CAPABILITY_REGISTRY_BASE_URL_A11Y = "https://a11y-preprod.example";
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    expect(await resolveBaseUrl("a11y", CONFIG, { base_url: DECLARED })).toBe("https://a11y-preprod.example");
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_A11Y;
  });

  it("does NOT let it beat discovery for a region-sharded product", async () => {
    // The whole point: a declared host is one fixed origin, so honouring it here would send
    // every EU and IN account to the US — and would pass any test run on a US account.
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    const { resolveBaseUrl, isRegionSharded } =
      await import("../../src/tools/capability-registry/config.js");
    expect(isRegionSharded("tm")).toBe(true);
    expect(await resolveBaseUrl("tm", CONFIG, { base_url: DECLARED }))
      .toBe("https://test-management-eu.browserstack.com");
  });

  it("uses it as the fallback when discovery cannot answer", async () => {
    const { getTMBaseURL } = await import("../../src/lib/tm-base-url.js");
    vi.mocked(getTMBaseURL).mockRejectedValueOnce(new Error("all regions unreachable"));
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    expect(await resolveBaseUrl("tm", CONFIG, { base_url: DECLARED })).toBe(DECLARED);
  });

  it("surfaces the discovery failure when there is nothing to fall back to", async () => {
    const { getTMBaseURL } = await import("../../src/lib/tm-base-url.js");
    vi.mocked(getTMBaseURL).mockRejectedValueOnce(new Error("all regions unreachable"));
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    await expect(resolveBaseUrl("tm", CONFIG, undefined)).rejects.toThrow(/all regions unreachable/);
  });

  it("discovers when nothing is declared, which is tm's situation today", async () => {
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    expect(await resolveBaseUrl("tm", CONFIG, undefined))
      .toBe("https://test-management-eu.browserstack.com");
  });
});

describe("multiple environments, the way Atlas defines them", () => {
  const HARNESS_HOST = "https://tm.harness-declared.example";

  async function resolver() {
    return (await import("../../src/tools/capability-registry/config.js")).resolveBaseUrl;
  }

  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_ENV;
    delete process.env.CAPABILITY_REGISTRY_BASE_URLS;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM_PREPROD;
  });

  it("picks this environment's host from a per-env variable", async () => {
    process.env.CAPABILITY_REGISTRY_ENV = "preprod";
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM_PREPROD = "https://tm-preprod.example/";
    expect(await (await resolver())("tm", CONFIG, { base_url: HARNESS_HOST }))
      .toBe("https://tm-preprod.example");
  });

  it("picks it from one map, the analogue of harness.extra_environments", async () => {
    process.env.CAPABILITY_REGISTRY_ENV = "preprod";
    process.env.CAPABILITY_REGISTRY_BASE_URLS = JSON.stringify({
      tm: { preprod: "https://tm-preprod.example", prod: "https://tm.example" },
    });
    expect(await (await resolver())("tm", CONFIG, { base_url: HARNESS_HOST }))
      .toBe("https://tm-preprod.example");
  });

  it("lets the environment-agnostic override win, as Atlas's session seam does", async () => {
    process.env.CAPABILITY_REGISTRY_ENV = "preprod";
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://seam.example";
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM_PREPROD = "https://tm-preprod.example";
    expect(await (await resolver())("tm", CONFIG, { base_url: HARNESS_HOST })).toBe("https://seam.example");
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
  });

  it("refuses when an environment is named but has no host, rather than falling back", async () => {
    // Falling through to the harness default here would point a preprod deployment at
    // production, silently — the worst available outcome.
    process.env.CAPABILITY_REGISTRY_ENV = "preprod";
    await expect((await resolver())("tm", CONFIG, { base_url: HARNESS_HOST }))
      .rejects.toThrow(/environment 'preprod' has no host/);
  });

  it("refuses a malformed map instead of reading it as 'no override'", async () => {
    process.env.CAPABILITY_REGISTRY_ENV = "preprod";
    process.env.CAPABILITY_REGISTRY_BASE_URLS = "{not json";
    await expect((await resolver())("tm", CONFIG, { base_url: HARNESS_HOST }))
      .rejects.toThrow(/not valid JSON/);
  });

  it("ignores the environment entirely when none is selected", async () => {
    // Asserted on a product that is NOT region-sharded, so the declared host is the
    // observable outcome; for tm, discovery would answer before it and hide the point.
    process.env.CAPABILITY_REGISTRY_BASE_URLS = JSON.stringify({
      a11y: { preprod: "https://a11y-preprod.example" },
    });
    expect(await (await resolver())("a11y", CONFIG, { base_url: HARNESS_HOST })).toBe(HARNESS_HOST);
  });

  it("still refuses a named environment with no host for a region-sharded product", async () => {
    // Discovery must NOT rescue a misconfigured environment: it would answer with the
    // account's PRODUCTION region while the deployment believes it is on preprod.
    process.env.CAPABILITY_REGISTRY_ENV = "preprod";
    await expect((await resolver())("tm", CONFIG, undefined))
      .rejects.toThrow(/environment 'preprod' has no host/);
  });
});
