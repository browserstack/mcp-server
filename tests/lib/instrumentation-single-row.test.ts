import { describe, it, expect, vi, beforeEach } from "vitest";
import { trackMCP, withToolCall } from "../../src/lib/instrumentation";
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
const rows = () =>
  (apiClient.post as any).mock.calls.map(
    (c: any) => c[0].body.event_properties,
  );

describe("withToolCall", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts one MCPInstrumentation row with success, duration and outcome", async () => {
    const out = await withToolCall(
      "listTestCases",
      () => clientInfo,
      config,
      async () => {
        trackMCP("listTestCases", clientInfo, undefined, config);
        return { content: [] };
      },
    );

    expect(out).toEqual({ content: [] });
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const call = (apiClient.post as any).mock.calls[0][0];
    expect(call.url).toBe("https://api.browserstack.com/sdk/v1/event");
    expect(call.body.event_type).toBe("MCPInstrumentation");
    expect(call.body.event_properties).toMatchObject({
      tool_name: "listTestCases",
      mcp_client: "claude-code",
      is_remote: false,
      success: true,
      outcome: "ok",
    });
    expect(call.body.event_properties.duration_ms).toBeGreaterThanOrEqual(0);
    expect(call.body.event_properties).not.toHaveProperty("phase");
    expect(call.timeout).toBe(2000);
    expect(call.raise_error).toBe(false);
  });

  it("folds the handler's catch-block trackMCP into the same row as a failure", async () => {
    await withToolCall(
      "fetchRCA",
      () => clientInfo,
      config,
      async () => {
        trackMCP("fetchRCA", clientInfo, undefined, config);
        trackMCP(
          "fetchRCA",
          clientInfo,
          new Error("Request failed with status code 401"),
          config,
        );
        return { content: [], isError: true };
      },
    );

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({
      success: false,
      outcome: "error_result",
      error_message: "Request failed with status code 401",
    });
  });

  it("uses the config and client the handler passed when the wrapper had none", async () => {
    await withToolCall(
      "t",
      () => ({}),
      undefined,
      async () => {
        trackMCP("t", { name: "cursor" }, undefined, config);
        return { content: [] };
      },
    );
    const call = (apiClient.post as any).mock.calls[0][0];
    expect(call.body.event_properties.mcp_client).toBe("cursor");
    expect(call.headers.Authorization).toMatch(/^Basic /);
  });

  it("rounds and clamps the duration", async () => {
    await withToolCall(
      "t",
      () => clientInfo,
      config,
      () => ({ content: [] }),
    );
    const d = rows()[0].duration_ms;
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
  });
});

describe("trackMCP outside an instrumented call", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still posts the entry row immediately (heartbeat and unwrapped tools)", () => {
    trackMCP("started", clientInfo, undefined, config);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({ tool_name: "started", success: true });
    expect(rows()[0]).not.toHaveProperty("duration_ms");
    expect(rows()[0]).not.toHaveProperty("outcome");
  });

  it("still posts the failure row immediately", () => {
    trackMCP(
      "uploadAsset",
      clientInfo,
      new Error("x: 503 Service Unavailable"),
      config,
    );
    expect(rows()[0]).toMatchObject({
      success: false,
      error_type: "Error",
    });
  });
});
