import { describe, expect, it } from "vitest";

import {
  CapabilityRegistry,
  IndexError,
  InvocationError,
  isDisabled,
} from "../../src/tools/capability-registry/index-loader.js";
import { searchCapabilities } from "../../src/tools/capability-registry/search.js";

/**
 * The invariant under test is NOT "search filters disabled capabilities". It is that a
 * disabled capability is absent from the loaded model, so every reader is filtered whether
 * or not it remembers to be. Each test below therefore goes through a different reader.
 */
function registryWith(products: Record<string, unknown>): CapabilityRegistry {
  return new CapabilityRegistry({
    schema_version: 1,
    build_id: "test",
    products,
  } as any);
}

const LIVE = {
  name: "list_attachments_v1",
  method: "GET",
  path: "/api/v1/projects/{project_id}/attachments",
  mode: "read",
  entity: "attachment",
  intent: "List the attachments on a project.",
};
const OFF = {
  name: "upload_generic_attachments",
  method: "POST",
  path: "/api/v1/projects/{project_id}/generic/attachments",
  mode: "write",
  entity: "attachment",
  intent: "Upload attachments to a project.",
  disabled: true,
};

function product(extra: Record<string, unknown> = {}) {
  return {
    tm: {
      summary: "test management",
      capabilities: [LIVE, OFF],
      entities: {
        attachment: {
          aliases: ["file", "upload"],
          capabilities: ["list_attachments_v1", "upload_generic_attachments"],
        },
      },
      ...extra,
    },
  };
}

describe("the disabled flag", () => {
  it("reads any truthy value as disabled, and fails closed on an unexpected shape", () => {
    expect(isDisabled({ ...LIVE } as any)).toBe(false);
    expect(isDisabled({ ...LIVE, disabled: true } as any)).toBe(true);
    // Not a boolean — still hidden. A suppression flag that arrives in a shape we did
    // not expect must not quietly re-enable the capability.
    expect(isDisabled({ ...LIVE, disabled: "yes" } as any)).toBe(true);
    expect(isDisabled({ ...LIVE, disabled: 1 } as any)).toBe(true);
    expect(isDisabled({ ...LIVE, disabled: false } as any)).toBe(false);
  });
});

describe("a disabled capability is absent from the loaded model", () => {
  it("is gone from the capabilities array every reader iterates", () => {
    const registry = registryWith(product());
    const names = registry.index.products.tm.capabilities.map((c) => c.name);
    expect(names).toEqual(["list_attachments_v1"]);
  });

  it("is gone from the entity's capability list, which describeEntity returns wholesale", () => {
    const registry = registryWith(product());
    expect(
      registry.index.products.tm.entities.attachment.capabilities,
    ).toEqual(["list_attachments_v1"]);
  });

  it("leaves the original bundle untouched rather than mutating the caller's object", () => {
    const products = product();
    registryWith(products);
    expect((products.tm.capabilities as unknown[]).length).toBe(2);
    expect(products.tm.entities.attachment.capabilities).toHaveLength(2);
  });

  it("reports how many each product withholds", () => {
    expect(registryWith(product()).disabledCounts()).toEqual({ tm: 1 });
  });

  it("reports nothing, and shares the bundle, when no capability is disabled", () => {
    const products = { tm: { summary: "s", capabilities: [LIVE], entities: {} } };
    const registry = registryWith(products);
    expect(registry.disabledCounts()).toEqual({});
    // Untouched products keep object identity — the filter allocates only where it must.
    expect(registry.index.products.tm).toBe(products.tm);
  });
});

describe("searchCapability cannot surface one", () => {
  it("does not return it for a query whose words it matches best", () => {
    const registry = registryWith(product());
    const hit = searchCapabilities(registry.index.products, "upload attachments", {
      product: "tm",
    });
    expect(hit.hits.map((h) => h.capability.name)).not.toContain(
      "upload_generic_attachments",
    );
  });

  it("does not return it in browse mode, which skips scoring entirely", () => {
    const registry = registryWith(product());
    const all = searchCapabilities(registry.index.products, "*", {
      product: "tm",
      limit: 50,
    });
    expect(all.total_matched).toBe(1);
    expect(all.hits.map((h) => h.capability.name)).toEqual([
      "list_attachments_v1",
    ]);
  });

  it("does not return it under a mode filter that matches it", () => {
    const registry = registryWith(product());
    const writes = searchCapabilities(registry.index.products, "*", {
      product: "tm",
      mode: "write",
      limit: 50,
    });
    expect(writes.hits).toHaveLength(0);
  });
});

