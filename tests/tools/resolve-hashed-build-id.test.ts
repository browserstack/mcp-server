import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { SessionType } from "../../src/lib/constants";
import { apiClient } from "../../src/lib/apiClient";
import {
  findSessionIdForObservabilityBuild,
  isHashedBuildId,
  isObservabilityBuildUuid,
  resolveBuildIdFromSession,
  resolveHashedBuildId,
  sessionDetailsUrl,
} from "../../src/tools/automate-utils/resolve-hashed-build-id";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: () => "user:key",
}));
vi.mock("../../src/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/tools/rca-agent-utils/constants", () => ({
  getAutomationBaseUrl: () => "https://api-automation.browserstack.com",
}));

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};

const OBS_UUID = "3f2c1a4e-9b7d-4c6e-8a1f-2d3e4f5a6b7c";
const HASHED_BUILD = "001a4e3bced4a35275f5e39160a205fbcd2ba65b";
const SESSION_ID = "9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6";

function testRunsPage(
  tests: Array<{ id: number; session_id?: string | null }>,
  nextPage?: string,
) {
  return {
    ok: true,
    status: 200,
    data: {
      hierarchy: tests.map((t) => ({
        display_name: `test ${t.id}`,
        details: {
          status: "failed",
          observability_url: `https://observability.browserstack.com/x?details=${t.id}`,
          session_id: t.session_id,
        },
      })),
      pagination: nextPage
        ? { has_next: true, next_page: nextPage }
        : { has_next: false, next_page: null },
    },
  };
}

function sessionDetails(buildHashedId?: string) {
  return {
    ok: true,
    status: 200,
    data: {
      automation_session: buildHashedId
        ? { build_hashed_id: buildHashedId }
        : {},
    },
  };
}

describe("id shape helpers", () => {
  it("recognises observability UUIDs", () => {
    expect(isObservabilityBuildUuid(OBS_UUID)).toBe(true);
    expect(isObservabilityBuildUuid(` ${OBS_UUID.toUpperCase()} `)).toBe(true);
    expect(isObservabilityBuildUuid(HASHED_BUILD)).toBe(false);
    expect(isObservabilityBuildUuid("not-an-id")).toBe(false);
  });

  it("recognises 40-char hashed build ids", () => {
    expect(isHashedBuildId(HASHED_BUILD)).toBe(true);
    expect(isHashedBuildId(OBS_UUID)).toBe(false);
  });
});

describe("sessionDetailsUrl", () => {
  it("targets the Automate and App Automate session endpoints", () => {
    expect(sessionDetailsUrl(SessionType.Automate, "s/1")).toBe(
      "https://api.browserstack.com/automate/sessions/s%2F1.json",
    );
    expect(sessionDetailsUrl(SessionType.AppAutomate, "s1")).toBe(
      "https://api.browserstack.com/app-automate/sessions/s1.json",
    );
  });
});

describe("resolveBuildIdFromSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns build_hashed_id from the session payload", async () => {
    (apiClient.get as Mock).mockResolvedValue(sessionDetails(HASHED_BUILD));

    await expect(
      resolveBuildIdFromSession(SESSION_ID, SessionType.Automate, config),
    ).resolves.toBe(HASHED_BUILD);
    expect((apiClient.get as Mock).mock.calls[0][0].url).toBe(
      `https://api.browserstack.com/automate/sessions/${SESSION_ID}.json`,
    );
  });

  it("returns undefined on HTTP failure or a missing field", async () => {
    (apiClient.get as Mock).mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(
      resolveBuildIdFromSession(SESSION_ID, SessionType.Automate, config),
    ).resolves.toBeUndefined();

    (apiClient.get as Mock).mockResolvedValueOnce(sessionDetails());
    await expect(
      resolveBuildIdFromSession(SESSION_ID, SessionType.AppAutomate, config),
    ).resolves.toBeUndefined();
  });
});

