import { describe, it, expect } from "vitest";
import {
  chunkArray,
  canAcceptScenario,
} from "../../src/tools/testmanagement-utils/TCG-utils/helpers";
import { TC_DETAILS_MAX_BATCH } from "../../src/tools/testmanagement-utils/TCG-utils/config";

describe("chunkArray", () => {
  it("returns an empty array when given no items", () => {
    expect(chunkArray([], 10)).toEqual([]);
  });

  it("keeps a single chunk when items fit within the size", () => {
    expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("does not split at exactly the batch size", () => {
    const ids = Array.from({ length: TC_DETAILS_MAX_BATCH }, (_, i) => i + 1);
    expect(chunkArray(ids, TC_DETAILS_MAX_BATCH)).toEqual([ids]);
  });

  it("splits a scenario with more than the batch size into <=size chunks", () => {
    // 23 test cases in one scenario -> 10 + 10 + 3, the PMAA-147 case.
    const ids = Array.from({ length: 23 }, (_, i) => i + 1);
    const chunks = chunkArray(ids, TC_DETAILS_MAX_BATCH);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length <= TC_DETAILS_MAX_BATCH)).toBe(true);
    expect(chunks.flat()).toEqual(ids);
  });

  it("throws on a chunk size below 1", () => {
    expect(() => chunkArray([1, 2], 0)).toThrow();
  });
});

describe("canAcceptScenario", () => {
  it("accepts while under the cap", () => {
    expect(canAcceptScenario({ a: 1 }, "b", 3)).toBe(true);
  });

  it("rejects a new scenario once the cap is reached", () => {
    const map = { a: 1, b: 1, c: 1 };
    expect(canAcceptScenario(map, "d", 3)).toBe(false);
  });

  it("still accepts an already-tracked scenario at the cap", () => {
    const map = { a: 1, b: 1, c: 1 };
    expect(canAcceptScenario(map, "a", 3)).toBe(true);
  });
});
