import { describe, expect, it } from "vitest";

import {
  PROFILES,
  describeCase,
  loadRegistry,
  loadSearchFixtures,
  matches,
  rankIn,
  rawCapabilities,
  shippedIndexFiles,
  type EvalCase,
} from "../../scripts/lib/index-eval.js";

/**
 * L2 check 2 (Findable): for a typical user question, is the right capability near the top?
 *
 * Reads the SHIPPED capability/*.capability-index.json, in both profiles:
 *   local   what the npm package serves
 *   remote  what the hosted server serves (REMOTE_MCP=true)
 *
 * One fixture per product in tests/fixtures/search-eval/<product>.json. Each case is one
 * search of one product, the way `searchCapability(product, query)` runs it.
 *
 *   maxRank  the worst allowed position in the top 8. The gate.
 *   miss     a known gap. The case fails when search starts to find it: promote it to a maxRank.
 *
 * A case whose capability is `disabled` in the index cannot be found on purpose. It stays in
 * the fixture, and it is checked again when the capability is enabled.
 *
 * To see WHICH new capabilities pushed a case down:
 *   npx tsx scripts/eval-index.mts --product <p> --against main
 */
const FIXTURES = loadSearchFixtures();
const RAW = rawCapabilities();
const REGISTRIES = Object.fromEntries(
  PROFILES.map((p) => [p, loadRegistry(p).index.products]),
);

/** The capability a case names, from the raw index. */
function target(product: string, entry: EvalCase) {
  return (RAW[product] ?? []).find((c) => matches(c, entry));
}

describe("search-eval fixtures", () => {
  it("has a fixture for every shipped index, and no fixture without one", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(
      Object.keys(shippedIndexFiles()).sort(),
    );
  });

  for (const [product, fixture] of Object.entries(FIXTURES)) {
    it(`${product}: every case is well formed and names a real capability`, () => {
      expect(fixture.product).toBe(product);
      const problems: string[] = [];
      for (const entry of fixture.cases) {
        const named = entry.name ? 1 : 0;
        const routed = entry.method && entry.path ? 1 : 0;
        if (named + routed !== 1)
          problems.push(`${entry.q}: set "name", or "method" + "path"`);
        if ((entry.maxRank === undefined) === (entry.miss === undefined))
          problems.push(`${entry.q}: set exactly one of "maxRank" and "miss"`);
        if (
          entry.maxRank !== undefined &&
          !(entry.maxRank >= 1 && entry.maxRank <= 8)
        )
          problems.push(`${entry.q}: maxRank must be 1-8`);
        if (!target(product, entry))
          problems.push(
            `${entry.q}: ${describeCase(entry)} is not in ${product}'s index`,
          );
      }
      expect(problems).toEqual([]);
    });
  }
});

describe.each(PROFILES)("search ranking, %s profile", (profile) => {
  const products = REGISTRIES[profile];

  for (const [product, fixture] of Object.entries(FIXTURES)) {
    const live = fixture.cases.filter(
      (entry) => !target(product, entry)?.disabled,
    );
    if (live.length === 0) continue;

    describe(product, () => {
      it.each(live.map((entry) => [entry.q, entry] as const))(
        "%s",
        (_q, entry) => {
          const { rank, hit, top } = rankIn(products, product, entry);
          const list = top.map((c, i) => `${i + 1}. ${c.name}`).join("\n");

          if (profile === "remote" && entry.remote === "withheld") {
            expect(
              rank,
              `${describeCase(entry)} must not be found on remote`,
            ).toBe(0);
            return;
          }
          if (entry.miss) {
            expect(
              rank,
              `known miss is now found at ${rank}: promote it to a maxRank\n${list}`,
            ).toBe(0);
            return;
          }
          expect(
            rank,
            `${describeCase(entry)} is not in the top 8\n${list}`,
          ).toBeGreaterThan(0);
          expect(
            rank,
            `${describeCase(entry)} is at ${rank}, allowed ${entry.maxRank}\n${list}`,
          ).toBeLessThanOrEqual(entry.maxRank!);
          if (profile === "remote" && entry.remote === "reference") {
            expect(hit?.invocable, "reference-only on remote").toBe(false);
          }
        },
      );
    });
  }
});

describe("search-eval baselines", () => {
  // A fixture can state its headline numbers. They are floors, so a better ranker passes,
  // and a worse one fails even when no single case passes its maxRank.
  for (const [product, fixture] of Object.entries(FIXTURES)) {
    if (!fixture.baseline) continue;
    it(`${product}: local profile is not below its recorded baseline`, () => {
      const products = REGISTRIES.local;
      const live = fixture.cases.filter((e) => !target(product, e)?.disabled);
      const ranks = live.map((e) => rankIn(products, product, e).rank);
      const at = (k: number) => ranks.filter((r) => r > 0 && r <= k).length;
      const b = fixture.baseline!;
      expect(live.length, "baseline.cases").toBe(b.cases);
      expect(at(1), "top1").toBeGreaterThanOrEqual(b.top1);
      expect(at(3), "top3").toBeGreaterThanOrEqual(b.top3);
      expect(at(8), "top8").toBeGreaterThanOrEqual(b.top8);
      if (b.misses_by_defect) {
        const byDefect: Record<string, number> = {};
        for (const e of fixture.cases.filter((c) => c.miss))
          byDefect[e.defect ?? "unknown"] =
            (byDefect[e.defect ?? "unknown"] ?? 0) + 1;
        expect(byDefect).toEqual(b.misses_by_defect);
      }
    }, 60_000);
  }
});
