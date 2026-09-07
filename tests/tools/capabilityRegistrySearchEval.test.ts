import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { searchCapabilities } from "../../src/tools/capability-registry/search.js";

/**
 * Ranking quality, pinned.
 *
 * The scorer's constants were fitted by hand against live mis-rankings, and nothing else in
 * the suite would notice if a change to tokenizing or weighting quietly undid that — every
 * other test asserts one query at a time. This asserts the whole set at once, so a ranking
 * regression fails here rather than in someone's editor.
 *
 * `maxRank` is a ceiling, not an expectation: a case that improves should have its ceiling
 * tightened. A case marked `miss` documents a query the lexical scorer cannot serve and why
 * — those are vocabulary gaps, fixed by authoring aliases in the harness, not here.
 */
interface EvalCase {
  q: string;
  method: string;
  path: string;
  maxRank?: number;
  miss?: string;
  why?: string;
}

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
const CASES: EvalCase[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/search-eval.json", import.meta.url)), "utf8"),
).cases;

const registry = CapabilityRegistry.fromFile(FIXTURE);

/** 1-based position of the expected endpoint in the top 8, or 0 when absent. */
function rankOf(entry: EvalCase): number {
  const hits = searchCapabilities(registry.index.products, entry.q, { limit: 8 });
  return (
    hits.hits.findIndex(
      (hit) => hit.capability.method === entry.method && hit.capability.path === entry.path,
    ) + 1
  );
}

describe("search ranking", () => {
  const expected = CASES.filter((entry) => !entry.miss);

  it.each(expected.map((entry) => [entry.q, entry] as const))(
    "ranks %s",
    (_query, entry) => {
      const rank = rankOf(entry);
      expect(rank, `${entry.method} ${entry.path} not in the top 8`).toBeGreaterThan(0);
      expect(rank).toBeLessThanOrEqual(entry.maxRank!);
    },
  );

  it("keeps the entity names listEntities hands out usable as queries", () => {
    // `test_case` is what the documented flow gives the model. When `_` was a word
    // character it tokenized as one term that no haystack could contain, so following the
    // instructions scored worse than ignoring them.
    for (const [underscored, spaced] of [
      ["test_case detail", "test case detail"],
      ["list test_runs", "list test runs"],
    ]) {
      const a = searchCapabilities(registry.index.products, underscored, { limit: 1 });
      const b = searchCapabilities(registry.index.products, spaced, { limit: 1 });
      expect(a.hits[0]?.capability.path, underscored).toBe(b.hits[0]?.capability.path);
    }
  });

  it("searches parameter names, descriptions and enum values", () => {
    // 330 parameter descriptions and 34 value lists ship in the artifact. A caller's word
    // is often the VALUE they mean to send: `pass` and `fail` exist nowhere in the index
    // except the status enum on the test-result writes.
    const hits = searchCapabilities(registry.index.products, "pass fail retest", { limit: 5 });
    expect(hits.hits.some((h) => h.capability.path.endsWith("/test-results"))).toBe(true);
  });

  it("reaches a plural haystack from a singular query, and the reverse", () => {
    // Containment covers singular query -> plural text; termForms covers the other way.
    const singular = searchCapabilities(registry.index.products, "attachment", { limit: 3 });
    expect(singular.hits.some((h) => h.capability.path.includes("attachments"))).toBe(true);
    const plural = searchCapabilities(registry.index.products, "folders", { limit: 3 });
    expect(plural.hits.some((h) => h.capability.path.includes("/folder/"))).toBe(true);
  });

  it("still serves the known misses no better than recorded", () => {
    // Not a target to hit — a record of where the ceiling is, so that authoring aliases
    // later shows up as a deliberate change to this file rather than a silent one.
    for (const entry of CASES.filter((c) => c.miss)) {
      expect(rankOf(entry), `${entry.q} — ${entry.miss}`).toBe(0);
    }
  });

  it("meets a floor on the set as a whole", () => {
    const ranks = expected.map(rankOf);
    const top1 = ranks.filter((r) => r === 1).length;
    const top3 = ranks.filter((r) => r > 0 && r <= 3).length;
    const top8 = ranks.filter((r) => r > 0).length;
    // Floors, deliberately a little below current, so an unrelated index refresh does not
    // fail the build over one position.
    expect(top8, `top-8 ${top8}/${expected.length}`).toBe(expected.length);
    expect(top3, `top-3 ${top3}/${expected.length}`).toBeGreaterThanOrEqual(expected.length - 1);
    expect(top1, `top-1 ${top1}/${expected.length}`).toBeGreaterThanOrEqual(13);
  });
});
