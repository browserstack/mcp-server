import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  searchCapabilities,
  vocabularyOf,
} from "../../src/tools/capability-registry/search.js";

/** Both shipped products, because everything here is about telling them apart. */
const load = (file: string) => {
  const raw = JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../capability/${file}`, import.meta.url)),
      "utf8",
    ),
  );
  const [name] = Object.keys(raw).filter(
    (k) =>
      !["schema_version", "version", "build_id", "harness_commit"].includes(k),
  );
  return { name, product: raw.products ? raw.products[name] : raw[name] };
};
const tm = load("tm.capability-index.json");
const lt = load("loadtesting.capability-index.json");
const BOTH = { [tm.name]: tm.product, [lt.name]: lt.product } as any;

describe("routing between products", () => {
  it("resolves most caller vocabulary to exactly one product", () => {
    // This is what lets listProducts answer "which product?" before a search happens.
    const owners = new Map<string, Set<string>>();
    for (const [product, entries] of Object.entries(vocabularyOf(BOTH))) {
      for (const entry of entries) {
        for (const term of [entry.entity, ...(entry.aliases ?? [])]) {
          const key = String(term).toLowerCase();
          if (!owners.has(key)) owners.set(key, new Set());
          owners.get(key)!.add(product);
        }
      }
    }
    const unique = [...owners.values()].filter((s) => s.size === 1).length;
    expect(owners.size).toBeGreaterThan(100);
    expect(unique / owners.size).toBeGreaterThan(0.9);

    // `tag` belongs to Test Management alone — which is exactly why "add a tag to xyz
    // test" was going to the wrong product, and why the vocabulary settles it.
    expect([...(owners.get("tag") ?? [])]).toEqual([tm.name]);
  });

  it("keeps a small product visible against a much larger one", () => {
    // tm carries 173 capabilities to loadtesting's 20. On words both share, tm simply has
    // more entries near the top and used to take the whole page — so an agent reading the
    // first row went to the wrong product. Rank order is untouched; what changed is that
    // being small can no longer make a product invisible.
    for (const query of ["add a tag to xyz test", "show a test's config"]) {
      const owners = searchCapabilities(BOTH, query, {}).hits.map(
        (h) => h.product,
      );
      expect(new Set(owners).size, query).toBeGreaterThan(1);
      expect(
        owners.filter((o) => o === lt.name).length,
        query,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not let the floor displace a clear winner", () => {
    // Guaranteeing a foothold must not cost the right answer its rank.
    const hits = searchCapabilities(BOTH, "list my load tests", {}).hits;
    expect(hits[0].product).toBe(lt.name);
    expect(hits.filter((h) => h.product === lt.name).length).toBeGreaterThan(3);
  });
});

describe("weakness is judged relative to the corpus, not absolutely", () => {
  // rarity is measured over whatever is searched, so the raw score is not comparable
  // between scopes: the same query scored 1.9 against loadtesting alone and 10.1 against
  // both. An absolute cut called one of those weak and the other strong.
  const LT_ONLY = { [lt.name]: lt.product } as any;

  it("does not call a good query weak just because its corpus is small", () => {
    const alone = searchCapabilities(LT_ONLY, "list my load tests", {});
    const mixed = searchCapabilities(BOTH, "list my load tests", {});
    expect(alone.top_matched).toBeLessThan(mixed.top_matched); // raw score is not portable
    expect(alone.weak).toBe(false); // the judgement is
    expect(mixed.weak).toBe(false);
  });

  it("still catches a query the product has no words for, in either scope", () => {
    for (const [label, scope] of [
      ["both", BOTH],
      ["lt only", LT_ONLY],
    ] as const) {
      const r = searchCapabilities(scope, "make a new bucket for my tests", {});
      expect(r.weak, label).toBe(true);
    }
  });

  it("reports the coverage it judged on", () => {
    const good = searchCapabilities(BOTH, "archive test cases in bulk", {});
    const bad = searchCapabilities(BOTH, "where do my things live", {});
    expect(good.coverage).toBeGreaterThan(bad.coverage * 5);
  });
});
