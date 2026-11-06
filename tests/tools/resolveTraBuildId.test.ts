import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { apiClient } from "../../src/lib/apiClient";
import { SessionType } from "../../src/lib/constants";
import {
  mapHashedToTra,
  resolveTraBuildIdFromHashed,
  TraBuildNotFoundError,
} from "../../src/tools/automate-utils/resolve-tra-build-id";
import { resolveHashedBuildId } from "../../src/tools/automate-utils/resolve-hashed-build-id";

vi.mock("../../src/lib/apiClient", () => ({ apiClient: { get: vi.fn() } }));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: () => "user:key",
}));
vi.mock("../../src/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/tools/rca-agent-utils/constants", () => ({
  getAutomationBaseUrl: () => "https://api-automation.browserstack.com",
}));
vi.mock(
  "../../src/tools/automate-utils/resolve-hashed-build-id",
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    resolveHashedBuildId: vi.fn(),
  }),
);

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};
const HASHED = "df9fde1187c547ea157e6e683289ed17ad58452c";
const TRA_ID = "bqmruo3dnu8bsuvyvshvxz13ku8quja0w5xz7w42";

const ok = (data: unknown) => ({ ok: true, status: 200, data });
const notFound = { ok: false, status: 404, statusText: "Not Found", data: {} };
const sessionList = ok([
  {
    automation_session: {
      hashed_id: "s1",
      project_name: "Mobile",
      build_name: "nightly-42",
    },
  },
]);

describe("resolveTraBuildIdFromHashed", () => {
  beforeEach(() => vi.resetAllMocks());

  it("maps via the session's project and build name, and confirms the run", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url, params }) => {
      if (url.includes("/automate/builds/")) return notFound;
      if (url.includes("/app-automate/builds/")) return sessionList;
      if (url.endsWith("/builds/latest")) {
        expect(params).toEqual({
          project_name: "Mobile",
          build_name: "nightly-42",
        });
        return ok({ build_id: TRA_ID });
      }
      throw new Error(url);
    });
    (resolveHashedBuildId as Mock).mockResolvedValue({
      hashedBuildId: HASHED,
      sessionId: "s1",
      sessionType: SessionType.AppAutomate,
    });

    await expect(resolveTraBuildIdFromHashed(HASHED, config)).resolves.toEqual({
      traBuildId: TRA_ID,
      hashedBuildId: HASHED,
      sessionType: SessionType.AppAutomate,
      projectName: "Mobile",
      buildName: "nightly-42",
    });
  });

  it("finds an older run of the same name in the project's builds", async () => {
    const OLDER = "olderrun0000000000000000000000000000abcd";
    const calls: any[] = [];
    (apiClient.get as Mock).mockImplementation(async ({ url, params }) => {
      calls.push({ url, params });
      if (url.endsWith("/builds/latest")) return ok({ build_id: TRA_ID });
      if (url.endsWith(`/ext/v1/builds/${TRA_ID}`))
        return ok({ name: "nightly" });
      if (url.endsWith("/ext/v1/projects"))
        return ok({ projects: [{ id: 7, name: "Mobile" }], pagination: {} });
      if (url.endsWith("/ext/v1/projects/7/builds"))
        return ok({
          builds: [
            {
              build_id: TRA_ID,
              name: "nightly",
              original_name: "nightly-42",
              started_at: "2026-11-05T10:00:00Z",
            },
            {
              build_id: "otherbuild",
              name: "nightly",
              original_name: "nightly-41",
              started_at: "2026-11-01T10:00:00Z",
            },
            {
              build_id: OLDER,
              name: "nightly",
              original_name: "nightly-42",
              started_at: "2026-10-01T10:05:00Z",
            },
          ],
          pagination: { has_next: false },
        });
      return ok([
        {
          automation_session: {
            hashed_id: "s1",
            project_name: "Mobile",
            build_name: "nightly-42",
            created_at: "2026-10-01T10:00:00Z",
          },
        },
      ]);
    });
    (resolveHashedBuildId as Mock).mockImplementation(async (id: string) => ({
      hashedBuildId: id === OLDER ? HASHED : "a-different-run",
      sessionId: "s1",
      sessionType: SessionType.Automate,
    }));

    await expect(
      resolveTraBuildIdFromHashed(HASHED, config),
    ).resolves.toMatchObject({
      traBuildId: OLDER,
      hashedBuildId: HASHED,
    });
    // The walk is narrowed to the dashboard label of the latest run.
    expect(
      calls.find((c) => c.url.endsWith("/projects/7/builds"))?.params
        .unique_build_names,
    ).toBe("nightly");
    // Only the same SDK name is confirmed; "nightly-41" is never checked.
    expect((resolveHashedBuildId as Mock).mock.calls.map((c) => c[0])).toEqual([
      TRA_ID,
      OLDER,
    ]);
  });

  it("refuses rather than returning the wrong build when no run matches", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) => {
      if (url.endsWith("/builds/latest")) return ok({ build_id: TRA_ID });
      if (url.endsWith("/ext/v1/projects"))
        return ok({ projects: [{ id: 7, name: "Mobile" }], pagination: {} });
      if (url.endsWith("/ext/v1/projects/7/builds"))
        return ok({ builds: [], pagination: { has_next: false } });
      if (url.includes("/ext/v1/builds/")) return notFound;
      return sessionList;
    });
    (resolveHashedBuildId as Mock).mockResolvedValue({
      hashedBuildId: "a-different-run",
      sessionId: "s9",
      sessionType: SessionType.Automate,
    });

    await expect(resolveTraBuildIdFromHashed(HASHED, config)).rejects.toThrow(
      /matches no TRA run in the last year/,
    );
  });

  it("explains a build that never reported to TRA", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) =>
      url.endsWith("/builds/latest") ? notFound : sessionList,
    );

    await expect(resolveTraBuildIdFromHashed(HASHED, config)).rejects.toThrow(
      /has no TRA build: only runs through the BrowserStack SDK/,
    );
  });

  it("flags ids that neither product knows", async () => {
    (apiClient.get as Mock).mockResolvedValue(notFound);

    const error = await resolveTraBuildIdFromHashed(HASHED, config).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(TraBuildNotFoundError);
    expect(error.unknownToAutomate).toBe(true);
  });
});

describe("mapHashedToTra", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps the original 404 and points to listBuildId for unknown ids", async () => {
    (apiClient.get as Mock).mockResolvedValue(notFound);

    await expect(
      mapHashedToTra(HASHED, new Error("Failed: 404 Not Found"), config),
    ).rejects.toThrow(
      "Failed: 404 Not Found. No TRA build has this id; get one with listBuildId.",
    );
  });
});
