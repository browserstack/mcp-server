import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import addTfaRcaCollaborationTools, {
  getBuildFailureThemesTool,
  listTestsInFailureThemeTool,
} from "../../src/tools/tfa-rca-collaboration";
import {
  fetchBuildFailureThemes,
  fetchTestsInFailureTheme,
  BuildFailureThemesError,
} from "../../src/tools/tfa-rca-utils/build-failure-themes";
import { apiClient } from "../../src/lib/apiClient";
import { trackMCP } from "../../src/lib/instrumentation";

const DEFAULT_O11Y_HOST = "api-observability-rengg-tfa.bsstag.com";

vi.mock("../../src/config", () => ({
  default: {
    REMOTE_MCP: false,
    O11Y_TFA_RCA_BASE_URL: "https://api-observability-rengg-tfa.bsstag.com",
    BROWSERSTACK_O11Y_UI_BASE_URL: "https://observability.browserstack.com",
  },
}));

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("fake-user:fake-key"),
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

vi.useFakeTimers();

const post = apiClient.post as Mock;
const get = apiClient.get as Mock;

function ok(data: any, status = 200) {
  return { ok: true, status, data };
}
function nonOk(status: number, data: any = {}) {
  return { ok: false, status, data };
}

/**
 * Drive a call that uses real setTimeout-based delays under fake timers.
 * Attach to the promise first (so rejections are always observed), then
 * advance timers concurrently.
 */
async function runWithTimers<T>(p: Promise<T>): Promise<T> {
  const settled = p.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e }),
  );
  await vi.runAllTimersAsync();
  const r = await settled;
  if (r.ok) return r.v;
  throw r.e;
}

const themesPayload = (extra: Record<string, any> = {}) => ({
  buildId: "build-1",
  buildThemes: [
    {
      themeId: "t-uuid-1",
      buildFailureThemeId: 3874449,
      themeData: { name: "Data Assertion Mismatch", description: "..." },
      affectedWorkflows: [{ id: 1, workflowData: { name: "wf", description: "d" } }],
      affectedWorkflowCount: 1,
      testRunCount: 5,
      testPercentage: 20,
    },
  ],
  buildWorkflows: [
    {
      workflowIdentifier: "wf-1",
      buildFailureWorkflowId: 1,
      workflowData: { name: "wf", description: "d" },
      testRunCount: 5,
      testPercentage: 20,
      themesIdentified: [],
      themeIdentifiedCount: 1,
    },
  ],
  buildThemeWorkflow: { status: "SUCCESS", summary: "done" },
  stats: { totalThemes: 1, newThemes: 1, existingThemes: 0 },
  ...extra,
});