describe("invokeCapability answers `capability_disabled`, not `unknown`", () => {
  it("names the reason when the caller already holds the name", () => {
    const registry = registryWith(product());
    expect(() => registry.byNameLookup("upload_generic_attachments")).toThrow(
      InvocationError,
    );
    try {
      registry.byNameLookup("upload_generic_attachments");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("capability_disabled");
      // THAT it is disabled, not why. The reason is documentation and lives with the
      // decision, not in four copies inside the shipped artifact.
      expect(message).toContain("disabled on this surface");
      // The distinction that matters: withheld by the index, not missing from it.
      expect(message).not.toContain("unknown_capability");
    }
  });

  it("does the same for a caller holding the endpoint instead of the name", () => {
    const registry = registryWith(product());
    try {
      registry.byEndpointLookup(
        "POST",
        "/api/v1/projects/{project_id}/generic/attachments",
      );
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as Error).message).toContain("capability_disabled");
    }
  });

  it("still says unknown for a name that is genuinely absent", () => {
    const registry = registryWith(product());
    expect(() => registry.byNameLookup("no_such_capability")).toThrow(
      /unknown_capability/,
    );
  });
});

describe("the load-time checks still see disabled capabilities", () => {
  it("rejects a name clash even when one side is disabled", () => {
    // Otherwise re-enabling the flag would fail the load later, somewhere with far less
    // context than the loader has.
    expect(() =>
      registryWith({
        tm: {
          summary: "s",
          capabilities: [LIVE, { ...OFF, name: "list_attachments_v1" }],
          entities: {},
        },
      }),
    ).toThrow(IndexError);
  });
});

describe("the shipped tm index", () => {
  const FILE = "capability/tm.capability-index.json";
  /**
   * The published surface is the capabilities that PASSED live probing. Everything that did
   * not — blocked, drifted, unverified, and the destructive tier — is withheld while the
   * product team works through it, so 46 of 244 are off and 198 remain.
   *
   * A few are spot-checked by name rather than pinning the whole list: the point of this
   * test is that the flag in the shipped artifact is spelled correctly and actually takes
   * effect, not to restate the roster, which is expected to shrink as defects are fixed.
   */
  const WITHHELD_COUNT = 46;
  const PUBLISHED_COUNT = 198;
  const FILE_BEARING = [
    "import_dataset_csv",
    "upload_ai_attachments",
    "upload_generic_attachments",
    "link_attachments_to_test_case",
  ];

  it("withholds the non-passing capabilities, including the file-bearing ones", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    const off = new Set(
      raw.tm.capabilities.filter((c: any) => c.disabled).map((c: any) => c.name),
    );
    expect(off.size).toBe(WITHHELD_COUNT);
    for (const name of FILE_BEARING) expect(off.has(name)).toBe(true);
    // Every destructive capability is withheld, so the tier is now invisible as well as
    // refused. Nothing that passed is caught up in it.
    const destructive = raw.tm.capabilities.filter((c: any) => c.mode === "destructive");
    expect(destructive.every((c: any) => c.disabled)).toBe(true);
  });

  /**
   * The fixture tests above prove the mechanism. This one proves it against the artifact
   * that actually ships, because the two can disagree: a flag spelled wrongly in the index
   * costs nothing at load and silently publishes the capability.
   */
  it("loads with those four absent from every surface", () => {
    const registry = CapabilityRegistry.fromFile(FILE);
    const tm = registry.index.products.tm;

    expect(tm.capabilities).toHaveLength(PUBLISHED_COUNT);
    expect(registry.disabledCounts()).toEqual({ tm: WITHHELD_COUNT });

    const live = new Set(tm.capabilities.map((c) => c.name));
    for (const name of FILE_BEARING) expect(live.has(name)).toBe(false);

    // Not in any entity's capability list either.
    const listed = new Set(
      Object.values(tm.entities).flatMap((doc: any) =>
        Array.isArray(doc?.capabilities) ? doc.capabilities : [],
      ),
    );
    for (const name of FILE_BEARING) expect(listed.has(name)).toBe(false);

    // Not reachable by browsing the whole product.
    const all = searchCapabilities(registry.index.products, "*", {
      product: "tm",
      limit: 1000,
    });
    expect(all.total_matched).toBe(PUBLISHED_COUNT);
    // The destructive tier cannot be browsed into either, which it could before.
    const destructive = searchCapabilities(registry.index.products, "*", {
      product: "tm",
      mode: "destructive",
      limit: 1000,
    });
    expect(destructive.total_matched).toBe(0);

    // And the queries that would have found them return the live neighbours instead.
    const hits = searchCapabilities(registry.index.products, "upload a file", {
      product: "tm",
      limit: 20,
    });
    for (const name of FILE_BEARING) {
      expect(hits.hits.map((h) => h.capability.name)).not.toContain(name);
    }

    // Still refused by name, with the reason.
    for (const name of FILE_BEARING) {
      expect(() => registry.byNameLookup(name, "tm")).toThrow(
        /capability_disabled/,
      );
    }
  });
});
