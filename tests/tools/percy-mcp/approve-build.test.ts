import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { percyApproveBuild } from "../../../src/tools/percy-mcp/core/approve-build.js";

// ---------------------------------------------------------------------------
// Mock auth module — avoid real token resolution
// ---------------------------------------------------------------------------
vi.mock("../../../src/lib/percy-api/auth", () => ({
  getPercyHeaders: vi.fn().mockResolvedValue({
    Authorization: "Token token=fake-token",
    "Content-Type": "application/json",
    "User-Agent": "browserstack-mcp-server",
  }),
  getPercyApiBaseUrl: vi.fn().mockReturnValue("https://percy.io/api/v1"),
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => null,
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("percyApproveBuild", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. SUCCESS: approve build
  // -------------------------------------------------------------------------
  it("approves a build and returns confirmation", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        data: {
          id: "review-1",
          type: "reviews",
          attributes: {
            "review-state": "approved",
          },
        },
      }),
    );

    const result = await percyApproveBuild(
      { build_id: "12345", action: "approve" },
      mockConfig,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Build #12345 approve successful. Review state: approved",
    });

    // Verify the POST was made to /reviews
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("/reviews");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.data.type).toBe("reviews");
    expect(body.data.attributes.action).toBe("approve");
    expect(body.data.relationships.build.data).toEqual({
      type: "builds",
      id: "12345",
    });
    // No snapshots relationship for build-level actions
    expect(body.data.relationships.snapshots).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 2. SUCCESS: request_changes with snapshot_ids
  // -------------------------------------------------------------------------
  it("request_changes with snapshot_ids returns per-snapshot confirmation", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        data: {
          id: "review-2",
          type: "reviews",
          attributes: {
            "review-state": "changes_requested",
          },
        },
      }),
    );

    const result = await percyApproveBuild(
      {
        build_id: "12345",
        action: "request_changes",
        snapshot_ids: "snap-1, snap-2, snap-3",
      },
      mockConfig,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Build #12345 request_changes successful. Review state: changes_requested",
    });

    // Verify snapshot_ids were included in the body
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data.relationships.snapshots.data).toEqual([
      { type: "snapshots", id: "snap-1" },
      { type: "snapshots", id: "snap-2" },
      { type: "snapshots", id: "snap-3" },
    ]);
  });

  // -------------------------------------------------------------------------
  // 3. FAIL: request_changes without snapshot_ids
  // -------------------------------------------------------------------------
  it("returns error when request_changes is called without snapshot_ids", async () => {
    const result = await percyApproveBuild(
      { build_id: "12345", action: "request_changes" },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "request_changes requires snapshot_ids. This action works at snapshot level only.",
    });

    // No API call should be made
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. FAIL: invalid action
  // -------------------------------------------------------------------------
  it("returns error for invalid action with valid options listed", async () => {
    const result = await percyApproveBuild(
      { build_id: "12345", action: "merge" },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid action "merge"');
    expect(result.content[0].text).toContain("approve");
    expect(result.content[0].text).toContain("request_changes");
    expect(result.content[0].text).toContain("unapprove");
    expect(result.content[0].text).toContain("reject");

    // No API call should be made
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. EDGE: build already approved — returns current state from API
  // -------------------------------------------------------------------------
  it("returns current state when build is already approved", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        data: {
          id: "review-3",
          type: "reviews",
          attributes: {
            "review-state": "approved",
          },
        },
      }),
    );

    const result = await percyApproveBuild(
      { build_id: "99999", action: "approve" },
      mockConfig,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Build #99999 approve successful. Review state: approved",
    });
  });

  // -------------------------------------------------------------------------
  // 6. FAIL: API error is caught and returned as isError
  // -------------------------------------------------------------------------
  it("returns error result when the API call fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        { errors: [{ detail: "Build not found" }] },
        404,
      ),
    );

    const result = await percyApproveBuild(
      { build_id: "missing", action: "approve" },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to approve build #missing");
  });

  // -------------------------------------------------------------------------
  // 7. SUCCESS: reason is passed through in attributes
  // -------------------------------------------------------------------------
  it("includes reason in request attributes when provided", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        data: {
          id: "review-4",
          type: "reviews",
          attributes: {
            "review-state": "rejected",
          },
        },
      }),
    );

    await percyApproveBuild(
      {
        build_id: "12345",
        action: "reject",
        reason: "Visual regression detected",
      },
      mockConfig,
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data.attributes.reason).toBe("Visual regression detected");
  });
});
