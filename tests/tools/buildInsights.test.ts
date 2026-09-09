import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { fetchBuildInsightsTool } from "../../src/tools/build-insights";
import { fetchFromBrowserStackAPI } from "../../src/lib/utils";
import { resolveHashedBuildId } from "../../src/tools/automate-utils/resolve-hashed-build-id";

vi.mock("../../src/lib/utils", () => ({
  fetchFromBrowserStackAPI: vi.fn(),
  handleMCPError: vi.fn(),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/tools/automate-utils/resolve-hashed-build-id", () => ({
  resolveHashedBuildId: vi.fn(),
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

const HASHED_ID = "ca9cccc228cf0e3ff3cb90dd62e2e2bfb4b20bc7";

describe("fetchBuildInsightsTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the build has no resolvable sessions; insights still succeed.
    (resolveHashedBuildId as Mock).mockRejectedValue(
      new Error("No BrowserStack sessions found"),
    );
  });

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
    expect(result.content[0].text).not.toContain("hashed_id");
    expect(result.content[1].text).toContain("Quality Gate Profiles");
  });

  it("SUCCESS: includes hashed_id when TRA returns a 40-char hex id", async () => {
    (fetchFromBrowserStackAPI as Mock)
      .mockResolvedValueOnce({
        name: "Test Build",
        hashed_id: HASHED_ID,
      })
      .mockResolvedValueOnce({});

    const result = await fetchBuildInsightsTool(
      { buildId: "build-123" },
      mockConfig,
    );

    expect(result.content[0].text).toContain(`"hashed_id": "${HASHED_ID}"`);
    expect(resolveHashedBuildId).not.toHaveBeenCalled();
  });

  it("SUCCESS: resolves hashed_id and session_type through the build's sessions", async () => {
    (fetchFromBrowserStackAPI as Mock)
      .mockResolvedValueOnce({ name: "Test Build" })
      .mockResolvedValueOnce({});
    (resolveHashedBuildId as Mock).mockResolvedValue({
      hashedBuildId: HASHED_ID,
      sessionId: "sess-1",
      sessionType: "app-automate",
    });

    const result = await fetchBuildInsightsTool(
      { buildId: "build-123" },
      mockConfig,
    );

    expect(resolveHashedBuildId).toHaveBeenCalledWith("build-123", mockConfig);
    expect(result.content[0].text).toContain(`"hashed_id": "${HASHED_ID}"`);
    expect(result.content[0].text).toContain('"session_type": "app-automate"');
  });

  it("SUCCESS: omits hashed_id when the build payload has none and resolution fails", async () => {
    (fetchFromBrowserStackAPI as Mock)
      .mockResolvedValueOnce({ name: "Test Build" })
      .mockResolvedValueOnce({});

    const result = await fetchBuildInsightsTool(
      { buildId: "build-123" },
      mockConfig,
    );

    expect(result.content[0].text).not.toContain("hashed_id");
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
