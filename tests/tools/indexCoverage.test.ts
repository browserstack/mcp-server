import { describe, expect, it } from "vitest";

import {
  ALLOWLIST_FILE,
  coveredNames,
  loadRegistry,
  loadSearchFixtures,
  readJson,
  searchableNames,
  type Allowlist,
} from "../../scripts/lib/index-eval.js";

/**
 * L2 check 4 (Complete): does every capability have at least one search-eval case?
 *
 * "Every capability" = every capability a caller can find in the local profile, in every
 * shipped index. Disabled ones are not counted. A capability with no case must be on
 * tests/fixtures/search-eval/allowlist.json.
 *
 * The allowlist only SHRINKS. This test fails on a name that no longer needs to be there.
 * CI fails on a name that was added (scripts/eval-index.mts --guard, which needs git).
 * So a new capability needs a case in the same change.
 *
 *   npx tsx scripts/eval-index.mts --coverage     # what is missing, per product
 */
const products = loadRegistry("local").index.products;
const ALL = searchableNames(products);
const COVERED = coveredNames(products, loadSearchFixtures());
const ALLOW = readJson<Allowlist>(ALLOWLIST_FILE).names;

describe("search-eval coverage", () => {
  it("every capability has a case, or is on the allowlist", () => {
    const allowed = new Set(ALLOW);
    const missing = [...ALL.keys()].filter(
      (n) => !COVERED.has(n) && !allowed.has(n),
    );
    expect(
      missing,
      "Add a search-eval case for each (tests/fixtures/search-eval/<product>.json)",
    ).toEqual([]);
  });

  it("the allowlist names only capabilities that still need a case", () => {
    const covered = ALLOW.filter((n) => COVERED.has(n));
    expect(
      covered,
      "These have a case now. Remove them from the allowlist.",
    ).toEqual([]);
    const gone = ALLOW.filter((n) => !ALL.has(n));
    expect(
      gone,
      "These are not searchable capabilities (removed, renamed or disabled). Remove them from the allowlist.",
    ).toEqual([]);
  });

  it("the allowlist is sorted, with no duplicates", () => {
    expect(ALLOW).toEqual([...new Set(ALLOW)].sort());
  });
});
