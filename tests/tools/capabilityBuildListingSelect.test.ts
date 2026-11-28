import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertSelectable,
  narrowResponse,
} from "../../src/tools/capability-registry/narrow.js";

const tra = JSON.parse(
  readFileSync("capability/tra.capability-index.json", "utf8"),
).tra;
const capability = tra.capabilities.find(
  (c: any) => c.name === "list_project_builds_by_name",
);

const row = (id: number, name: string) => ({
  uuid: `uuid-${id}`,
  id,
  name,
  buildNumber: id,
  startedAt: "2026-11-26T04:50:15.574+00:00",
  displayStatus: "failed",
  tags: ["ENV:nightly"],
  statusStats: { aggregate: 10, passed: 8, failed: 2 },
  issueTypeAggregate: { "To be Investigated": 2 },
  historyAggregate: { isFlaky: 0, isNewFailure: 1 },
  hostInfo: { hostname: "ci-runner" },
  observabilityVersion: { sdkVersion: "1.40.7" },
  workflowStatusStats: { Passed: 8, Failed: 2 },
});

const body = {
  id: 24302,
  name: "Nightly Project",
  builds: [row(2, "Login"), row(1, "Accounts")],
  pagingParams: { hasNext: true, searchAfter: ["uuid-1"] },
  activeCount: 2,
  closedCount: 0,
};

describe("list_project_builds_by_name select", () => {
  it("keeps the named fields on every build and the paging and counts beside them", () => {
    const fields = ["name", "buildNumber", "statusStats", "historyAggregate"];
    const narrowed = narrowResponse(capability, body, { fields })!.body as any;

    expect(narrowed.builds).toEqual([
      {
        name: "Login",
        buildNumber: 2,
        statusStats: { aggregate: 10, passed: 8, failed: 2 },
        historyAggregate: { isFlaky: 0, isNewFailure: 1 },
      },
      {
        name: "Accounts",
        buildNumber: 1,
        statusStats: { aggregate: 10, passed: 8, failed: 2 },
        historyAggregate: { isFlaky: 0, isNewFailure: 1 },
      },
    ]);
    expect(narrowed.pagingParams).toEqual(body.pagingParams);
    expect(narrowed.activeCount).toBe(2);
  });

  it("refuses a field it does not declare before anything is sent", () => {
    expect(() =>
      assertSelectable(capability, { fields: ["hostInfo"] }),
    ).toThrow(/hostInfo/);
  });

  it("returns the response as sent without select", () => {
    expect(narrowResponse(capability, body, undefined)).toBeUndefined();
  });
});
