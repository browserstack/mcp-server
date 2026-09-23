import { describe, it, expect, vi, beforeEach } from "vitest";
import { instrumentToolLatency } from "../../src/lib/tool-latency";
import { trackMCP } from "../../src/lib/instrumentation";
import { apiClient } from "../../src/lib/apiClient";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({ status: 200, data: {} }) },
}));
vi.mock("../../src/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/config", () => ({
  default: { REMOTE_MCP: false },
}));

const clientInfo = { name: "test-client", version: "1.0" };
const config = { "browserstack-username": "u", "browserstack-access-key": "k" };

const posts = () => (apiClient.post as any).mock.calls.map((c: any) => c[0]);
const rows = () => posts().map((p: any) => p.body.event_properties);

function fakeTool(handler: unknown) {
  return { handler, enabled: true } as any;
}

/** A handler written the way every tool in src/tools is: trackMCP at entry, trackMCP in catch. */
function toolLike(name: string, work: () => Promise<unknown>) {
  return async () => {
    try {
      trackMCP(name, clientInfo, undefined, config);
      return await work();
    } catch (error) {
      trackMCP(name, clientInfo, error, config);
      return {
        content: [{ type: "text", text: `Failed: ${error}` }],
        isError: true,
      };
    }
  };
}

describe("instrumentToolLatency: one row per call", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a successful call writes exactly one row, after the handler, with duration and outcome", async () => {
    const result = { content: [{ type: "text", text: "done" }] };
    const tools = {
      listTestCases: fakeTool(toolLike("listTestCases", async () => result)),
    };
    instrumentToolLatency(tools, () => clientInfo, config);

    const out = await tools.listTestCases.handler({ projectId: "PR-1" }, {});

    expect(out).toBe(result);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const row = rows()[0];
    expect(row).toMatchObject({
      tool_name: "listTestCases",
      mcp_client: "test-client",
      success: true,
      outcome: "ok",
      is_remote: false,
    });
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
    expect(row).not.toHaveProperty("error_message");
    expect(row).not.toHaveProperty("phase");
    expect(posts()[0].headers.Authorization).toMatch(/^Basic /);
  });

  it("a handler that caught an error writes one row with success=false, the error fields and error_result", async () => {
    const tools = {
      fetchBuildInsights: fakeTool(
        toolLike("fetchBuildInsights", async () => {
          throw new Error(
            "Failed to fetch from https://x/builds/1: 404 Not Found",
          );
        }),
      ),
    };
    instrumentToolLatency(tools, () => clientInfo, config);

    const out = await tools.fetchBuildInsights.handler({}, {});

    expect(out.isError).toBe(true);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({
      tool_name: "fetchBuildInsights",
      success: false,
      outcome: "error_result",
      error_class: "not_found",
      error_type: "Error",
    });
    expect(rows()[0].error_message).toContain("404 Not Found");
  });

  it("an isError result without a recorded error keeps success=true but marks outcome error_result", async () => {
    const tools = {
      invokeCapability: fakeTool(async () => ({ content: [], isError: true })),
    };
    instrumentToolLatency(tools, () => clientInfo, config);
    await tools.invokeCapability.handler({}, {});
    expect(rows()[0]).toMatchObject({ success: true, outcome: "error_result" });
  });

  it("a handler that throws writes one failure row with outcome threw and rethrows", async () => {
    const boom = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const tools = { getFailureLogs: fakeTool(vi.fn().mockRejectedValue(boom)) };
    instrumentToolLatency(tools, () => clientInfo, config);

    await expect(tools.getFailureLogs.handler({}, {})).rejects.toBe(boom);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({
      success: false,
      outcome: "threw",
      error_class: "network",
    });
  });

  it("concurrent calls keep separate contexts", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const tools = {
      a: fakeTool(
        toolLike("a", async () => {
          await gateA;
          throw new Error("a failed");
        }),
      ),
      b: fakeTool(toolLike("b", async () => ({ content: [] }))),
    };
    instrumentToolLatency(tools, () => clientInfo, config);

    const pa = tools.a.handler({}, {});
    await tools.b.handler({}, {});
    releaseA();
    await pa;

    const byTool = Object.fromEntries(rows().map((r: any) => [r.tool_name, r]));
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(byTool.b).toMatchObject({ success: true, outcome: "ok" });
    expect(byTool.a).toMatchObject({ success: false, outcome: "error_result" });
  });

  it("passes every handler argument through (schema-less tools get only extra)", async () => {
    const inner = vi.fn().mockResolvedValue({ content: [] });
    const tools = { ping: fakeTool(inner) };
    instrumentToolLatency(tools, () => clientInfo, config);

    const extra = { signal: new AbortController().signal };
    await tools.ping.handler(extra);
    expect(inner).toHaveBeenCalledWith(extra);
  });

  it("reads client info at call time, not at wrap time", async () => {
    let current: any = {};
    const tools = { t: fakeTool(vi.fn().mockResolvedValue({ content: [] })) };
    instrumentToolLatency(tools, () => current, config);

    current = { name: "cursor", version: "2" };
    await tools.t.handler({}, {});
    expect(rows()[0].mcp_client).toBe("cursor");
  });

  it("is idempotent: wrapping twice still writes one row per call", async () => {
    const tools = { t: fakeTool(toolLike("t", async () => ({ content: [] }))) };
    instrumentToolLatency(tools, () => clientInfo, config);
    instrumentToolLatency(tools, () => clientInfo, config);

    await tools.t.handler({}, {});
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it("skips task-style handlers that are not functions", () => {
    const taskHandler = { createTask: vi.fn() };
    const tools = { t: fakeTool(taskHandler) };
    instrumentToolLatency(tools, () => clientInfo, config);
    expect(tools.t.handler).toBe(taskHandler);
  });

  it("never lets a telemetry failure affect the tool call", async () => {
    (apiClient.post as any).mockImplementation(() => {
      throw new Error("telemetry down");
    });
    const result = { content: [] };
    const tools = { t: fakeTool(vi.fn().mockResolvedValue(result)) };
    instrumentToolLatency(tools, () => clientInfo, config);

    await expect(tools.t.handler({}, {})).resolves.toBe(result);
  });
});
