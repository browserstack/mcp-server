import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import addTfaRcaCollaborationTools, {
  triggerRcaReportTool,
} from "../../src/tools/tfa-rca-collaboration";
import { apiClient } from "../../src/lib/apiClient";
import { trackMCP } from "../../src/lib/instrumentation";

const DEFAULT_O11Y_HOST = "api-observability-rengg-tfa.bsstag.com";
const UI_BASE = "https://observability.browserstack.com";

// The o11y API base + TRA UI base are process-startup config (src/config.ts),
// resolved per call inside the util. Mock the singleton so tests never touch
// process.env at runtime in tool code.
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

const post = apiClient.post as Mock;

function ok(data: any, status = 200) {
  return { ok: true, status, data };
}
function nonOk(status: number, data: any = {}) {
  return { ok: false, status, data };
}

/** A full wire response including the arrays the glimpse must never echo. */
function fullReport(extra: Record<string, any> = {}) {
  return ok({
    state: "completed",
    buildUuid: "b-1",
    triggeredAt: "2026-07-13T10:00:00Z",
    summary: {
      state: "completed",
      verdict: "NOT_READY",
      verdictProvisional: false,
      partial: true,
      analyzedCount: 5,
      totalFailedCount: 7,
      totalPrs: 3,
      faultyPrNumbers: [412, 415],
      failureReason: "2 product regressions traced to PR #412",
      prs: [{ number: 412, title: "secret-pr-title", author: "someone" }],
      workflows: [{ name: "wf-noise", conclusion: "failure" }],
    },
    ...extra,
  });
}

describe("triggerRcaReportTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("success → trimmed glimpse with UI link; prs/workflows never echoed", async () => {
    post.mockResolvedValue(fullReport());

    const result = await triggerRcaReportTool(
      { buildUuid: "b-1" },
      mockConfig as any,
    );

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.state).toBe("completed");
    expect(payload.verdict).toBe("NOT_READY");
    expect(payload.verdictProvisional).toBe(false);
    expect(payload.partial).toBe(true);
    expect(payload.analyzedCount).toBe(5);
    expect(payload.totalFailedCount).toBe(7);
    expect(payload.totalPrs).toBe(3);
    expect(payload.faultyPrNumbers).toEqual([412, 415]);
    expect(payload.failureReason).toBe(
      "2 product regressions traced to PR #412",
    );
    expect(payload.viewReport).toBe(`${UI_BASE}/builds/b-1`);
    // Raw response is never echoed: no prs[]/workflows[] entries, no envelope.
    expect(payload.prs).toBeUndefined();
    expect(payload.workflows).toBeUndefined();
    expect(result.content[0].text).not.toContain("secret-pr-title");
    expect(result.content[0].text).not.toContain("wf-noise");
    expect(result.content[0].text).not.toContain("triggeredAt");
  });

  it("POSTs the external trigger endpoint with Basic auth, force=false default", async () => {
    post.mockResolvedValue(fullReport());

    await triggerRcaReportTool({ buildUuid: "b-1" }, mockConfig as any);

    expect(post).toHaveBeenCalledTimes(1);
    const call = post.mock.calls[0][0];
    expect(call.url).toContain(DEFAULT_O11Y_HOST);
    expect(call.url).toContain(
      "/ext/v1/ai/builds/b-1/releaseReadiness/trigger",
    );
    expect(call.url).toContain("?force=false");
    expect(call.headers.Authorization).toBe(
      `Basic ${Buffer.from("fake-user:fake-key").toString("base64")}`,
    );
  });

  it("force: true → ?force=true on the trigger URL", async () => {
    post.mockResolvedValue(fullReport());

    await triggerRcaReportTool(
      { buildUuid: "b-1", force: true },
      mockConfig as any,
    );

    expect(post.mock.calls[0][0].url).toContain("?force=true");
  });

  it("summary absent (just triggered) → state + link only, no invented fields", async () => {
    post.mockResolvedValue(
      ok({ state: "running", buildUuid: "b-2", triggeredAt: "now" }),
    );

    const result = await triggerRcaReportTool(
      { buildUuid: "b-2" },
      mockConfig as any,
    );
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.state).toBe("running");
    expect(payload.verdict).toBeUndefined();
    expect(payload.viewReport).toBe(`${UI_BASE}/builds/b-2`);
  });

  it("403 plan/flag fence → clear domain error", async () => {
    post.mockResolvedValue(nonOk(403));

    await expect(
      triggerRcaReportTool({ buildUuid: "b-3" }, mockConfig as any),
    ).rejects.toThrow(
      "Release Readiness AI is not enabled for this group (plan or feature flag)",
    );
  });

  it("REPO_NOT_CONFIGURED → clear setup guidance", async () => {
    post.mockResolvedValue(nonOk(422, { code: "REPO_NOT_CONFIGURED" }));

    await expect(
      triggerRcaReportTool({ buildUuid: "b-4" }, mockConfig as any),
    ).rejects.toThrow("repository not configured for Release Readiness");
  });

  it("RELEASE_READINESS_NOT_FOUND → clear not-found text", async () => {
    post.mockResolvedValue(
      nonOk(404, { error: "RELEASE_READINESS_NOT_FOUND" }),
    );

    await expect(
      triggerRcaReportTool({ buildUuid: "b-5" }, mockConfig as any),
    ).rejects.toThrow("no Release Readiness report found for this build");
  });

  it("plain 404 → build not found, no existence leak", async () => {
    post.mockResolvedValue(nonOk(404));

    await expect(
      triggerRcaReportTool({ buildUuid: "b-6" }, mockConfig as any),
    ).rejects.toThrow("build not found for your group");
  });
});

