import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTestIds } from "../../src/tools/rca-agent-utils/get-failed-test-id";
import { TestStatus } from "../../src/tools/rca-agent-utils/types";

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Build a failed test node the way the BrowserStack test-runs API returns it.
function failedNode(
  id: number,
  name: string,
  extra: Record<string, unknown> = {},
) {
  return {
    display_name: name,
    details: {
      status: "failed",
      run_count: 1,
      observability_url: `https://observability.browserstack.com/?details=${id}`,
      ...extra,
    },
  };
}

function mockFetchOnce(body: unknown) {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => body,
  });
}

const AUTH = "fake-user:fake-key";

describe("getTestIds — failure signature extraction", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("default: returns only test_id + test_name, no failure key", async () => {
    mockFetchOnce({
      hierarchy: [
        failedNode(101, "login test", {
          failure_categories: ["Assertion"],
          file_path: "spec/login.rb",
        }),
      ],
      pagination: { has_next: false, next_page: null },
    });

    const result = await getTestIds("build-1", AUTH, TestStatus.FAILED);

    expect(result).toEqual([{ test_id: "101", test_name: "login test", status: TestStatus.FAILED }]);
    expect(result[0]).not.toHaveProperty("failure");
  });

  it("calls the configured Automate base URL (default prod)", async () => {
    mockFetchOnce({
      hierarchy: [],
      pagination: { has_next: false, next_page: null },
    });

    await getTestIds("build-1", AUTH, TestStatus.FAILED);

    // Default base from config; override via BROWSERSTACK_AUTOMATION_BASE_URL
    // (e.g. a rengg/staging host) redirects the call without code changes.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://api-automation.browserstack.com/ext/v1/builds/build-1/testRuns",
      ),
      expect.anything(),
    );
  });

  it("includeFailureDetail: populates category, error_summary, file_path, flaky flags", async () => {
    mockFetchOnce({
      hierarchy: [
        failedNode(101, "login test", {
          failure_categories: ["Assertion", "Timeout"],
          file_path: "spec/login.rb",
          is_flaky: true,
          is_always_failing: false,
          is_new_failure: true,
          retries: [
            {
              logs: {
                TEST_FAILURE: ["Expected 200 but got 500\n  at line 42"],
              },
            },
          ],
        }),
      ],
      pagination: { has_next: false, next_page: null },
    });

    const [row] = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(row.test_id).toBe("101");
    expect(row.failure).toEqual({
      category: "Assertion, Timeout",
      error_summary: "Expected 200 but got 500\nat line 42",
      file_path: "spec/login.rb",
      is_flaky: true,
      is_always_failing: false,
      is_new_failure: true,
    });
  });

  it("error_summary keeps a message longer than 200 chars whole", async () => {
    const message =
      'Error: AI executor error for step "Tap on the Inputs bottom navigation menu and swipe left across the main screen until you find the screen with the textbox, then type \'Sample\' into the textfield": TC step timed out after 60s';
    mockFetchOnce({
      hierarchy: [
        failedNode(106, "ai step", {
          retries: [{ logs: { TEST_FAILURE: [message] } }],
        }),
      ],
      pagination: { has_next: false, next_page: null },
    });

    const [row] = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(row.failure?.error_summary).toBe(message);
  });

  it("error_summary keeps a multi-line message and the first frame outside libraries", async () => {
    const log = [
      "AssertionError: expected 'Limit 500' to equal 'Limit 1000'",
      "+ expected - actual",
      "-Limit 500",
      "+Limit 1000",
      "    at Context.<anonymous> (node_modules/expect-webdriverio/lib/matchers.js:12:3)",
      "    at Context.<anonymous> (test/specs/payment-limits.spec.js:42:15)",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n");
    mockFetchOnce({
      hierarchy: [
        failedNode(107, "limits", {
          retries: [{ logs: { TEST_FAILURE: [log] } }],
        }),
      ],
      pagination: { has_next: false, next_page: null },
    });

    const [row] = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(row.failure?.error_summary).toBe(
      [
        "AssertionError: expected 'Limit 500' to equal 'Limit 1000'",
        "+ expected - actual",
        "-Limit 500",
        "+Limit 1000",
        "at Context.<anonymous> (test/specs/payment-limits.spec.js:42:15)",
      ].join("\n"),
    );
  });

  it("error_summary caps a very long message and still keeps the frame", async () => {
    mockFetchOnce({
      hierarchy: [
        failedNode(102, "long error", {
          retries: [
            {
              logs: {
                TEST_FAILURE: [`\n\n${"E".repeat(1500)}\n    at spec.js:1:1`],
              },
            },
          ],
        }),
      ],
      pagination: { has_next: false, next_page: null },
    });

    const [row] = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(row.failure?.error_summary).toBe(`${"E".repeat(1000)}…\nat spec.js:1:1`);
  });

  it("error_summary shares a fixed budget when a build has many failures", async () => {
    const message = "M".repeat(900);
    mockFetchOnce({
      hierarchy: Array.from({ length: 600 }, (_, i) =>
        failedNode(1000 + i, `test ${i}`, {
          retries: [{ logs: { TEST_FAILURE: [message] } }],
        }),
      ),
      pagination: { has_next: false, next_page: null },
    });

    const rows = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);
    const total = rows.reduce(
      (sum, row) => sum + (row.failure?.error_summary?.length ?? 0),
      0,
    );

    expect(rows[0].failure?.error_summary).toBe(`${"M".repeat(200)}…`);
    expect(total).toBe(600 * 201);
  });

  it("error_summary is not trimmed when the failures fit the budget", async () => {
    const message = "M".repeat(900);
    mockFetchOnce({
      hierarchy: Array.from({ length: 20 }, (_, i) =>
        failedNode(2000 + i, `test ${i}`, {
          retries: [{ logs: { TEST_FAILURE: [message] } }],
        }),
      ),
      pagination: { has_next: false, next_page: null },
    });

    const rows = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(rows.every((row) => row.failure?.error_summary === message)).toBe(true);
  });

  it("error_summary keeps a mid-size failing build under the budget, frame included", async () => {
    const log = `${"M".repeat(900)}\n    at Context.<anonymous> (test/specs/limits.spec.js:42:15)`;
    mockFetchOnce({
      hierarchy: Array.from({ length: 50 }, (_, i) =>
        failedNode(3000 + i, `test ${i}`, {
          retries: [{ logs: { TEST_FAILURE: [log] } }],
        }),
      ),
      pagination: { has_next: false, next_page: null },
    });

    const rows = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);
    const total = rows.reduce(
      (sum, row) => sum + (row.failure?.error_summary?.length ?? 0),
      0,
    );

    expect(rows[0].failure?.error_summary).toBe(`${"M".repeat(400)}…`);
    expect(total).toBeLessThanOrEqual(20_000 + 50);
  });

  it("error_summary caps a long stack frame", async () => {
    const frame = `at a (${"x".repeat(5000)}.min.js:1:1)`;
    mockFetchOnce({
      hierarchy: [
        failedNode(108, "minified", {
          retries: [{ logs: { TEST_FAILURE: [`Boom\n    ${frame}`] } }],
        }),
      ],
      pagination: { has_next: false, next_page: null },
    });

    const [row] = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(row.failure?.error_summary).toBe(`Boom\n${frame.slice(0, 300)}…`);
  });

  it("handles object-shaped TEST_FAILURE entries ({ text })", async () => {
    mockFetchOnce({
      hierarchy: [
        failedNode(105, "text error", {
          retries: [
            { logs: { TEST_FAILURE: [{ text: "Timeout waiting for X" }] } },
          ],
        }),
      ],
      pagination: { has_next: false, next_page: null },
    });

    const [row] = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(row.failure?.error_summary).toBe("Timeout waiting for X");
  });

  it("handles object-shaped TEST_FAILURE entries ({ message })", async () => {
    mockFetchOnce({
      hierarchy: [
        failedNode(103, "obj error", {
          retries: [
            { logs: { TEST_FAILURE: [{ message: "NullPointer at Foo.bar" }] } },
          ],
        }),
      ],
      pagination: { has_next: false, next_page: null },
    });

    const [row] = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(row.failure?.error_summary).toBe("NullPointer at Foo.bar");
  });

  it("omits failure key when details carry no signal", async () => {
    mockFetchOnce({
      hierarchy: [failedNode(104, "bare")],
      pagination: { has_next: false, next_page: null },
    });

    const [row] = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(row).not.toHaveProperty("failure");
  });

  it("extracts a failed test even when run_count is 0 (JUnit-uploaded builds)", async () => {
    mockFetchOnce({
      hierarchy: [failedNode(142, "uploaded test", { run_count: 0 })],
      pagination: { has_next: false, next_page: null },
    });

    const result = await getTestIds("build-1", AUTH, TestStatus.FAILED);

    expect(result).toEqual([{ test_id: "142", test_name: "uploaded test", status: TestStatus.FAILED }]);
  });

  it("extracts signatures from nested children", async () => {
    mockFetchOnce({
      hierarchy: [
        {
          display_name: "suite",
          details: { status: "passed" },
          children: [
            failedNode(201, "child test", {
              failure_categories: "ProductError",
            }),
          ],
        },
      ],
      pagination: { has_next: false, next_page: null },
    });

    const result = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(result).toHaveLength(1);
    expect(result[0].test_id).toBe("201");
    expect(result[0].failure?.category).toBe("ProductError");
  });

  it("preserves signatures across paginated pages", async () => {
    mockFetchOnce({
      hierarchy: [failedNode(301, "p1", { failure_categories: ["A"] })],
      pagination: { has_next: true, next_page: "cursor-2" },
    });
    mockFetchOnce({
      hierarchy: [failedNode(302, "p2", { failure_categories: ["B"] })],
      pagination: { has_next: false, next_page: null },
    });

    const result = await getTestIds("build-1", AUTH, TestStatus.FAILED, true);

    expect(result.map((r) => r.test_id)).toEqual(["301", "302"]);
    expect(result[0].failure?.category).toBe("A");
    expect(result[1].failure?.category).toBe("B");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-ok response", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { ok: false, status: 401, statusText: "Unauthorized" },
    );

    await expect(
      getTestIds("build-1", AUTH, TestStatus.FAILED, true),
    ).rejects.toThrow("Failed to fetch test runs: 401");
  });
});
