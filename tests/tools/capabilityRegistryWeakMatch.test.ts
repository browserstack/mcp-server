import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

import { searchCapabilities } from "../../src/tools/capability-registry/search.js";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
const CONFIG = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as any;

const index = JSON.parse(
  (await import("node:fs")).readFileSync(FIXTURE, "utf8"),
);
const PRODUCTS = { tm: index.products ? index.products.tm : index.tm } as any;

describe("weak matches — the failure lexical search cannot fix", () => {
  // "bucket" is nobody's word for a folder, and no scoring change reaches it: the term is
  // simply absent from the index. The recorded eval miss for this query says as much. What
  // the scorer CAN do is notice that it found nothing worth much and say so.
  it("flags a query written in the caller's vocabulary rather than the product's", () => {
    const result = searchCapabilities(
      PRODUCTS,
      "make a new bucket for my tests",
      {},
    );
    expect(result.weak).toBe(true);
    // The trap this exists for: it still returns a full page of confident-looking hits.
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("does not flag a query that speaks the product's language", () => {
    for (const query of [
      "archive test cases in bulk",
      "create a test run",
      "upload an attachment to a test case",
    ]) {
      expect(searchCapabilities(PRODUCTS, query, {}).weak, query).toBe(false);
    }
  });

  it("reports the score it judged on, so the threshold is auditable", () => {
    const weak = searchCapabilities(PRODUCTS, "where do my things live", {});
    const strong = searchCapabilities(
      PRODUCTS,
      "archive test cases in bulk",
      {},
    );
    expect(weak.top_matched).toBeLessThan(strong.top_matched);
  });

  it("is not weak when there is no query at all", () => {
    // An empty query is a browse, not a failed search — every capability matches by
    // definition, and offering vocabulary would be noise.
    expect(searchCapabilities(PRODUCTS, "", {}).weak).toBe(false);
  });
});

describe("searchCapability's vocabulary hand-off", () => {
  beforeEach(() => {
    process.env.CAPABILITY_REGISTRY_INDEX = FIXTURE;
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm.example";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
  });

  async function search(query: string) {
    const { BrowserStackMcpServer } =
      await import("../../src/server-factory.js");
    const tools = new BrowserStackMcpServer(CONFIG).getTools() as any;
    const raw = await tools.searchCapability.handler({ query }, {} as any);
    return JSON.parse(raw.content[0].text);
  }

  it("hands over the product's vocabulary when the match is weak", async () => {
    const result = await search("make a new bucket for my tests");
    expect(result.weak_match).toBe(true);
    expect(result.hint).toMatch(/suggested_vocabulary|describeEntity/);

    const vocabulary = result.suggested_vocabulary.tm;
    expect(vocabulary.length).toBeGreaterThan(10);
    // The entity the caller actually wants has to be IN the block, or the hand-off is
    // pointless — the model cannot map `bucket` onto a word it was never shown.
    expect(vocabulary.map((e: any) => e.entity)).toContain("folder");
  });

  it("stays additive — the results are still there to act on", async () => {
    const result = await search("make a new bucket for my tests");
    expect(result.capabilities.length).toBeGreaterThan(0);
    // This is what makes a generous threshold safe: a false positive costs a little context,
    // never a withheld answer.
    expect(result.build_id).toBeTruthy();
  });

  it("says nothing extra when the search went well", async () => {
    const result = await search("archive test cases in bulk");
    expect(result.weak_match).toBeUndefined();
    expect(result.suggested_vocabulary).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  it("stays within an absolute byte budget", async () => {
    // Budgeted in BYTES, not as a fraction. It was 8% of a 38KB search; once search became
    // a shortlist the same 3.2KB is nearly half of a 6.8KB response — the block did not
    // grow, the baseline collapsed. A fraction would now fail for the wrong reason, while
    // the thing worth bounding is unchanged: under a thousand tokens, far less than the
    // wrong invoke it prevents.
    const result = await search("make a new bucket for my tests");
    const block = JSON.stringify(result.suggested_vocabulary).length;
    expect(block).toBeLessThan(4096);
  });
});
