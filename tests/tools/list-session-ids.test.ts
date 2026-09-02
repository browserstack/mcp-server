import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { SessionType } from "../../src/lib/constants";
import { apiClient } from "../../src/lib/apiClient";
import {
  DEFAULT_SESSION_LIST_LIMIT,
  listSessionIds,
  mapSessionRecords,
  sessionsListUrl,
} from "../../src/tools/automate-utils/list-session-ids";
import { listSessionIdsTool } from "../../src/tools/automate";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

const samplePayload = [
  {
    automation_session: {
      name: "pricing_session",
      status: "done",
      hashed_id: "sess-aaa",
      os: "Windows",
      os_version: "11",
      browser: "chrome",
      device: null,
      browser_url: "https://automate.browserstack.com/sessions/sess-aaa",
    },
  },
  {
    automation_session: {
      name: "other",
      status: "running",
      hashed_id: "sess-bbb",
      os: "OS X",
      os_version: "Sonoma",
      browser: "firefox",
      device: null,
      browser_url: "https://automate.browserstack.com/sessions/sess-bbb",
    },
  },
];

describe("sessionsListUrl", () => {
  it("uses Automate REST host for automate", () => {
    expect(sessionsListUrl(SessionType.Automate, "build-1")).toBe(
      "https://api.browserstack.com/automate/builds/build-1/sessions.json",
    );
  });

  it("uses App Automate api-cloud host", () => {
    expect(sessionsListUrl(SessionType.AppAutomate, "build-1")).toBe(
      "https://api-cloud.browserstack.com/app-automate/builds/build-1/sessions.json",
    );
  });

  it("encodes the hashed build id", () => {
    expect(sessionsListUrl(SessionType.Automate, "a/b")).toContain(
      "builds/a%2Fb/sessions.json",
    );
  });
});

describe("mapSessionRecords", () => {
  it("maps hashed_id to sessionId and compact fields", () => {
    expect(mapSessionRecords(samplePayload)).toEqual([
      {
        sessionId: "sess-aaa",
        name: "pricing_session",
        status: "done",
        os: "Windows",
        osVersion: "11",
        browser: "chrome",
        device: null,
        browserUrl: "https://automate.browserstack.com/sessions/sess-aaa",
      },
      {
        sessionId: "sess-bbb",
        name: "other",
        status: "running",
        os: "OS X",
        osVersion: "Sonoma",
        browser: "firefox",
        device: null,
        browserUrl: "https://automate.browserstack.com/sessions/sess-bbb",
      },
    ]);
  });

  it("skips items without hashed_id", () => {
    expect(
      mapSessionRecords([{ automation_session: { name: "no-id" } }]),
    ).toEqual([]);
  });

  it("filters by status client-side (case-insensitive)", () => {
    expect(mapSessionRecords(samplePayload, "DONE")).toEqual([
      expect.objectContaining({ sessionId: "sess-aaa", status: "done" }),
    ]);
  });

  it("returns empty array for non-array payloads", () => {
    expect(mapSessionRecords({ error: "nope" })).toEqual([]);
  });
});

describe("listSessionIds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches Automate sessions with default limit", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: samplePayload,
    });

    const result = await listSessionIds(
      { sessionType: SessionType.Automate, buildId: " hashed-build " },
      mockConfig,
    );

    expect(result).toHaveLength(2);
    expect(apiClient.get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.browserstack.com/automate/builds/hashed-build/sessions.json",
        params: { limit: DEFAULT_SESSION_LIST_LIMIT },
        raise_error: false,
      }),
    );
  });

  it("passes limit and offset and uses App Automate URL", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });

    await listSessionIds(
      {
        sessionType: SessionType.AppAutomate,
        buildId: "app-build",
        limit: 2,
        offset: 4,
      },
      mockConfig,
    );

    expect(apiClient.get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api-cloud.browserstack.com/app-automate/builds/app-build/sessions.json",
        params: { limit: 2, offset: 4 },
      }),
    );
  });

  it("throws a hashed-build-id message on 404", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      data: {},
    });

    await expect(
      listSessionIds(
        { sessionType: SessionType.Automate, buildId: "bad" },
        mockConfig,
      ),
    ).rejects.toThrow(/Invalid hashed build ID/);
  });

  it("throws on other HTTP errors", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      data: {},
    });

    await expect(
      listSessionIds(
        { sessionType: SessionType.Automate, buildId: "x" },
        mockConfig,
      ),
    ).rejects.toThrow(/Failed to list sessions: 500/);
  });
});

describe("listSessionIdsTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns compact JSON session records", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: samplePayload,
    });

    const result = await listSessionIdsTool(
      { sessionType: SessionType.Automate, buildId: "hashed-build" },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed[0].sessionId).toBe("sess-aaa");
  });

  it("returns success with a note when the list is empty", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });

    const result = await listSessionIdsTool(
      { sessionType: SessionType.Automate, buildId: "hashed-build" },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("No sessions found");
  });

  it("returns isError on API failure", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      data: {},
    });

    const result = await listSessionIdsTool(
      { sessionType: SessionType.Automate, buildId: "bad" },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error listing session IDs");
  });
});
