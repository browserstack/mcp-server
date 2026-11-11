import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AxiosError } from "axios";
import { trackMCP, withToolCall } from "../../src/lib/instrumentation";
import { apiClient } from "../../src/lib/apiClient";
import { CallerError, HttpError } from "../../src/lib/error";
import {
  markCallerFault,
  recordUpstreamStatus,
  trackedFetch,
} from "../../src/lib/upstream-status";

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
const failed = { content: [{ type: "text", text: "nope" }], isError: true };

/** Runs one tool call and returns the single row it wrote. */
async function rowOf(fn: () => unknown): Promise<Record<string, unknown>> {
  await withToolCall(
    "someTool",
    () => clientInfo,
    config,
    async () => fn(),
  ).catch(() => {});
  const calls = (apiClient.post as any).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0].body.event_properties;
}

function axiosError(status?: number): AxiosError {
  const error = new AxiosError("Request failed");
  error.request = {};
  if (status !== undefined) error.response = { status } as any;
  return error;
}

describe("withToolCall failure attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves failure_class off a successful call and keeps the status seen", async () => {
    const row = await rowOf(() => {
      recordUpstreamStatus(200);
      return { content: [] };
    });
    expect(row).toMatchObject({ outcome: "ok", upstream_status: 200 });
    expect(row).not.toHaveProperty("failure_class");
  });

  it("writes no upstream_status when no product API was called", async () => {
    const row = await rowOf(() => ({ content: [] }));
    expect(row).not.toHaveProperty("upstream_status");
  });

  it.each([
    [400, "caller"],
    [401, "caller"],
    [404, "caller"],
    [429, "caller"],
    [408, "upstream"],
    [500, "upstream"],
    [503, "upstream"],
    [0, "upstream"],
  ])("attributes a recorded status %i to %s", async (status, expected) => {
    const row = await rowOf(() => {
      recordUpstreamStatus(status);
      return failed;
    });
    expect(row).toMatchObject({
      outcome: "error_result",
      upstream_status: status,
      failure_class: expected,
    });
  });

  it("reads the status off an AxiosError the handler reported", async () => {
    const row = await rowOf(() => {
      trackMCP("someTool", clientInfo, axiosError(404), config);
      return failed;
    });
    expect(row).toMatchObject({
      upstream_status: 404,
      failure_class: "caller",
    });
  });

  it("treats an AxiosError with no response as an unreachable API", async () => {
    const row = await rowOf(() => {
      trackMCP("someTool", clientInfo, axiosError(), config);
      return failed;
    });
    expect(row).toMatchObject({
      upstream_status: 0,
      failure_class: "upstream",
    });
  });

  it("reads the status off an HttpError", async () => {
    const row = await rowOf(() => {
      trackMCP("someTool", clientInfo, new HttpError("boom", 502), config);
      return failed;
    });
    expect(row).toMatchObject({
      upstream_status: 502,
      failure_class: "upstream",
    });
  });

  it("prefers the reported error's status over the last status seen", async () => {
    const row = await rowOf(() => {
      recordUpstreamStatus(200);
      trackMCP("someTool", clientInfo, new HttpError("gone", 404), config);
      return failed;
    });
    expect(row).toMatchObject({
      upstream_status: 404,
      failure_class: "caller",
    });
  });

  it("treats a failed fetch as an unreachable API", async () => {
    const row = await rowOf(() => {
      trackMCP("someTool", clientInfo, new TypeError("fetch failed"), config);
      return failed;
    });
    expect(row).toMatchObject({
      upstream_status: 0,
      failure_class: "upstream",
    });
  });

  it("attributes a programming error to mcp even after a 200", async () => {
    const row = await rowOf(() => {
      recordUpstreamStatus(200);
      trackMCP(
        "someTool",
        clientInfo,
        new TypeError("Cannot read properties of null (reading 'response')"),
        config,
      );
      return failed;
    });
    expect(row).toMatchObject({ upstream_status: 200, failure_class: "mcp" });
  });

  it("attributes a handler that threw to mcp", async () => {
    const row = await rowOf(() => {
      throw new Error("unhandled");
    });
    expect(row).toMatchObject({ outcome: "threw", failure_class: "mcp" });
  });

  it("attributes a thrown HTTP error by its status", async () => {
    const row = await rowOf(() => {
      throw new HttpError("missing", 404);
    });
    expect(row).toMatchObject({
      outcome: "threw",
      upstream_status: 404,
      failure_class: "caller",
    });
  });

  it("marks a returned error with no evidence as unknown", async () => {
    const row = await rowOf(() => failed);
    expect(row).toMatchObject({
      outcome: "error_result",
      failure_class: "unknown",
    });
    expect(row).not.toHaveProperty("upstream_status");
  });

  it.each([
    ["missing_parameter", "caller"],
    ["invocation_error", "caller"],
    ["capability_disabled", "caller"],
    ["unexpected_error", "mcp"],
    ["no_base_url", "mcp"],
    ["token_mint_failed", "upstream"],
  ])("attributes the registry refusal %s to %s", async (reason, expected) => {
    const row = await rowOf(() => {
      trackMCP("someTool", clientInfo, new Error("refused"), config, {
        refusal_reason: reason,
      });
      return failed;
    });
    expect(row).toMatchObject({ failure_class: expected });
  });

  it("lets the handler's own failure_class and upstream_status win", async () => {
    const row = await rowOf(() => {
      recordUpstreamStatus(500);
      trackMCP("someTool", clientInfo, undefined, config, {
        failure_class: "caller",
        upstream_status: 422,
      });
      return failed;
    });
    expect(row).toMatchObject({
      upstream_status: 422,
      failure_class: "caller",
    });
  });

  it("keeps concurrent calls' statuses apart", async () => {
    const call = (status: number, delay: number) =>
      withToolCall(
        `tool${status}`,
        () => clientInfo,
        config,
        async () => {
          recordUpstreamStatus(status);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return failed;
        },
      );
    await Promise.all([call(404, 10), call(503, 1)]);
    const rows = (apiClient.post as any).mock.calls.map(
      (c: any) => c[0].body.event_properties,
    );
    const byTool = Object.fromEntries(
      rows.map((r: any) => [r.tool_name, r.failure_class]),
    );
    expect(byTool).toEqual({ tool404: "caller", tool503: "upstream" });
  });

  it("records nothing outside a tool call", () => {
    expect(() => recordUpstreamStatus(500)).not.toThrow();
  });
});

