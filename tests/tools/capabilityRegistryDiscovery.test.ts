import { beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import {
  clearDiscoveryCache, discoverBaseUrl, probePath,
} from "../../src/tools/capability-registry/discovery.js";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { HttpResponse, Transport } from "../../src/tools/capability-registry/egress.js";

const CREDENTIALS = { username: "ing_Xx", accessKey: "SECRET" };
/** The same identity in the server's config shape, for resolveBaseUrl. */
const CONFIG = {
  "browserstack-username": "ing_Xx",
  "browserstack-access-key": "SECRET",
} as never;
const HOSTS = [
  "https://test-management.browserstack.com",
  "https://test-management-eu.browserstack.com",
  "https://test-management-in.browserstack.com",
];

const REAL = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
const bundle = CapabilityRegistry.fromFile(REAL).index.products.tm;

/** Answers 2xx for exactly one host, the way one account's real region does. */
function onlyRegion(region: string, calls: string[]): Transport {
  return async (_method, url): Promise<HttpResponse> => {
    calls.push(url);
    return url.startsWith(region)
      ? { status: 200, body: { projects: [] } }
      : { status: 401, body: null };
  };
}

beforeEach(() => clearDiscoveryCache());

describe("choosing the endpoint to probe with", () => {
  it("derives a primary collection from the product's own capabilities", () => {
    // A paged, placeholder-free, non-admin read — the same family as the hand-written tm
    // probe, reached without anyone authoring a probe_path.
    expect(probePath(bundle)).toBe("/api/v1/projects");
  });

  it("never derives a feature-flagged or admin-only endpoint", () => {
    // Both 4xx for legitimate accounts, which the probe would read as "wrong region" and
    // walk straight past the right host.
    const derived = probePath(bundle)!;
    expect(derived).not.toContain("/admin");
    expect(derived).not.toBe("/api/v1/activities");
  });

  it("prefers an explicitly declared probe_path", () => {
    expect(probePath({ ...bundle, probe_path: "/api/v1/ping" })).toBe("/api/v1/ping");
  });

  it("has nothing to derive from when no capability qualifies", () => {
    expect(probePath({ capabilities: [] })).toBeUndefined();
  });
});

describe("probing the declared regions", () => {
  it("returns the region that accepts the account's credentials", async () => {
    const calls: string[] = [];
    const host = await discoverBaseUrl(
      "tm", { ...bundle, base_urls: HOSTS }, CREDENTIALS, onlyRegion(HOSTS[1], calls),
    );
    expect(host).toBe(HOSTS[1]);
    // Walked in declared order and stopped at the first that answered.
    expect(calls).toEqual([`${HOSTS[0]}/api/v1/projects`, `${HOSTS[1]}/api/v1/projects`]);
  });

  it("probes with the same Api-Token auth the real calls use", async () => {
    const seen: Record<string, string>[] = [];
    await discoverBaseUrl("tm", { ...bundle, base_urls: HOSTS }, CREDENTIALS,
      async (_m, _u, headers) => {
        seen.push(headers);
        return { status: 200, body: {} };
      });
    // A host that answers here is one that will answer for the invocation that follows.
    expect(seen[0]["Api-Token"]).toBe("ing_Xx:SECRET");
  });

  it("skips the round trip when there is only one candidate", async () => {
    const calls: string[] = [];
    const host = await discoverBaseUrl(
      "tm", { ...bundle, base_urls: [HOSTS[0]] }, CREDENTIALS, onlyRegion(HOSTS[0], calls),
    );
    expect(host).toBe(HOSTS[0]);
    expect(calls).toEqual([]);
  });

  it("caches per user, so one account's region is never served to another", async () => {
    const calls: string[] = [];
    const transport = onlyRegion(HOSTS[1], calls);
    const source = { ...bundle, base_urls: HOSTS };

    await discoverBaseUrl("tm", source, CREDENTIALS, transport);
    await discoverBaseUrl("tm", source, CREDENTIALS, transport);
    expect(calls).toHaveLength(2);           // second call served from cache

    const other = { username: "someone_else", accessKey: "OTHER" };
    await discoverBaseUrl("tm", source, other, transport);
    expect(calls).toHaveLength(4);           // a different account probes for itself
  });

  it("names every region it tried when none of them answer", async () => {
    await expect(discoverBaseUrl("tm", { ...bundle, base_urls: HOSTS }, CREDENTIALS,
      async () => ({ status: 403, body: null })))
      .rejects.toThrow(/could not determine which region.*HTTP 403/s);
  });

  it("reports an unreachable host rather than a bare status 0", async () => {
    await expect(discoverBaseUrl("tm", { ...bundle, base_urls: HOSTS }, CREDENTIALS,
      async () => ({ status: 0, body: null, error: "boom" })))
      .rejects.toThrow(/unreachable/);
  });

  it("refuses when several regions are declared but nothing can probe them", async () => {
    await expect(discoverBaseUrl("tm", { base_urls: HOSTS, capabilities: [] }, CREDENTIALS,
      async () => ({ status: 200, body: {} })))
      .rejects.toThrow(/no endpoint to probe them with/);
  });

  it("refuses when no candidates are declared at all", async () => {
    await expect(discoverBaseUrl("tm", bundle, CREDENTIALS,
      async () => ({ status: 200, body: {} })))
      .rejects.toThrow(/declares no base_urls/);
  });
});

describe("through resolveBaseUrl", () => {
  it("prefers the index's regions over its single declared host", async () => {
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    const calls: string[] = [];
    const host = await resolveBaseUrl("tm", CONFIG,
      { ...bundle, base_urls: HOSTS, base_url: "https://wrong.example" },
      onlyRegion(HOSTS[2], calls));
    expect(host).toBe(HOSTS[2]);
  });

  it("falls back to the single host when every region refuses", async () => {
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    const host = await resolveBaseUrl("tm", CONFIG,
      { ...bundle, base_urls: HOSTS, base_url: "https://declared.example" },
      async () => ({ status: 503, body: null }));
    expect(host).toBe("https://declared.example");
  });

  it("does not probe unauthenticated, and says so via the fallback", async () => {
    // authHeaders refuses before the first request: probing without credentials would 401
    // on every region and report "could not determine the region", which reads like an
    // outage rather than missing configuration.
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    const calls: string[] = [];
    const host = await resolveBaseUrl("tm", {} as never,
      { ...bundle, base_urls: HOSTS, base_url: "https://declared.example" },
      onlyRegion(HOSTS[0], calls));
    expect(calls).toEqual([]);
    expect(host).toBe("https://declared.example");
  });

  it("surfaces the refusal when there is no host to fall back to", async () => {
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    await expect(resolveBaseUrl("tm", {} as never,
      { ...bundle, base_urls: HOSTS }, onlyRegion(HOSTS[0], [])))
      .rejects.toThrow(/not authenticated/);
  });

  it("lets an env override skip the probe entirely", async () => {
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm-preprod.example";
    const { resolveBaseUrl } = await import("../../src/tools/capability-registry/config.js");
    const calls: string[] = [];
    const host = await resolveBaseUrl("tm", CONFIG,
      { ...bundle, base_urls: HOSTS }, onlyRegion(HOSTS[0], calls));
    expect(host).toBe("https://tm-preprod.example");
    expect(calls).toEqual([]);
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
  });
});