describe("findSessionIdForObservabilityBuild", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the first session id in the test runs, skipping 'null'", async () => {
    (apiClient.get as Mock).mockResolvedValue(
      testRunsPage([
        { id: 1, session_id: "null" },
        { id: 2, session_id: SESSION_ID },
        { id: 3, session_id: "other" },
      ]),
    );

    await expect(
      findSessionIdForObservabilityBuild(OBS_UUID, config),
    ).resolves.toBe(SESSION_ID);
    expect((apiClient.get as Mock).mock.calls[0][0].url).toBe(
      `https://api-automation.browserstack.com/ext/v1/builds/${OBS_UUID}/testRuns`,
    );
  });

  it("follows pagination until a session id appears", async () => {
    (apiClient.get as Mock)
      .mockResolvedValueOnce(testRunsPage([{ id: 1, session_id: null }], "p2"))
      .mockResolvedValueOnce(testRunsPage([{ id: 2, session_id: SESSION_ID }]));

    await expect(
      findSessionIdForObservabilityBuild(OBS_UUID, config),
    ).resolves.toBe(SESSION_ID);
    expect((apiClient.get as Mock).mock.calls[1][0].params).toEqual({
      next_page: "p2",
    });
  });

  it("returns undefined when no test carries a session id", async () => {
    (apiClient.get as Mock).mockResolvedValue(
      testRunsPage([{ id: 1, session_id: null }]),
    );

    await expect(
      findSessionIdForObservabilityBuild(OBS_UUID, config),
    ).resolves.toBeUndefined();
  });

  it("stops after the page cap even if more pages exist", async () => {
    (apiClient.get as Mock).mockResolvedValue(
      testRunsPage([{ id: 1, session_id: null }], "more"),
    );

    await expect(
      findSessionIdForObservabilityBuild(OBS_UUID, config),
    ).resolves.toBeUndefined();
    expect(apiClient.get).toHaveBeenCalledTimes(5);
  });

  it("throws when the test runs API fails", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(
      findSessionIdForObservabilityBuild(OBS_UUID, config),
    ).rejects.toThrow(/Failed to fetch test runs/);
  });
});

describe("resolveHashedBuildId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves UUID → session → hashed build id with an explicit session type", async () => {
    (apiClient.get as Mock)
      .mockResolvedValueOnce(testRunsPage([{ id: 1, session_id: SESSION_ID }]))
      .mockResolvedValueOnce(sessionDetails(HASHED_BUILD));

    await expect(
      resolveHashedBuildId(OBS_UUID, config, SessionType.AppAutomate),
    ).resolves.toEqual({
      hashedBuildId: HASHED_BUILD,
      sessionId: SESSION_ID,
      sessionType: SessionType.AppAutomate,
    });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    expect((apiClient.get as Mock).mock.calls[1][0].url).toContain(
      "/app-automate/sessions/",
    );
  });

  it("falls back from Automate to App Automate when the type is unknown", async () => {
    (apiClient.get as Mock)
      .mockResolvedValueOnce(testRunsPage([{ id: 1, session_id: SESSION_ID }]))
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(sessionDetails(HASHED_BUILD));

    await expect(resolveHashedBuildId(OBS_UUID, config)).resolves.toEqual({
      hashedBuildId: HASHED_BUILD,
      sessionId: SESSION_ID,
      sessionType: SessionType.AppAutomate,
    });
    expect((apiClient.get as Mock).mock.calls[1][0].url).toContain(
      "/automate/sessions/",
    );
    expect((apiClient.get as Mock).mock.calls[2][0].url).toContain(
      "/app-automate/sessions/",
    );
  });

  it("explains when the build has no BrowserStack sessions", async () => {
    (apiClient.get as Mock).mockResolvedValue(
      testRunsPage([{ id: 1, session_id: null }]),
    );

    await expect(resolveHashedBuildId(OBS_UUID, config)).rejects.toThrow(
      /No BrowserStack sessions found/,
    );
  });

  it("fails clearly when the session does not report a build", async () => {
    (apiClient.get as Mock)
      .mockResolvedValueOnce(testRunsPage([{ id: 1, session_id: SESSION_ID }]))
      .mockResolvedValue(sessionDetails());

    await expect(
      resolveHashedBuildId(OBS_UUID, config, SessionType.Automate),
    ).rejects.toThrow(/Could not resolve the hashed build id/);
  });
});
