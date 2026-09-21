import { describe, it, expect, vi, beforeEach } from "vitest";
import { instrumentToolLatency } from "../../src/lib/tool-latency";
import { trackMCPCompleted } from "../../src/lib/instrumentation";

vi.mock("../../src/lib/instrumentation", () => ({
  trackMCPCompleted: vi.fn(),
}));

const clientInfo = { name: "test-client", version: "1.0" };
const config = { "browserstack-username": "u", "browserstack-access-key": "k" };

function fakeTool(handler: unknown) {
  return { handler, enabled: true } as any;
}

describe("instrumentToolLatency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits ok with a duration and returns the result untouched", async () => {
    const result = { content: [{ type: "text", text: "done" }] };
    const tools = { listTestCases: fakeTool(vi.fn().mockResolvedValue(result)) };

    instrumentToolLatency(tools, () => clientInfo, config);
    const out = await tools.listTestCases.handler({ projectId: "PR-1" }, {});

    expect(out).toBe(result);
    expect(trackMCPCompleted).toHaveBeenCalledTimes(1);
    const [name, ci, completion, cfg] = (trackMCPCompleted as any).mock.calls[0];
    expect(name).toBe("listTestCases");
    expect(ci).toBe(clientInfo);
    expect(completion.outcome).toBe("ok");
    expect(completion.durationMs).toBeGreaterThanOrEqual(0);
    expect(cfg).toBe(config);
  });

  it("classifies an isError result as error_result", async () => {
    const tools = {
      fetchBuildInsights: fakeTool(
        vi.fn().mockResolvedValue({ content: [], isError: true }),
      ),
    };
    instrumentToolLatency(tools, () => clientInfo, config);
    await tools.fetchBuildInsights.handler({}, {});
    expect((trackMCPCompleted as any).mock.calls[0][2].outcome).toBe(
      "error_result",
    );
  });

  it("emits threw and rethrows when the handler throws", async () => {
    const boom = new Error("upstream 500");
    const tools = { getFailureLogs: fakeTool(vi.fn().mockRejectedValue(boom)) };
    instrumentToolLatency(tools, () => clientInfo, config);

    await expect(tools.getFailureLogs.handler({}, {})).rejects.toBe(boom);
    expect((trackMCPCompleted as any).mock.calls[0][2].outcome).toBe("threw");
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
    expect((trackMCPCompleted as any).mock.calls[0][1]).toEqual({
      name: "cursor",
      version: "2",
    });
  });

  it("is idempotent: wrapping twice emits one event per call", async () => {
    const tools = { t: fakeTool(vi.fn().mockResolvedValue({ content: [] })) };
    instrumentToolLatency(tools, () => clientInfo, config);
    instrumentToolLatency(tools, () => clientInfo, config);

    await tools.t.handler({}, {});
    expect(trackMCPCompleted).toHaveBeenCalledTimes(1);
  });

  it("skips task-style handlers that are not functions", () => {
    const taskHandler = { createTask: vi.fn() };
    const tools = { t: fakeTool(taskHandler) };
    instrumentToolLatency(tools, () => clientInfo, config);
    expect(tools.t.handler).toBe(taskHandler);
  });

  it("never lets a telemetry failure affect the tool call", async () => {
    (trackMCPCompleted as any).mockImplementation(() => {
      throw new Error("telemetry down");
    });
    const result = { content: [] };
    const tools = { t: fakeTool(vi.fn().mockResolvedValue(result)) };
    instrumentToolLatency(tools, () => clientInfo, config);

    await expect(tools.t.handler({}, {})).resolves.toBe(result);
  });
});
