import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  isBrowseQuery,
  searchCapabilities,
} from "../../src/tools/capability-registry/search.js";
import type { ProductIndex } from "../../src/tools/capability-registry/types.js";

const tm = JSON.parse(
  readFileSync("capability/tm.capability-index.json", "utf8"),
).tm as ProductIndex;
const products = { tm } as Record<string, ProductIndex>;

describe("browse mode", () => {
  it("recognises the wildcard forms and nothing else", () => {
    for (const q of ["*", "all", " * ", "ALL"]) expect(isBrowseQuery(q)).toBe(true);
    for (const q of ["create a test case", "", undefined, "allocate"])
      expect(isBrowseQuery(q)).toBe(false);
  });

  it("'*' returns every capability, not a ranked shortlist", () => {
    const r = searchCapabilities(products, "*", { product: "tm", limit: 10000 });
    expect(r.browse).toBe(true);
    expect(r.total_matched).toBe(tm.capabilities.length);
    expect(r.hits).toHaveLength(tm.capabilities.length);
    expect(r.weak).toBe(false);
  });

  it("a plain search still returns only what matched", () => {
    const r = searchCapabilities(products, "create a test case", {
      product: "tm",
      limit: 10000,
    });
    expect(r.browse).toBeUndefined();
    expect(r.total_matched).toBeLessThan(tm.capabilities.length);
  });

  it("browse honours entity and mode filters", () => {
    const r = searchCapabilities(products, "*", {
      product: "tm",
      entity: "test_case",
      mode: "read",
      limit: 10000,
    });
    expect(r.hits.length).toBeGreaterThan(0);
    for (const h of r.hits) {
      expect(h.capability.entity).toBe("test_case");
      expect(h.capability.mode).toBe("read");
    }
  });
});

describe("pagination", () => {
  it("walks a browse listing without repeating or skipping a row", () => {
    const seen: string[] = [];
    let offset: number | undefined = 0;
    let pages = 0;
    while (offset !== undefined) {
      const r = searchCapabilities(products, "*", {
        product: "tm",
        limit: 25,
        offset,
      });
      expect(r.offset).toBe(offset);
      seen.push(...r.hits.map((h) => h.capability.name!));
      offset = r.next_offset;
      pages += 1;
      expect(pages).toBeLessThan(100);
    }
    // every capability exactly once
    expect(seen).toHaveLength(tm.capabilities.length);
    expect(new Set(seen).size).toBe(tm.capabilities.length);
  });

  it("omits next_offset on the final page, which is what terminates the walk", () => {
    const total = searchCapabilities(products, "*", {
      product: "tm",
      limit: 10000,
    }).total_matched;
    const last = searchCapabilities(products, "*", {
      product: "tm",
      limit: 10,
      offset: total - 5,
    });
    expect(last.hits).toHaveLength(5);
    expect(last.next_offset).toBeUndefined();
    expect(last.truncated).toBe(false);
  });

  it("pages a ranked search too, and the pages do not overlap", () => {
    const q = "test case";
    const a = searchCapabilities(products, q, { product: "tm", limit: 5 });
    expect(a.offset).toBe(0);
    expect(a.next_offset).toBe(5);
    const b = searchCapabilities(products, q, {
      product: "tm",
      limit: 5,
      offset: a.next_offset,
    });
    const first = a.hits.map((h) => h.capability.name);
    const second = b.hits.map((h) => h.capability.name);
    expect(first.some((n) => second.includes(n))).toBe(false);
    expect(a.total_matched).toBe(b.total_matched);
  });

  it("an offset past the end is empty rather than an error", () => {
    const r = searchCapabilities(products, "*", {
      product: "tm",
      limit: 10,
      offset: 99999,
    });
    expect(r.hits).toHaveLength(0);
    expect(r.next_offset).toBeUndefined();
    expect(r.total_matched).toBe(tm.capabilities.length);
  });

  it("browse order is stable across calls, so an offset means the same thing twice", () => {
    const once = searchCapabilities(products, "*", { product: "tm", limit: 40, offset: 20 });
    const twice = searchCapabilities(products, "*", { product: "tm", limit: 40, offset: 20 });
    expect(once.hits.map((h) => h.capability.name)).toEqual(
      twice.hits.map((h) => h.capability.name),
    );
  });
});
