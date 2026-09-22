import { describe, it, expect, vi, beforeEach } from "vitest";
import { trackMCP, trackMCPCompleted } from "../../src/lib/instrumentation";
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

const clientInfo = { name: "claude-code", version: "1.2.3" };
const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};

describe("trackMCPCompleted", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts a completion row with phase, duration and outcome", () => {
    trackMCPCompleted(
      "listTestCases",
      clientInfo,
      { durationMs: 1234.6, outcome: "ok" },
      config,
    );

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const call = (apiClient.post as any).mock.calls[0][0];
    expect(call.url).toBe("https://api.browserstack.com/sdk/v1/event");
    expect(call.body.event_type).toBe("MCPInstrumentation");
    expect(call.body.event_properties).toMatchObject({
      tool_name: "listTestCases",
      mcp_client: "claude-code",
      is_remote: false,
      phase: "completed",
      duration_ms: 1235,
      outcome: "ok",
    });
    // Not an invocation row: must not carry `success`, or it would be double-counted.
    expect(call.body.event_properties).not.toHaveProperty("success");
    expect(call.headers.Authorization).toMatch(/^Basic /);
    expect(call.timeout).toBe(2000);
    expect(call.raise_error).toBe(false);
  });

  it("clamps negative and fractional durations to a non-negative integer", () => {
    trackMCPCompleted("t", clientInfo, { durationMs: -3.2, outcome: "threw" }, config);
    expect(
      (apiClient.post as any).mock.calls[0][0].body.event_properties.duration_ms,
    ).toBe(0);
  });

  it("leaves the MCPInstrumentation entry row unchanged", () => {
    trackMCP("listTestCases", clientInfo, undefined, config);
    const body = (apiClient.post as any).mock.calls[0][0].body;
    expect(body.event_type).toBe("MCPInstrumentation");
    expect(body.event_properties.success).toBe(true);
    expect(body.event_properties).not.toHaveProperty("phase");
    expect(body.event_properties).not.toHaveProperty("duration_ms");
    expect(body.event_properties).not.toHaveProperty("outcome");
  });
});
