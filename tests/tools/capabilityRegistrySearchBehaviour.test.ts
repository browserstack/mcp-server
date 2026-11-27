import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { searchCapabilities } from "../../src/tools/capability-registry/search.js";

/**
 * Search behaviour on a FIXED index copy (tests/fixtures/capability/tm.capability-index.json).
 *
 * The ranking gate itself (search-eval cases, maxRank, baselines) moved to
 * tests/tools/indexEval.test.ts, which reads the SHIPPED indexes in both profiles. The tests
 * here pin how the scorer treats words, so they use a copy that does not change under them.
 */
const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
const registry = CapabilityRegistry.fromFile(FIXTURE);

describe("search behaviour", () => {
  it("keeps the entity names listProducts hands out usable as queries", () => {
    // `test_case` is what the documented flow gives the model (listProducts names the
    // entities; listEntities was folded into it). When `_` was a word
    // character it tokenized as one term that no haystack could contain, so following the
    // instructions scored worse than ignoring them.
    for (const [underscored, spaced] of [
      ["test_case detail", "test case detail"],
      ["list test_runs", "list test runs"],
    ]) {
      const a = searchCapabilities(registry.index.products, underscored, {
        limit: 1,
      });
      const b = searchCapabilities(registry.index.products, spaced, {
        limit: 1,
      });
      expect(a.hits[0]?.capability.path, underscored).toBe(
        b.hits[0]?.capability.path,
      );
    }
  });

  it("searches parameter names, descriptions and enum values", () => {
    // 330 parameter descriptions and 34 value lists ship in the artifact. A caller's word
    // is often the VALUE they mean to send: `pass` and `fail` exist nowhere in the index
    // except the status enum on the test-result writes.
    //
    // ASSERTED BY ENTITY, NOT BY PATH SPELLING, and that is a concession. This used to
    // require a path ending `/test-results` and got it at rank 1. It no longer does:
    // the v2 additions spell the same thing `/results`, and the exploratory-session logs
    // carry pass/fail/retest in their own enums, so they take the top three slots. What
    // still holds — and is what this test is actually for — is that a VALUE the caller
    // means to send reaches the writes that record it. Which endpoint wins is a ranking
    // question, tracked by the eval set above, not by this test.
    const hits = searchCapabilities(
      registry.index.products,
      "pass fail retest",
      { limit: 5 },
    );
    expect(hits.hits.some((h) => h.capability.entity === "result")).toBe(true);
  });

  it("reaches a plural haystack from a singular query, and the reverse", () => {
    // Containment covers singular query -> plural text; termForms covers the other way.
    const singular = searchCapabilities(registry.index.products, "attachment", {
      limit: 3,
    });
    expect(
      singular.hits.some((h) => h.capability.path.includes("attachments")),
    ).toBe(true);
    const plural = searchCapabilities(registry.index.products, "folders", {
      limit: 3,
    });
    expect(
      plural.hits.some((h) => h.capability.path.includes("/folder/")),
    ).toBe(true);
  });
});