describe("withToolCall caller faults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attributes a returned error the handler marked to the caller", async () => {
    const row = await rowOf(() => {
      markCallerFault();
      return failed;
    });
    expect(row).toMatchObject({ failure_class: "caller" });
    expect(row).not.toHaveProperty("upstream_status");
  });

  it("attributes a CallerError to the caller, even after a 200", async () => {
    const row = await rowOf(() => {
      recordUpstreamStatus(200);
      trackMCP(
        "someTool",
        clientInfo,
        new CallerError("No devices matching"),
        config,
      );
      return failed;
    });
    expect(row).toMatchObject({
      upstream_status: 200,
      failure_class: "caller",
      error_message: "No devices matching",
    });
  });

  it("keeps the attribution when a catch block rewraps the CallerError", async () => {
    const row = await rowOf(() => {
      try {
        throw new CallerError("name is taken");
      } catch (error) {
        const wrapped = new Error(`Failed: ${(error as Error).message}`);
        trackMCP("someTool", clientInfo, wrapped, config);
        return failed;
      }
    });
    expect(row).toMatchObject({ failure_class: "caller" });
  });

  it("attributes a CallerError that escapes the handler to the caller", async () => {
    const row = await rowOf(() => {
      throw new CallerError("You must provide a desiredBrowser");
    });
    expect(row).toMatchObject({ outcome: "threw", failure_class: "caller" });
  });

  it("lets an upstream outage outrank a caller fault", async () => {
    const row = await rowOf(() => {
      markCallerFault();
      recordUpstreamStatus(503);
      return failed;
    });
    expect(row).toMatchObject({ failure_class: "upstream" });
  });

  it("lets a programming error outrank a caller fault", async () => {
    const row = await rowOf(() => {
      markCallerFault();
      trackMCP(
        "someTool",
        clientInfo,
        new TypeError("x is not a function"),
        config,
      );
      return failed;
    });
    expect(row).toMatchObject({ failure_class: "mcp" });
  });

  it("prints a CallerError exactly as an Error", () => {
    const error = new CallerError("bad input");
    expect(String(error)).toBe("Error: bad input");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("trackedFetch", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("passes its arguments through and records the status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 404, ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const init = { headers: { a: "b" } };
    const row = await rowOf(async () => {
      await trackedFetch("https://api.browserstack.com/x", init);
      return failed;
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.browserstack.com/x",
      init,
    );
    expect(row).toMatchObject({
      upstream_status: 404,
      failure_class: "caller",
    });
  });

  it("records 0 and rethrows when the request gets no answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const row = await rowOf(async () => {
      await trackedFetch("https://api.browserstack.com/x").catch(() => {});
      return failed;
    });
    expect(row).toMatchObject({
      upstream_status: 0,
      failure_class: "upstream",
    });
  });
});
