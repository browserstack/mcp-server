import { describe, it, expect } from "vitest";
import { productAnchors, ambiguousProducts } from "../../src/tools/capability-registry/search.js";
import { readFileSync } from "node:fs";

const load = (p: string) => { const j = JSON.parse(readFileSync(`capability/${p}.capability-index.json`, "utf8")); return j[p]; };
const products = { tm: load("tm"), tra: load("tra") } as any;

describe("productAnchors", () => {
  const cases: [string, string[]][] = [
    ["What did the last report say?", []],
    ["Did this build pass its quality gate?", ["tra"]],
    ["What test plans are active right now?", ["tm"]],
    ["Show me all datasets in the project", ["tm"]],
    ["the test management one", ["tm"]],
    ["test observability please", ["tra"]],
    ["Which tests are flaky?", []],
    ["Show me the tags on the Automate builds", ["tm", "tra"]],
    ["I mean the dashboards", ["tra"]],
  ];
  for (const [text, want] of cases)
    it(`${JSON.stringify(text)} -> ${want.join(",") || "none"}`, () =>
      expect(productAnchors(products, text).products).toEqual(want));
});

describe("ambiguity still fires on the shared nouns", () => {
  for (const q of ["What did the last report say?", "Show me the runs", "which project"])
    it(q, () => expect(ambiguousProducts(products, q).products.length).toBeGreaterThan(1));
});
