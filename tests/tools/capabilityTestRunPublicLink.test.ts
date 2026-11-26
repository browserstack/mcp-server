import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { searchCapabilities } from "../../src/tools/capability-registry/search.js";

const tm = JSON.parse(
  readFileSync("capability/tm.capability-index.json", "utf8"),
).tm;
const capability = tm.capabilities.find(
  (c: any) => c.name === "create_test_run_public_link",
);

describe("create_test_run_public_link", () => {
  it.each([
    "create a public link for test run TR-12",
    "public share link for a test run",
    "generate a shareable URL for my test run",
  ])("is the first result for %s", (query) => {
    const { hits } = searchCapabilities({ tm }, query, { product: "tm" });
    expect(hits[0].capability.name).toBe("create_test_run_public_link");
  });

  it("is a write that needs the run and project integer ids", () => {
    expect(capability.mode).toBe("write");
    expect(capability.method).toBe("POST");
    const required = capability.body
      .filter((field: any) => field.required)
      .map((field: any) => [field.name, field.type]);
    expect(required).toEqual([
      ["entity", "string"],
      ["entity_id", "integer"],
      ["project_id", "integer"],
    ]);
    expect(
      capability.body.find((field: any) => field.name === "entity").values,
    ).toEqual(["test_run"]);
  });

  it("is listed under the test run entity", () => {
    expect(tm.entities.test_run.capabilities).toContain(
      "create_test_run_public_link",
    );
  });
});
