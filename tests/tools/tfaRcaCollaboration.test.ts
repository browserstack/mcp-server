import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import addTfaRcaCollaborationTools, {
  tfaRcaTurnTool,
} from "../../src/tools/tfa-rca-collaboration";
import { apiClient } from "../../src/lib/apiClient";
import { trackMCP } from "../../src/lib/instrumentation";
import {
  POLL_INITIAL_DELAY_MS,
  POLL_INTERVAL_MS,
  POLL_MAX_WAIT_MS,
} from "../../src/tools/tfa-rca-utils/constants";

const DEFAULT_O11Y_HOST = "api-observability-rengg-tfa.bsstag.com";

// The o11y base URL is process-startup config (src/config.ts), resolved per
// call inside the util. Mock the singleton so tests can flip the default vs an
// override without touching process.env at runtime in tool code.
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

// Handle to the mocked process-startup config singleton so a test can override
// the o11y base URL the way a different startup env would.
import appConfig from "../../src/config";
const DEFAULT_O11Y_BASE_URL = "https://api-observability-rengg-tfa.bsstag.com";

// Make poll delays instant so the cap-exceeded test can fast-forward.
vi.useFakeTimers();

const post = apiClient.post as Mock;
const get = apiClient.get as Mock;

function ok(data: any, status = 200) {
  return { ok: true, status, data };
}
function nonOk(status: number, data: any = {}) {
  return { ok: false, status, data };
}

// ---- Structured `rcaChat` poll fixtures (mirror the o11y pass-through) ----

/**
 * Build a completed poll body in the wire shape. The poll lifecycle field
 * `status` is "completed"; the structured `TurnResponse` rides under `turn`
 * (its own status/confidence/needs_info/rca/blocked), mirroring the o11y
 * `rcaChat` pass-through. `extra` lets a test add envelope-level noise
 * (threadId, a stray meta blob) the util must not echo.
 */
function completed(turn: Record<string, any>, extra: Record<string, any> = {}) {
  return ok({ status: "completed", threadId: "t-1", turn, ...extra });
}

