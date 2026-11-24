import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { ambiguousProducts } from "../../src/tools/capability-registry/search.js";
import { narrowResponse } from "../../src/tools/capability-registry/narrow.js";

const products: Record<string, any> = {};
for (const file of readdirSync("capability")) {
  const json = JSON.parse(readFileSync(`capability/${file}`, "utf8"));
  for (const [name, index] of Object.entries(json))
    if (index && typeof index === "object" && "capabilities" in index)
      products[name] = index;
}

describe("generic words do not route to Load Testing", () => {
  it.each([
    "Give me a triage summary of today's nightly functional builds",
    "Fetch today's nightly functional builds and produce a TRA triage summary",
    "Show the build summary for the nightly run",
  ])("%s -> tra", (query) => {
    expect(ambiguousProducts(products, query).settled).toBe("tra");
  });

  it("still settles a summary that names a load test", () => {
    expect(
      ambiguousProducts(products, "start a load test run and show its summary")
        .settled,
    ).toBe("loadtesting");
  });

  it("does not raise a clash over `status`", () => {
    expect(
      ambiguousProducts(products, "What's the status of my latest build?").terms,
    ).not.toContain("statu");
  });
});

describe("get_build_failure_category_stats select", () => {
  const capability = products.tra.capabilities.find(
    (c: any) => c.name === "get_build_failure_category_stats",
  );
  const body = {
    data: [
      {
        id: "1",
        name: "Product Bug",
        value: 3,
        color: "#f00",
        categories: [
          { name: "UI", value: 3 },
          { name: "API", value: 0 },
        ],
      },
      { id: "2", name: "Automation Bug", value: 0, color: "#0f0", categories: [] },
    ],
    aiRcaStats: { completedCount: 2 },
    commentCount: 1,
  };

  it("keeps only the top-level counts and the fields beside them", () => {
    const narrowed = narrowResponse(capability, body, {
      fields: ["name", "value"],
    })!.body as any;

    expect(narrowed.data).toEqual([
      { name: "Product Bug", value: 3 },
      { name: "Automation Bug", value: 0 },
    ]);
    expect(narrowed.aiRcaStats).toEqual({ completedCount: 2 });
    expect(narrowed.commentCount).toBe(1);
  });

  it("returns the response as sent without select", () => {
    expect(narrowResponse(capability, body, undefined)).toBeUndefined();
  });
});