// ---- Handler-level tests (instrumentation + isError envelope) ----

interface CapturedTool {
  handler: (args: any, context: any) => Promise<any>;
  schema: Record<string, any>;
}

function buildFakeServer(): {
  server: any;
  captured: Record<string, CapturedTool>;
} {
  const captured: Record<string, CapturedTool> = {};
  const server = {
    server: { getClientVersion: () => ({ name: "test", version: "1.0" }) },
    tool: (
      name: string,
      _desc: string,
      schema: any,
      handler: (args: any, context: any) => Promise<any>,
    ) => {
      captured[name] = { schema, handler };
      return {};
    },
  };
  return { server, captured };
}

describe("triggerRcaReport handler instrumentation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("success → exactly one trackMCP with undefined error", async () => {
    post.mockResolvedValue(fullReport());

    const { server, captured } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await captured.triggerRcaReport.handler(
      { buildUuid: "b-1" },
      undefined,
    );

    expect(result.isError).toBeFalsy();
    expect(trackMCP).toHaveBeenCalledTimes(1);
    expect((trackMCP as Mock).mock.calls[0][0]).toBe("triggerRcaReport");
    expect((trackMCP as Mock).mock.calls[0][2]).toBeUndefined();
  });

  it("domain failure (403) → isError envelope + trackMCP with error", async () => {
    post.mockResolvedValue(nonOk(403));

    const { server, captured } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await captured.triggerRcaReport.handler(
      { buildUuid: "b-1" },
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "Release Readiness AI is not enabled",
    );
    expect(trackMCP).toHaveBeenCalledTimes(1);
    expect((trackMCP as Mock).mock.calls[0][2]).toBeInstanceOf(Error);
  });

  it("network error → isError envelope, no credential text", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { server, captured } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await captured.triggerRcaReport.handler(
      { buildUuid: "b-1" },
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to");
    expect(result.content[0].text).not.toContain("fake-key");
  });

  it("schema exposes only buildUuid + force; no credential fields", () => {
    const { server, captured } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const fieldNames = Object.keys(captured.triggerRcaReport.schema ?? {});
    expect(fieldNames).toEqual(["buildUuid", "force"]);
    expect(fieldNames).not.toContain("username");
    expect(fieldNames).not.toContain("accessKey");
  });
});
