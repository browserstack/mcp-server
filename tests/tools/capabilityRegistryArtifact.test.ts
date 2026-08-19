import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { searchCapabilities } from "../../src/tools/capability-registry/search.js";
import { bind } from "../../src/tools/capability-registry/bind.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/registry-index.json", import.meta.url));
const registry = CapabilityRegistry.fromFile(FIXTURE);

describe("the real artifact", () => {
  it("loads every capability the Python build emitted", () => {
    expect(registry.buildId).toMatch(/caps/);
    expect(registry.index.products.tm.capabilities).toHaveLength(173);
    expect(Object.keys(registry.index.products.tm.entities)).toHaveLength(19);
  });

  it("carries no internal machinery — the reason we ship an index, not the specs", () => {
    const blob = JSON.stringify(registry.index);
    for (const forbidden of ["x-atlas-permission", '"target"', '"pointer"', "key_facts",
      '"operations"', "strip_prefix", "page_param", "count_param"]) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it("carries only a harness-declared host, and tm declares none", () => {
    // Harness declares the default, config overrides it — the same precedence Atlas uses.
    // What must never appear is a host that came from CONFIG, since one artifact ships to
    // every environment. tm's product.yaml leaves the host to config on purpose, so that
    // per-account region sharding is honoured.
    expect(registry.index.products.tm.base_url).toBeUndefined();
    const blob = JSON.stringify(registry.index);
    for (const host of ["bsstag.com", "browserstack.com", "https://"]) {
      expect(blob).not.toContain(host);
    }
  });

  it("answers a real query with a usable endpoint", () => {
    const hits = searchCapabilities(registry.index.products, "list the test cases in a folder");
    expect(hits.capabilities.length).toBeGreaterThan(0);
    const top = hits.capabilities[0];
    expect(top.method).toBeTruthy();
    expect(top.path.startsWith("/api/")).toBe(true);
    expect(top.mode).toBe("read");
  });

  it("refuses every destructive endpoint before binding", () => {
    const destructive = registry.index.products.tm.capabilities
      .filter((capability) => capability.mode === "destructive");
    // 16 in tm: 6 real DELETEs plus 10 POSTs whose path ends in delete/rm.
    expect(destructive.length).toBe(16);
  });

  it("binds a real endpoint end to end from what search returned", () => {
    const { capability } = registry.byEndpointLookup(
      "GET", "/api/v1/projects/{project_id}/folder/{folder_id}/test-cases",
    );
    const bound = bind(capability, { path_params: { project_id: 379320413, folder_id: 750414 } });
    expect(bound.path).toBe("/api/v1/projects/379320413/folder/750414/test-cases");
  });

  it("marks the endpoints whose response the product never declared", () => {
    const discovered = registry.index.products.tm.capabilities
      .filter((capability) => capability.shape === "discovered");
    expect(discovered.length).toBe(32);
  });
});
