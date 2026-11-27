import { describe, expect, it } from "vitest";

import {
  guardProblems,
  type EvalFixture,
} from "../../scripts/lib/index-eval.js";

// The L2 fixture rules that CI checks against the target branch (eval-index.mts --guard).
const fixture = (
  cases: EvalFixture["cases"],
  retired?: EvalFixture["retired"],
): Record<string, EvalFixture> => ({
  tm: { product: "tm", cases, ...(retired ? { retired } : {}) },
});
const A = { q: "create a folder", name: "create_folder", maxRank: 2 };
const B = { q: "list runs", name: "list_test_runs", maxRank: 1 };

describe("guardProblems", () => {
  it("passes when nothing changed", () => {
    const side = { allow: ["tm/x"], fixtures: fixture([A, B]) };
    expect(guardProblems(side, side)).toEqual([]);
  });

  it("lets the allowlist shrink, and fails when a name is added", () => {
    const before = { allow: ["tm/x", "tm/y"], fixtures: {} };
    expect(guardProblems(before, { allow: ["tm/x"], fixtures: {} })).toEqual(
      [],
    );
    const added = guardProblems(before, {
      allow: ["tm/x", "tm/y", "tm/z"],
      fixtures: {},
    });
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("tm/z");
  });

  it("does not check the allowlist when the base has none yet", () => {
    expect(
      guardProblems({ fixtures: {} }, { allow: ["tm/x"], fixtures: {} }),
    ).toEqual([]);
  });

  it("lets a maxRank tighten, and needs a new why to loosen it", () => {
    const before = { fixtures: fixture([A]) };
    expect(
      guardProblems(before, { fixtures: fixture([{ ...A, maxRank: 1 }]) }),
    ).toEqual([]);
    expect(
      guardProblems(before, { fixtures: fixture([{ ...A, maxRank: 3 }]) }),
    ).toHaveLength(1);
    expect(
      guardProblems(before, {
        fixtures: fixture([
          { ...A, maxRank: 3, why: "new sibling create_root_folder" },
        ]),
      }),
    ).toEqual([]);
  });

  it("needs a new why, not the old one, to loosen again", () => {
    const old = { ...A, why: "first reason" };
    expect(
      guardProblems(
        { fixtures: fixture([old]) },
        { fixtures: fixture([{ ...old, maxRank: 4 }]) },
      ),
    ).toHaveLength(1);
  });

  it("treats a case that becomes a miss as loosened", () => {
    const { maxRank: _drop, ...rest } = A;
    void _drop;
    const miss = { ...rest, miss: "pushed out" };
    expect(
      guardProblems({ fixtures: fixture([A]) }, { fixtures: fixture([miss]) }),
    ).toHaveLength(1);
  });

  it("needs a retired entry with a why for a removed case", () => {
    const before = { fixtures: fixture([A, B]) };
    expect(guardProblems(before, { fixtures: fixture([A]) })).toHaveLength(1);
    expect(
      guardProblems(before, {
        fixtures: fixture(
          [A],
          [{ q: B.q, why: "capability removed from the index" }],
        ),
      }),
    ).toEqual([]);
    expect(
      guardProblems(before, { fixtures: fixture([A], [{ q: B.q, why: " " }]) }),
    ).toHaveLength(1);
  });

  it("ignores a product that is new in this change", () => {
    expect(guardProblems({ fixtures: {} }, { fixtures: fixture([A]) })).toEqual(
      [],
    );
  });
});
