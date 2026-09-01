import { describe, it, expect } from "vitest";
import { extractFailedTestIds } from "../../src/tools/rca-agent-utils/get-failed-test-id";
import { TestStatus } from "../../src/tools/rca-agent-utils/types";

const node = (details: any, display_name?: string, children: any[] = []) =>
  ({ details, display_name, children }) as any;

describe("extractFailedTestIds", () => {
  it("includes a status match even when run_count is 0 (the regression this fixes)", () => {
    const hierarchy = [
      node(
        {
          status: TestStatus.FAILED,
          run_count: 0,
          observability_url: "https://observability.bs.com/x?details=111",
        },
        "zero-run failure",
      ),
    ];

    const result = extractFailedTestIds(hierarchy, TestStatus.FAILED);

    expect(result).toEqual([
      { test_id: "111", test_name: "zero-run failure", status: TestStatus.FAILED },
    ]);
  });

  it("skips nodes with a non-matching status", () => {
    const hierarchy = [
      node({
        status: TestStatus.PASSED,
        run_count: 3,
        observability_url: "https://observability.bs.com/x?details=222",
      }),
    ];

    expect(extractFailedTestIds(hierarchy, TestStatus.FAILED)).toEqual([]);
  });

  it("does not crash and skips a node with missing details", () => {
    const hierarchy = [node(undefined, "no details"), node(null, "null")];

    expect(extractFailedTestIds(hierarchy, TestStatus.FAILED)).toEqual([]);
  });

  it("skips a status match that has no observability_url (no id to extract)", () => {
    const hierarchy = [node({ status: TestStatus.FAILED }, "no url")];

    expect(extractFailedTestIds(hierarchy, TestStatus.FAILED)).toEqual([]);
  });

  it("recurses into children and collects nested matches", () => {
    const hierarchy = [
      node({ status: TestStatus.PASSED }, "parent", [
        node(
          {
            status: TestStatus.FAILED,
            observability_url: "https://observability.bs.com/x?details=333",
          },
          "nested failure",
        ),
      ]),
    ];

    expect(extractFailedTestIds(hierarchy, TestStatus.FAILED)).toEqual([
      { test_id: "333", test_name: "nested failure", status: TestStatus.FAILED },
    ]);
  });

  it("falls back to a generated name when display_name is absent", () => {
    const hierarchy = [
      node({
        status: TestStatus.FAILED,
        observability_url: "https://observability.bs.com/x?details=444",
      }),
    ];

    expect(extractFailedTestIds(hierarchy, TestStatus.FAILED)).toEqual([
      { test_id: "444", test_name: "Test 444", status: TestStatus.FAILED },
    ]);
  });

  it("returns ALL tests (any status) with per-test status when no status is passed", () => {
    const hierarchy = [
      node(
        {
          status: TestStatus.PASSED,
          observability_url: "https://o.bs.com/x?details=1",
        },
        "passed test",
      ),
      node(
        {
          status: TestStatus.FAILED,
          observability_url: "https://o.bs.com/x?details=2",
        },
        "failed test",
      ),
      node(
        {
          status: TestStatus.SKIPPED,
          observability_url: "https://o.bs.com/x?details=3",
        },
        "skipped test",
      ),
    ];

    // No status arg → every real test node, each carrying its own status.
    expect(extractFailedTestIds(hierarchy)).toEqual([
      { test_id: "1", test_name: "passed test", status: TestStatus.PASSED },
      { test_id: "2", test_name: "failed test", status: TestStatus.FAILED },
      { test_id: "3", test_name: "skipped test", status: TestStatus.SKIPPED },
    ]);
  });

  it("includeFailureDetail attaches a signature only to FAILED tests", () => {
    const hierarchy = [
      node(
        {
          status: TestStatus.PASSED,
          observability_url: "https://o.bs.com/x?details=10",
          failure_categories: ["ShouldBeIgnored"],
        },
        "passed",
      ),
      node(
        {
          status: TestStatus.FAILED,
          observability_url: "https://o.bs.com/x?details=11",
          failure_categories: ["ProductError"],
        },
        "failed",
      ),
    ];

    const result = extractFailedTestIds(hierarchy, undefined, true);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.test_id === "10")?.failure).toBeUndefined();
    expect(result.find((r) => r.test_id === "11")?.failure?.category).toBe(
      "ProductError",
    );
  });
});