describe("tfaRcaTurnTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the default (rengg-tfa) base URL after any override test.
    (appConfig as any).O11Y_TFA_RCA_BASE_URL = DEFAULT_O11Y_BASE_URL;
  });

  it("RESOLVED turn → trimmed glimpse + viewRca; full rca dropped", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-1", threadId: "t-1", status: "working" }),
    );
    get.mockResolvedValueOnce(ok({ status: "working" })).mockResolvedValueOnce(
      completed(
        {
          status: "RESOLVED",
          confidence: "high",
          rca: {
            root_cause: "Config map deleted on deploy.",
            possible_fix: "Re-add the key.",
            failure_type: "infra",
            related_prs: [42, 43],
            analysis: "very long chain of reasoning",
            log_evidence: ["stack trace line 1", "stack trace line 2"],
          },
        },
        { meta: { huge: "blob".repeat(1000) } },
      ),
    );

    const result = await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-1", message: "digest" },
        mockConfig as any,
      ),
    );

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.status).toBe("RESOLVED");
    expect(payload.confidence).toBe("high");
    expect(payload.threadId).toBe("t-1");
    // Glimpse only — root_cause, failure_type, related_prs.
    expect(payload.glimpse.root_cause).toBe("Config map deleted on deploy.");
    expect(payload.glimpse.failure_type).toBe("infra");
    expect(payload.glimpse.related_prs).toEqual([42, 43]);
    // Full RCA payload dropped; humans go to the TRA UI for the report.
    expect(payload.rca).toBeUndefined();
    expect(result.content[0].text).not.toContain("very long chain");
    expect(result.content[0].text).not.toContain("stack trace line");
    expect(result.content[0].text).not.toContain("Re-add the key.");
    expect(payload.viewRca).toContain("https://observability.browserstack.com");
    // Response trimmed: no raw meta blob echoed.
    expect(result.content[0].text).not.toContain("blob");
  });

  it("RESOLVED glimpse truncates root_cause to 220 chars", async () => {
    const longCause = "x".repeat(500);
    post.mockResolvedValue(
      ok({ turnId: "u-tr", threadId: "t-tr", status: "working" }),
    );
    get.mockResolvedValue(
      completed({
        status: "RESOLVED",
        confidence: "high",
        rca: { root_cause: longCause, failure_type: "product" },
      }),
    );

    const result = await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-tr", message: "digest" },
        mockConfig as any,
      ),
    );
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.glimpse.root_cause.length).toBeLessThanOrEqual(220);
    expect(payload.glimpse.root_cause.endsWith("…")).toBe(true);
    expect(payload.glimpse.root_cause.startsWith("xxx")).toBe(true);
  });

  it("NEEDS_INFO turn → typed asks + questions read directly from structure", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-2", threadId: "t-2", status: "working" }),
    );
    get.mockResolvedValue(
      completed(
        {
          status: "NEEDS_INFO",
          confidence: "medium",
          needs_info: {
            questions: ["Which service owns this endpoint?"],
            asks: [
              {
                what: "deploy log for service X",
                why: "confirm the rollout time",
                evidence_type: "deploy",
                priority: "high",
              },
            ],
            suggestions: ["Compare against the last green build."],
            hypotheses: ["A bad deploy dropped the config map."],
          },
        },
        { threadId: "t-2" },
      ),
    );

    const result = await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-2", message: "digest" },
        mockConfig as any,
      ),
    );
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.status).toBe("NEEDS_INFO");
    expect(payload.confidence).toBe("medium");
    expect(payload.threadId).toBe("t-2");
    expect(payload.questions).toEqual(["Which service owns this endpoint?"]);
    // Typed ask is routable by evidenceType (AE1).
    expect(payload.asks).toHaveLength(1);
    expect(payload.asks[0].evidenceType).toBe("deploy");
    expect(payload.asks[0].what).toBe("deploy log for service X");
    expect(payload.asks[0].priority).toBe("high");
    expect(payload.suggestions).toEqual([
      "Compare against the last green build.",
    ]);
    expect(payload.hypotheses).toEqual([
      "A bad deploy dropped the config map.",
    ]);
    // No RCA on a non-final turn.
    expect(payload.rca).toBeUndefined();
  });

  it("BLOCKED turn → reason + unmetAsks read from structure", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-bl", threadId: "t-bl", status: "working" }),
    );
    get.mockResolvedValue(
      completed(
        {
          status: "BLOCKED",
          confidence: "low",
          blocked: {
            reason: "No access to the k8s cluster.",
            unmet_asks: ["pod restart count", "node events"],
          },
        },
        { threadId: "t-bl" },
      ),
    );

    const result = await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-bl", message: "digest" },
        mockConfig as any,
      ),
    );
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.status).toBe("BLOCKED");
    expect(payload.confidence).toBe("low");
    expect(payload.reason).toBe("No access to the k8s cluster.");
    expect(payload.unmetAsks).toEqual(["pod restart count", "node events"]);
    expect(payload.rca).toBeUndefined();
  });

  it("status read directly from the enforced field; no marker/inference", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-st", threadId: "t-st", status: "working" }),
    );
    // A body that the old inference path would have read as RESOLVED via a
    // "## Final RCA" heading must NOT change the enforced NEEDS_INFO status.
    get.mockResolvedValue(
      completed(
        { status: "NEEDS_INFO", confidence: "low" },
        {
          threadId: "t-st",
          replyMarkdown: "## Final RCA\nstale markdown that should be ignored",
        },
      ),
    );

    const result = await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-st", message: "digest" },
        mockConfig as any,
      ),
    );
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.status).toBe("NEEDS_INFO");
    // The marker/markdown is never echoed back to the client.
    expect(result.content[0].text).not.toContain("Final RCA");
    expect(result.content[0].text).not.toContain("replyMarkdown");
  });

  it("threadId passthrough → POST body carries thread_id", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-3", threadId: "t-1", status: "working" }),
    );
    get.mockResolvedValue(
      completed({ status: "RESOLVED", confidence: "high", rca: {} }),
    );

    await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-3", message: "digest", threadId: "t-1" },
        mockConfig as any,
      ),
    );

    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0][0].body;
    expect(body.thread_id).toBe("t-1");
  });

  it("resume soft-PENDING → polls turnId without re-submitting", async () => {
    get.mockResolvedValue(
      completed(
        { status: "RESOLVED", confidence: "high", rca: {} },
        { threadId: "t-9" },
      ),
    );

    const result = await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-9", message: "digest", turnId: "u-9" },
        mockConfig as any,
      ),
    );

    expect(post).not.toHaveBeenCalled();
    expect(get.mock.calls[0][0].url).toContain("/rcaChat/u-9");
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.status).toBe("RESOLVED");
  });

  it("poll returns failed → throws TfaRcaTurnError carrying upstream text", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-4", threadId: "t-4", status: "working" }),
    );
    get.mockResolvedValue(ok({ status: "failed", error: "agent crashed" }));

    await expect(
      runWithTimers(
        tfaRcaTurnTool(
          { testRunId: "tr-4", message: "digest" },
          mockConfig as any,
        ),
      ),
    ).rejects.toThrow("agent crashed");
  });

  it("poll 404 / expired → clean error, no raw axios throw", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-5", threadId: "t-5", status: "working" }),
    );
    get.mockResolvedValue(nonOk(404));

    await expect(
      runWithTimers(
        tfaRcaTurnTool(
          { testRunId: "tr-5", message: "digest" },
          mockConfig as any,
        ),
      ),
    ).rejects.toThrow("turn expired or not found");
  });

  it("consent denied → POST 403 → 'AI consent not enabled'", async () => {
    post.mockResolvedValue(nonOk(403));

    await expect(
      runWithTimers(
        tfaRcaTurnTool(
          { testRunId: "tr-6", message: "digest" },
          mockConfig as any,
        ),
      ),
    ).rejects.toThrow("AI consent not enabled for this group");
  });

  it("IDOR mismatch → POST 404 → 'test run not found', no existence leak", async () => {
    post.mockResolvedValue(nonOk(404));

    await expect(
      runWithTimers(
        tfaRcaTurnTool(
          { testRunId: "tr-7", message: "digest" },
          mockConfig as any,
        ),
      ),
    ).rejects.toThrow("test run not found for your group");
  });

  it("poll cap exceeded → deterministic soft PENDING with turnId/threadId", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-8", threadId: "t-8", status: "working" }),
    );
    get.mockResolvedValue(ok({ status: "working" }));

    const result = await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-8", message: "digest" },
        mockConfig as any,
      ),
    );

    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.status).toBe("PENDING");
    expect(payload.turnId).toBe("u-8");
    expect(payload.threadId).toBe("t-8");
  });

  it("default base URL is o11y rengg-tfa, not misc-services/localhost", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-b", threadId: "t-b", status: "working" }),
    );
    get.mockResolvedValue(
      completed({ status: "RESOLVED", confidence: "high" }),
    );

    await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-b", message: "digest" },
        mockConfig as any,
      ),
    );

    expect(post.mock.calls[0][0].url).toContain(DEFAULT_O11Y_HOST);
    expect(post.mock.calls[0][0].url).not.toContain("localhost");
    expect(get.mock.calls[0][0].url).toContain(DEFAULT_O11Y_HOST);
  });

  it("config override → submit + poll URLs target the override host", async () => {
    (appConfig as any).O11Y_TFA_RCA_BASE_URL =
      "https://api-observability.bsstag.com";

    post.mockResolvedValue(
      ok({ turnId: "u-ov", threadId: "t-ov", status: "working" }),
    );
    get.mockResolvedValue(
      completed({ status: "RESOLVED", confidence: "high" }),
    );

    await runWithTimers(
      tfaRcaTurnTool(
        { testRunId: "tr-ov", message: "digest" },
        mockConfig as any,
      ),
    );

    // Both submit (POST) and poll (GET) honor the overridden host...
    expect(post.mock.calls[0][0].url).toContain("api-observability.bsstag.com");
    expect(post.mock.calls[0][0].url).not.toContain(DEFAULT_O11Y_HOST);
    expect(get.mock.calls[0][0].url).toContain("api-observability.bsstag.com");
    expect(get.mock.calls[0][0].url).not.toContain(DEFAULT_O11Y_HOST);

    // ...while path templating is unchanged under the override (regression).
    expect(post.mock.calls[0][0].url).toContain("/ext/v1/testRuns/tr-ov/rcaChat");
    expect(get.mock.calls[0][0].url).toContain(
      "/ext/v1/testRuns/tr-ov/rcaChat/u-ov",
    );
    // ...and the auth header is unchanged (still Basic, base64 of creds).
    expect(post.mock.calls[0][0].headers.Authorization).toBe(
      `Basic ${Buffer.from("fake-user:fake-key").toString("base64")}`,
    );
  });

  it("o11y base is not exposed as a Zod tool-input field", () => {
    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);
    // The schema captured at registration must carry no endpoint/base-url field.
    const fieldNames = Object.keys(tools.tfaRcaTurn.schema ?? {});
    expect(fieldNames).toEqual(["testRunId", "message", "threadId", "turnId"]);
    expect(fieldNames).not.toContain("baseUrl");
    expect(fieldNames).not.toContain("o11yBaseUrl");
  });
});

