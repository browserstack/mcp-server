import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listBuildIds } from "../../src/tools/rca-agent-utils/list-build-ids";

const DAY_MS = 24 * 60 * 60 * 1000;
const LATEST_STARTED = "2026-06-22T07:00:00.000Z";
const ANCHOR_MS = Date.parse(LATEST_STARTED) + DAY_MS;

function jsonRes(body: any, ok = true, status = 200, statusText = "OK") {
  return { ok, status, statusText, json: async () => body } as any;
}

function build(n: number, extra: Record<string, any> = {}) {
  return {
    build_id: `b${n}`,
    build_number: n,
    status: "passed",
    started_at: `2026-06-2${n}`,
    name: "Suite",
    ...extra,
  };
}

// A page of builds in oldest-first order (as the real endpoint returns).
function page(nums: number[], next: string | null = null) {
  return jsonRes({
    builds: nums.map((n) => build(n)),
    pagination: { has_next: !!next, next_page: next },
  });
}

describe("listBuildIds", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns newest-first, capped at limit, using name+date filters and no user_name", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/builds/latest")) {
        return Promise.resolve(
          jsonRes({ project_id: 7, started_at: LATEST_STARTED }),
        );
      }
      // single window page, oldest-first #1..#7
      return Promise.resolve(page([1, 2, 3, 4, 5, 6, 7]));
    });

    const out = await listBuildIds("Proj", "Suite", "u", "k");

    // newest 5, newest-first
    expect(out.map((b) => b.build_number)).toEqual([7, 6, 5, 4, 3]);

    const latestUrl = fetchMock.mock.calls[0][0] as string;
    expect(latestUrl).toContain("/builds/latest");
    expect(latestUrl).not.toContain("user_name");

    const listUrl = fetchMock.mock.calls[1][0] as string;
    expect(listUrl).toContain("unique_build_names=Suite");
    expect(listUrl).toContain("date_range=");
    expect(listUrl).not.toContain("build_name=Suite");
  });

  it("follows pagination within a window", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/builds/latest")) {
        return Promise.resolve(
          jsonRes({ project_id: 1, started_at: LATEST_STARTED }),
        );
      }
      if (url.includes("next_page=TOK")) {
        return Promise.resolve(page([3, 4, 5, 6]));
      }
      return Promise.resolve(page([1, 2], "TOK"));
    });

    const out = await listBuildIds("Proj", "Suite", "u", "k");

    expect(out.map((b) => b.build_number)).toEqual([6, 5, 4, 3, 2]);
  });

  it("widens the window when the narrowest is too sparse", async () => {
    const window2Start = ANCHOR_MS - 2 * DAY_MS;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/builds/latest")) {
        return Promise.resolve(
          jsonRes({ project_id: 1, started_at: LATEST_STARTED }),
        );
      }
      // 2-day window: only 2 builds -> not enough, must widen
      if (url.includes(`date_range=${window2Start}`)) {
        return Promise.resolve(page([10, 11]));
      }
      // wider window: enough builds
      return Promise.resolve(page([20, 21, 22, 23, 24, 25]));
    });

    const out = await listBuildIds("Proj", "Suite", "u", "k");

    expect(out.map((b) => b.build_number)).toEqual([25, 24, 23, 22, 21]);
  });

  it("throws a clear error when the project cannot be resolved", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}));
    await expect(listBuildIds("Proj", "Nope", "u", "k")).rejects.toThrow(
      /No builds found/,
    );
  });

  it("throws when the latest-build request fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}, false, 404, "Not Found"));
    await expect(listBuildIds("Proj", "X", "u", "k")).rejects.toThrow(
      /Failed to resolve project: 404/,
    );
  });
});
