import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  CapabilityRegistry, resolveDeep, resolveResponses,
} from "../../src/tools/capability-registry/index-loader.js";
import { searchCapabilities } from "../../src/tools/capability-registry/search.js";
import { bind } from "../../src/tools/capability-registry/bind.js";

/** The released artifact, exactly as the export pipeline publishes it. */
const RELEASED = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
/** The pre-release shape. Never deployed; kept so the defensive branch stays covered. */
const PRE_RELEASE = fileURLToPath(new URL("../fixtures/registry-index.json", import.meta.url));

const registry = CapabilityRegistry.fromFile(RELEASED);

describe("the released artifact", () => {
  it("loads the product from its own top-level key", () => {
    expect(registry.productNames()).toEqual(["tm"]);
    expect(registry.index.products.tm.capabilities).toHaveLength(173);
    expect(Object.keys(registry.index.products.tm.entities)).toHaveLength(19);
  });

  it("carries provenance in the released format, and nothing depends on it", () => {
    // `<commit>_<UTC timestamp>`, replacing the content-derived hash. Logging and
    // cache-busting only — capability resolution must not read it.
    expect(registry.buildId).toMatch(/^[0-9a-f]{7,}_\d{4}-\d{2}-\d{2}T[\d:]+Z$/);
    expect(registry.buildInfo().tm.version).toMatch(/^\d+\.\d+$/);
  });

  it("drops the envelope fields the released shape removed", () => {
    // `harness_commit` was an internal reference in a public file; the commit now lives
    // in build_id. `products` implied multi-product files that never exist.
    const raw = JSON.parse(readFileSync(RELEASED, "utf8"));
    expect(raw.products).toBeUndefined();
    expect(raw.harness_commit).toBeUndefined();
    expect(raw.tm).toBeDefined();
    expect(raw.version).toBeDefined();
  });

  it("still reads a stray pre-release file, recognised by shape not by version", () => {
    const legacy = CapabilityRegistry.fromFile(PRE_RELEASE);
    expect(legacy.productNames()).toEqual(["tm"]);
    expect(legacy.index.products.tm.capabilities.length).toBeGreaterThan(0);
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
    expect(registry.index.products.tm.base_urls).toBeUndefined();
    const blob = JSON.stringify(registry.index);
    for (const host of ["bsstag.com", "browserstack.com"]) {
      expect(blob).not.toContain(host);
    }
    // The response schemas carry example values, some of which are URLs. Those are fine;
    // a REAL host is not, so every absolute URL in the file has to be a placeholder.
    for (const url of blob.match(/https?:\/\/[^"\s]+/g) || []) {
      expect(url).toMatch(/^https?:\/\/example\.com\//);
    }
  });

  it("answers a real query with a usable endpoint", () => {
    const hits = searchCapabilities(registry.index.products, "list the test cases in a folder");
    expect(hits.hits.length).toBeGreaterThan(0);
    const top = hits.hits[0].capability;
    expect(top.method).toBeTruthy();
    expect(top.path.startsWith("/api/")).toBe(true);
    expect(top.mode).toBe("read");
  });

  it("ranks without guidance, which the released export no longer emits", () => {
    // Search scores a `guidance` haystack that is now empty for every capability. It must
    // still rank, or the drop would have silently degraded discovery.
    const capabilities = registry.index.products.tm.capabilities;
    expect(capabilities.some((capability) => capability.guidance)).toBe(false);
    const hits = searchCapabilities(registry.index.products, "create a folder in a project");
    expect(hits.hits[0].capability.mode).toBe("write");
    expect(hits.hits[0].capability.entity).toBe("folder");
  });

  it("publishes the page ceiling under the name the artifact uses", () => {
    // `max_page_size`, not `max_items` — the latter was only ever in our type.
    const paged = registry.index.products.tm.capabilities.filter((c) => c.paginated);
    expect(paged).toHaveLength(44);
    expect(paged.filter((c) => c.max_page_size !== undefined)).toHaveLength(14);
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
    expect(discovered.length).toBe(31);
  });

  it("carries the response and schema tables, stored once and referenced", () => {
    const tm = registry.index.products.tm;
    expect(Object.keys(tm.responses || {})).toHaveLength(53);
    expect(Object.keys(tm.schemas || {})).toHaveLength(75);
    // Every capability declares its responses; the payload stays small because the bodies
    // live in the tables and the capability only names them.
    expect(tm.capabilities.filter((c) => c.responses)).toHaveLength(173);
  });

  it("resolves a capability's responses through every hop", () => {
    const tm = registry.index.products.tm;
    const { capability } = registry.byEndpointLookup(
      "POST", "/api/v1/projects/{project_id}/folders",
    );
    // "all", because the second hop this checks is on an error entry.
    const resolved = resolveResponses(tm, capability, "all")!;

    // One hop: the 200 names a response, whose body is in the table.
    expect(resolved["200"].$response).toBeUndefined();
    expect(resolved["200"].description).toBeTruthy();

    // Two hops: the 400 names BadRequest, whose schema is itself {$schema: ErrorResponse}.
    const badRequest = resolved["400"];
    expect(badRequest.$response).toBeUndefined();
    expect(badRequest.schema?.$schema).toBeUndefined();
    expect(badRequest.schema?.type).toBe("object");
  });

  it("leaves nothing unresolved anywhere in the tree", () => {
    // References nest arbitrarily deep — inside schema properties and array items — so a
    // one-hop reader would hand back a tree still full of {$schema: "…"} placeholders.
    const tm = registry.index.products.tm;
    for (const capability of tm.capabilities) {
      const blob = JSON.stringify(resolveResponses(tm, capability, "all"));
      expect(blob, `${capability.method} ${capability.path}`).not.toContain('"$schema"');
      expect(blob, `${capability.method} ${capability.path}`).not.toContain('"$response"');
    }
  });

  it("survives a reference cycle by leaving the reference in place", () => {
    // No cycle exists today, but a self-referencing schema (a folder containing folders)
    // is one authoring change away, and it must not hang the server.
    const cyclic = {
      ...registry.index.products.tm,
      schemas: {
        Folder: { type: "object", properties: { children: { $schema: "Folder" } } },
      },
    };
    const resolved: any = resolveDeep(cyclic, { schema: { $schema: "Folder" } });
    expect(resolved.schema.type).toBe("object");
    // The second visit stops and shows the reference rather than recursing forever.
    expect(resolved.schema.properties.children).toEqual({ $schema: "Folder" });
  });

  it("leaves a dangling reference visible rather than dropping it", () => {
    const resolved: any = resolveDeep(
      registry.index.products.tm, { schema: { $schema: "NoSuchSchema" } },
    );
    expect(resolved.schema).toEqual({ $schema: "NoSuchSchema" });
  });
});