/**
 * Drive a turn that uses real setTimeout-based delays under fake timers.
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

// ---- Handler-level tests (instrumentation + isError envelope) ----

interface CapturedHandler {
  handler: (args: any, context: any) => Promise<any>;
  schema: Record<string, any>;
}

/** Captures every registered tool by name (the adder registers several). */
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

describe("tfaRcaTurn handler instrumentation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("success → exactly one trackMCP with undefined error", async () => {
    post.mockResolvedValue(
      ok({ turnId: "u-1", threadId: "t-1", status: "working" }),
    );
    get.mockResolvedValue(
      completed({ status: "RESOLVED", confidence: "high" }),
    );

    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await runWithTimers(
      tools.tfaRcaTurn.handler({ testRunId: "tr-1", message: "d" }, undefined),
    );

    expect(result.isError).toBeFalsy();
    expect(trackMCP).toHaveBeenCalledTimes(1);
    expect((trackMCP as Mock).mock.calls[0][2]).toBeUndefined();
  });

  it("domain failure → isError envelope + trackMCP with error", async () => {
    post.mockResolvedValue(nonOk(403));

    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await runWithTimers(
      tools.tfaRcaTurn.handler({ testRunId: "tr-1", message: "d" }, undefined),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "AI consent not enabled for this group",
    );
    expect(trackMCP).toHaveBeenCalledTimes(1);
    expect((trackMCP as Mock).mock.calls[0][2]).toBeInstanceOf(Error);
  });

  it("missing creds → isError, no credential text in message", async () => {
    const getAuth = await import("../../src/lib/get-auth");
    (getAuth.getBrowserStackAuth as Mock).mockImplementationOnce(() => {
      throw new Error("Missing BrowserStack credentials");
    });

    const { server, tools } = buildFakeServer();
    addTfaRcaCollaborationTools(server as any, mockConfig as any);

    const result = await runWithTimers(
      tools.tfaRcaTurn.handler({ testRunId: "tr-1", message: "d" }, undefined),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("fake-key");
  });
});

describe("tfaRcaTurn timing constants sanity", () => {
  it("poll cap is larger than interval + initial delay", () => {
    expect(POLL_MAX_WAIT_MS).toBeGreaterThan(
      POLL_INITIAL_DELAY_MS + POLL_INTERVAL_MS,
    );
  });
  it("o11y base resolver defaults to the rengg-tfa host", async () => {
    const { getO11yBaseUrl } = await import(
      "../../src/tools/tfa-rca-utils/constants"
    );
    expect(getO11yBaseUrl()).toBe(DEFAULT_O11Y_BASE_URL);
  });
});