describe("fetchBuildFailureThemes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SUCCESS on first read → ready:true with themes/workflows/stats", async () => {
    get.mockResolvedValue(ok(themesPayload()));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(true);
    expect(result.status).toBe("SUCCESS");
    expect(result.buildId).toBe("build-1");
    expect(result.buildThemes).toHaveLength(1);
    expect(result.buildThemes![0].buildFailureThemeId).toBe(3874449);
    expect(result.buildWorkflows).toHaveLength(1);
    expect(result.stats).toEqual({ totalThemes: 1, newThemes: 1, existingThemes: 0 });
    expect(post).not.toHaveBeenCalled();

    const call = get.mock.calls[0][0];
    expect(call.url).toContain(DEFAULT_O11Y_HOST);
    expect(call.url).toContain("/ext/v1/ai/failures/b-1");
    expect(call.headers.Authorization).toBe(
      `Basic ${Buffer.from("fake-user:fake-key").toString("base64")}`,
    );
  });

  it("404 (never computed) → triggers once via POST (same URL, no body), then polls to SUCCESS", async () => {
    get
      .mockResolvedValueOnce(nonOk(404))
      .mockResolvedValueOnce(ok(themesPayload()));
    post.mockResolvedValue(ok({ triggered: true }));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    const triggerCall = post.mock.calls[0][0];
    expect(triggerCall.url).toContain("/ext/v1/ai/failures/b-1");
    expect(triggerCall.body).toEqual({});
  });

  it("200 with no buildThemeWorkflow at all → triggers once, then polls to SUCCESS", async () => {
    get
      .mockResolvedValueOnce(ok({ buildId: "b-1", buildThemes: [], buildWorkflows: [] }))
      .mockResolvedValueOnce(ok(themesPayload()));
    post.mockResolvedValue(ok({ triggered: true }));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("404 persists after the one retrigger → ready:false 'PENDING' once budget spent, no second retrigger", async () => {
    get.mockResolvedValue(nonOk(404));
    post.mockResolvedValue(ok({ triggered: true }));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(post).toHaveBeenCalledTimes(1);
  }, 15000);

  it("FAILED status → triggers once, then polls to SUCCESS", async () => {
    get
      .mockResolvedValueOnce(ok(themesPayload({ buildThemeWorkflow: { status: "FAILED" } })))
      .mockResolvedValueOnce(ok(themesPayload()));
    post.mockResolvedValue(ok({ triggered: true }));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("FAILED persists after the one retrigger → ready:false 'FAILED', no second retrigger", async () => {
    get.mockResolvedValue(
      ok(themesPayload({ buildThemeWorkflow: { status: "FAILED" } })),
    );
    post.mockResolvedValue(ok({ triggered: true }));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("trigger POST returns 404 → soft-degrades to ready:false immediately, does not throw", async () => {
    get.mockResolvedValue(nonOk(404));
    post.mockResolvedValue(nonOk(404));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(false);
    expect(result.status).toBe("trigger-unavailable");
    expect(post).toHaveBeenCalledTimes(1);
    // Fails fast — does not burn the rest of the poll budget re-GETting.
    expect(get.mock.calls.length).toBe(1);
  });

  it("trigger POST returns 405 method not allowed → soft-degrades, no throw", async () => {
    get.mockResolvedValue(
      ok({ buildId: "b-1", buildThemes: [], buildWorkflows: [] }),
    );
    post.mockResolvedValue(nonOk(405));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(false);
    expect(result.status).toBe("trigger-unavailable");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("trigger POST fails with a hard 500 → still soft-degrades (never throws for a trigger failure)", async () => {
    get.mockResolvedValue(nonOk(404));
    post.mockResolvedValue(nonOk(500));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(false);
    expect(result.status).toBe("trigger-unavailable");
  });

  it("in-progress status (someone else's computation running) → keeps polling, ready:false with last observed status once budget spent, never triggers", async () => {
    get.mockResolvedValue(
      ok(themesPayload({ buildThemeWorkflow: { status: "PROCESSING" } })),
    );

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(false);
    expect(result.status).toBe("PROCESSING");
    expect(post).not.toHaveBeenCalled();
    expect(get.mock.calls.length).toBeGreaterThan(1);
  }, 15000);

  it("in-progress computation completes mid-poll → ready:true", async () => {
    get
      .mockResolvedValueOnce(
        ok(themesPayload({ buildThemeWorkflow: { status: "PROCESSING" } })),
      )
      .mockResolvedValueOnce(ok(themesPayload()));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("buildThemeWorkflow present but status undefined, never resolves → triggers once, then ready:false 'PENDING' once budget spent, no second retrigger", async () => {
    get.mockResolvedValue(ok(themesPayload({ buildThemeWorkflow: {} })));
    post.mockResolvedValue(ok({ triggered: true }));

    const result = await runWithTimers(
      fetchBuildFailureThemes("b-1", mockConfig as any),
    );

    expect(result.ready).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(post).toHaveBeenCalledTimes(1);
  }, 15000);

  it("hard GET failure (500) → throws BuildFailureThemesError", async () => {
    get.mockResolvedValue(nonOk(500));

    await expect(
      runWithTimers(fetchBuildFailureThemes("b-1", mockConfig as any)),
    ).rejects.toThrow(BuildFailureThemesError);
  });
});

describe("fetchTestsInFailureTheme", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps testRuns[].details.id → testRunId, forwards theme/workflow/limit/cursor params", async () => {
    get.mockResolvedValue(
      ok({
        testRuns: [
          { id: "flat-1", title: "some test", details: { id: 12345, status: "failed" } },
        ],
        nextCursor: "cursor-2",
      }),
    );

    const result = await fetchTestsInFailureTheme(
      { buildUuid: "b-1", themeId: 3874449, workflowId: 1, limit: 5, cursor: "cursor-1" },
      mockConfig as any,
    );

    expect(result.tests).toEqual([
      { testRunId: 12345, title: "some test", status: "failed", raw: expect.any(Object) },
    ]);
    expect(result.nextCursor).toBe("cursor-2");

    const call = get.mock.calls[0][0];
    expect(call.url).toContain("/ext/v1/ai/failures/b-1/flat");
    expect(call.params).toEqual({
      limit: 5,
      buildFailureThemeId: 3874449,
      buildFailureWorkflowId: 1,
      searchAfter: "cursor-1",
    });
  });

  it("falls back to top-level id when details.id is absent", async () => {
    get.mockResolvedValue(ok({ testRuns: [{ id: "flat-2", title: "t" }] }));

    const result = await fetchTestsInFailureTheme(
      { buildUuid: "b-1" },
      mockConfig as any,
    );

    expect(result.tests[0].testRunId).toBe("flat-2");
  });

  it("defaults limit to 50 when not specified", async () => {
    get.mockResolvedValue(ok({ testRuns: [] }));

    await fetchTestsInFailureTheme({ buildUuid: "b-1" }, mockConfig as any);

    expect(get.mock.calls[0][0].params.limit).toBe(50);
  });

  it("non-ok response → throws BuildFailureThemesError", async () => {
    get.mockResolvedValue(nonOk(500));

    await expect(
      fetchTestsInFailureTheme({ buildUuid: "b-1" }, mockConfig as any),
    ).rejects.toThrow(BuildFailureThemesError);
  });
});

// ---- Handler-level tests (instrumentation + isError envelope) ----

interface CapturedHandler {
  handler: (args: any, context: any) => Promise<any>;
  schema: Record<string, any>;
}

function buildFakeServer(): {
  server: any;
  tools: Record<string, CapturedHandler>;
} {
  const tools: Record<string, CapturedHandler> = {};
  const server = {
    server: { getClientVersion: () => ({ name: "test", version: "1.0" }) },
    tool: (
      name: string,
      _desc: string,
      schema: any,
      handler: (args: any, context: any) => Promise<any>,
    ) => {
      tools[name] = { schema, handler };
      return {};
    },
  };
  return { server, tools };
}

describe("getBuildFailureThemesTool (direct)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wraps the util result as a JSON CallToolResult", async () => {
    get.mockResolvedValue(ok(themesPayload()));

    const result = await runWithTimers(
      getBuildFailureThemesTool({ buildUuid: "b-1" }, mockConfig as any),
    );

    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.ready).toBe(true);
    expect(payload.buildThemes).toHaveLength(1);
  });
});

describe("listTestsInFailureThemeTool (direct)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wraps the util result as a JSON CallToolResult", async () => {
    get.mockResolvedValue(
      ok({ testRuns: [{ id: "f-1", title: "t", details: { id: 1, status: "failed" } }] }),
    );

    const result = await listTestsInFailureThemeTool(
      { buildUuid: "b-1" },
      mockConfig as any,
    );

    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.tests).toHaveLength(1);
    expect(payload.tests[0].testRunId).toBe(1);
  });
});

