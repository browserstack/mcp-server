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

  it("says what each entity IS, not only what it answers to", () => {
    // Aliases route; they do not define. `version -> history, revision` tells a caller
    // which words land there and nothing about whether it versions a test case or a
    // project. The only other way to find out is describeEntity, once per entity — for
    // tm that is 19 calls at ~1.4KB each, paid exactly when the agent is least oriented.
    const vocab = vocabularyOf(BOTH);
    const described = vocab[tm.name].filter((e) => e.description);
    expect(described.length).toBe(vocab[tm.name].length);

    for (const entry of described) {
      // One line, capped by the build. Long enough to define, short enough that every
      // entity of every product can travel on one listProducts call.
      expect(entry.description!.length, entry.entity).toBeLessThanOrEqual(140);
      // A definition, not a restatement of the name: `tag: "tag"` would pass a presence
      // check and teach nothing.
      expect(
        entry.description!.toLowerCase().replace(/[^a-z]/g, ""),
        entry.entity,
      ).not.toBe(entry.entity.replace(/[^a-z]/g, ""));
    }

    // Absent, not empty, where a product has not authored them. loadtesting ships 9
    // entities and 0 descriptions today; that has to read as "unwritten" rather than as
    // a build that produced nothing.
    expect(vocab[lt.name].every((e) => e.description === undefined)).toBe(true);
  });

  it("answers within one product, so size cannot decide the answer", () => {
    // THE CROSS-PRODUCT FLOOR IS GONE, along with the problem it patched. tm carries 173
    // capabilities to loadtesting's 20, so on a word both share ("tag", "test", "config")
    // tm had more entries near the top and took the page — an agent reading the first row
    // went to the wrong product. The floor reserved two slots per product to stop that.
    //
    // searchCapability now REQUIRES `product`, so a search never spans products and the
    // floor could never fire. The bug is fixed harder: the product is chosen deliberately
    // against listProducts, or the user is asked, instead of being inferred from whichever
    // row ranked first.
    for (const query of ["add a tag to xyz test", "show a test's config"]) {
      for (const scope of [tm, lt]) {
        const hits = searchCapabilities(BOTH, query, {
          product: scope.name,
        }).hits;
        expect(new Set(hits.map((h) => h.product)), query).toEqual(
          new Set(hits.length ? [scope.name] : []),
        );
      }
    }
  });

  it("ranks strictly, with no reserved slots left to displace a winner", () => {
    // Scoped to its own product, the right answer takes the page outright — there is no
    // longer any mechanism that could hand a slot to something that did not earn it.
    const hits = searchCapabilities(BOTH, "list my load tests", {
      product: lt.name,
    }).hits;
    expect(hits[0].product).toBe(lt.name);
    expect(hits.every((h) => h.product === lt.name)).toBe(true);
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
