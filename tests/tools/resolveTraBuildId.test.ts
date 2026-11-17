import { HttpError } from "../../src/lib/error";
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
const HASHED = "aa00000000000000000000000000000000000001";
const TRA_ID = "zz000000000000000000000000000000000000a1";

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

  it("refuses an older run rather than searching for it", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) =>
      url.endsWith("/builds/latest") ? ok({ build_id: TRA_ID }) : sessionList,
    );
    (resolveHashedBuildId as Mock).mockResolvedValue({
      hashedBuildId: "a-different-run",
      sessionId: "s9",
      sessionType: SessionType.Automate,
    });

    await expect(resolveTraBuildIdFromHashed(HASHED, config)).rejects.toThrow(
      /is not the latest TRA build named "nightly-42"/,
    );
    // One session read and one latest lookup: no walk over older builds.
    const urls = (apiClient.get as Mock).mock.calls.map(([req]) => req.url);
    expect(urls.some((u: string) => u.includes("/ext/v1/projects"))).toBe(
      false,
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

describe("resolveTraBuildIdFromHashed: only 404 means another product", () => {
  beforeEach(() => vi.resetAllMocks());

  it("throws on a server error rather than trying the other product", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      data: {},
    });

    const error = await resolveTraBuildIdFromHashed(HASHED, config).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(503);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("does not hide an outage behind the confirmation step", async () => {
    (apiClient.get as Mock).mockImplementation(async ({ url }) =>
      url.endsWith("/builds/latest") ? ok({ build_id: TRA_ID }) : sessionList,
    );
    (resolveHashedBuildId as Mock).mockRejectedValue(
      new HttpError(
        "Failed to fetch test runs: 500 Internal Server Error",
        500,
      ),
    );

    await expect(resolveTraBuildIdFromHashed(HASHED, config)).rejects.toThrow(
      /500/,
    );
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