describe("getBuildFailureThemes handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("success → isError falsy, trackMCP called with undefined error", async () => {
    get.mockResolvedValue(ok(themesPayload()));

    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await runWithTimers(
      tools.getBuildFailureThemes.handler({ buildUuid: "b-1" }, undefined),
    );

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.ready).toBe(true);
    expect(trackMCP).toHaveBeenCalledTimes(1);
    expect((trackMCP as Mock).mock.calls[0][0]).toBe("getBuildFailureThemes");
    expect((trackMCP as Mock).mock.calls[0][2]).toBeUndefined();
  });

  it("domain failure → isError envelope, no credential leak, trackMCP with error", async () => {
    get.mockResolvedValue(nonOk(500));

    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await runWithTimers(
      tools.getBuildFailureThemes.handler({ buildUuid: "b-1" }, undefined),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to");
    expect(result.content[0].text).not.toContain("fake-key");
    expect(trackMCP).toHaveBeenCalledTimes(1);
    expect((trackMCP as Mock).mock.calls[0][2]).toBeInstanceOf(Error);
  });

  it("schema exposes only buildUuid; no credential fields, no trigger param", () => {
    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const fieldNames = Object.keys(tools.getBuildFailureThemes.schema ?? {});
    expect(fieldNames).toEqual(["buildUuid"]);
  });
});

describe("listTestsInFailureTheme handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("success → isError falsy, trackMCP called with undefined error", async () => {
    get.mockResolvedValue(ok({ testRuns: [] }));

    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await tools.listTestsInFailureTheme.handler(
      { buildUuid: "b-1", themeId: 1 },
      undefined,
    );

    expect(result.isError).toBeFalsy();
    expect(trackMCP).toHaveBeenCalledTimes(1);
    expect((trackMCP as Mock).mock.calls[0][0]).toBe("listTestsInFailureTheme");
    expect((trackMCP as Mock).mock.calls[0][2]).toBeUndefined();
  });

  it("domain failure → isError envelope, no credential leak", async () => {
    get.mockResolvedValue(nonOk(500));

    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await tools.listTestsInFailureTheme.handler(
      { buildUuid: "b-1" },
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("fake-key");
    expect((trackMCP as Mock).mock.calls[0][2]).toBeInstanceOf(Error);
  });

  it("schema exposes only buildUuid/themeId/workflowId/limit/cursor; no credential fields", () => {
    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const fieldNames = Object.keys(tools.listTestsInFailureTheme.schema ?? {});
    expect(fieldNames).toEqual(["buildUuid", "themeId", "workflowId", "limit", "cursor"]);
  });
});

