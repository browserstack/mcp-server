import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { fetchBuildInsightsTool } from "../../src/tools/build-insights";
import { fetchFromBrowserStackAPI } from "../../src/lib/utils";

vi.mock("../../src/lib/utils", () => ({
  fetchFromBrowserStackAPI: vi.fn(),
  handleMCPError: vi.fn(),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

describe("fetchBuildInsightsTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SUCCESS: returns build details and quality gates", async () => {
    (fetchFromBrowserStackAPI as Mock)
      .mockResolvedValueOnce({
        name: "Test Build",
        status: "done",
        duration: 120,
        user: "test-user",
        tags: ["smoke"],
        alerts: [],
        status_stats: { passed: 10, failed: 2 },
        failure_categories: {},
        smart_tags: [],
        unique_errors: { overview: "2 unique errors" },
        observability_url: "https://obs.browserstack.com/123",
      })
      .mockResolvedValueOnce({
        quality_gate_result: "passed",
        quality_profiles: [{ name: "Default", result: "passed" }],
      });

    const result = await fetchBuildInsightsTool(
      { buildId: "build-123" },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBe(2);
    expect(result.content[0].text).toContain("Build insights");
    expect(result.content[0].text).toContain("Test Build");
    expect(result.content[1].text).toContain("Quality Gate Profiles");
  });

  it("SUCCESS: handles missing quality gates data", async () => {
    (fetchFromBrowserStackAPI as Mock)
      .mockResolvedValueOnce({ name: "Build", status: "done" })
      .mockResolvedValueOnce({});

    const result = await fetchBuildInsightsTool(
      { buildId: "build-123" },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[1].text).toContain("No Quality Gate Profiles");
  });

  it("FAIL: throws error for invalid build ID", async () => {
    (fetchFromBrowserStackAPI as Mock).mockRejectedValue(
      new Error("Build not found"),
    );

    await expect(
      fetchBuildInsightsTool({ buildId: "invalid" }, mockConfig),
    ).rejects.toThrow("Build not found");
  });
});
