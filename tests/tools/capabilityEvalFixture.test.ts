import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The eval fixture is data, so nothing type-checks it, and a case that asserts on something
 * which cannot exist still READS like coverage.
 *
 * Case 1 asserted on folders named `__mcp-readonly__` and `__mcp-scratch__`. The seeder has
 * always named them `__readonly__` and `__scratch__`, so the assert could never hold — and it
 * was scored PASS in two consecutive full runs, because the grader took the agent's own report
 * rather than checking the response. The one case whose job was to prove the simplest scoped
 * read works was the case proving nothing, and both published figures were inflated by it.
 *
 * These checks are cheap and run without an account: they catch the mechanical half of that
 * failure — an `expects` naming a capability the registry does not publish, or a placeholder
 * nothing will ever resolve. The other half, verifying asserts against real responses, is the
 * grader's job and cannot be done here.
 */

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/tm-eval-e2e.json", import.meta.url)),
    "utf8",
  ),
);
const INDEX = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../capability/tm.capability-index.json", import.meta.url)),
    "utf8",
  ),
);

const PUBLISHED = new Set<string>(
  INDEX.tm.capabilities.map((c: { name: string }) => c.name),
);
const cases: any[] = FIXTURE.cases;

describe("the tm eval fixture describes things that exist", () => {
  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it("expects a capability the registry actually publishes", () => {
    // `__ask_the_user__` is the one legitimate non-capability: some cases are passed by
    // asking rather than by calling anything.
    const unknown = cases
      .filter((c) => c.expects !== "__ask_the_user__" && !PUBLISHED.has(c.expects))
      .map((c) => `${c.id} -> ${c.expects}`);
    expect(unknown).toEqual([]);
  });

  it("uses only placeholders the fixture declares it requires", () => {
    // Every {{a.b}} must be covered by an entry in fixture.requires, so a case cannot depend
    // on pool data the seeder was never asked to produce.
    const required: string[] = FIXTURE.fixture.requires;
    const undeclared: string[] = [];
    for (const c of cases) {
      const text = JSON.stringify({
        query: c.query, setup: c.setup, asserts: c.asserts,
        validates: c.validates, pre_run: c.pre_run,
      });
      for (const [, path] of text.matchAll(/\{\{([a-z_]+(?:\.[a-z_0-9]+)*)\}\}/g)) {
        if (!required.some((r) => path === r || path.startsWith(`${r}.`))) {
          undeclared.push(`${c.id} -> {{${path}}}`);
        }
      }
    }
    expect([...new Set(undeclared)]).toEqual([]);
  });

  it("gives every case an id, a query, and something to check", () => {
    const thin = cases
      .filter((c) => !c.id || !c.query || !c.expects || !(c.asserts?.length > 0))
      .map((c) => c.id ?? "<no id>");
    expect(thin).toEqual([]);
  });

  it("names no product in any query", () => {
    // Naming the product suppresses the clash gate, which half these cases exist to measure.
    // "browserstack" is deliberately allowed: no index claims it, so it cannot settle a clash.
    const named = cases
      .filter((c) => /\b(test[- ]?management|\btm\b|tra|load ?testing)\b/i.test(c.query))
      .map((c) => c.id);
    expect(named).toEqual([]);
  });

  it("marks every write case as one, so the master knows to expect an approval", () => {
    const writes = cases.filter((c) => PUBLISHED.has(c.expects) &&
      INDEX.tm.capabilities.find((x: any) => x.name === c.expects)?.mode === "write");
    for (const c of writes) {
      expect(c.setup?.writes, `${c.id} invokes a write capability`).toBe(true);
      expect(
        c.asserts.some((a: string) => /approval|permission/i.test(a)),
        `${c.id} must assert that approval was requested`,
      ).toBe(true);
    }
  });

  it("runs no destructive capability", () => {
    // The registry refuses destructive capabilities outright, and an eval is not the place to
    // discover otherwise. Three P0 workflows in the source sheet are destructive — bulk
    // delete cases, bulk delete results, delete a folder — and are deliberately not here.
    const destructive = cases.filter((c) =>
      INDEX.tm.capabilities.find((x: any) => x.name === c.expects)?.mode === "destructive",
    );
    expect(destructive.map((c) => c.id)).toEqual([]);
  });
});
