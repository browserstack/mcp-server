import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyError, trackMCP } from "../../src/lib/instrumentation";
import { apiClient } from "../../src/lib/apiClient";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({ status: 200, data: {} }) },
}));
vi.mock("../../src/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/config", () => ({ default: { REMOTE_MCP: false } }));

function axiosLike(status: number, code?: string) {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.response = { status };
  if (code) err.code = code;
  return err;
}

describe("classifyError", () => {
  it.each([
    [axiosLike(401), "auth_error"],
    [axiosLike(403), "auth_error"],
    [axiosLike(404), "not_found"],
    [axiosLike(429), "rate_limited"],
    [axiosLike(400), "validation"],
    [axiosLike(422), "validation"],
    [axiosLike(500), "server_error"],
    [axiosLike(503), "server_error"],
    [axiosLike(504), "timeout"],
  ])("maps HTTP status on the error object (%#)", (err, expected) => {
    expect(classifyError(err)).toBe(expected);
  });

  it("reads the status out of plain Error messages thrown by utils", () => {
    expect(
      classifyError(
        new Error(
          "Failed to fetch from https://api-automation.browserstack.com/ext/v1/builds/junk: 404 Not Found",
        ),
      ),
    ).toBe("not_found");
    expect(
      classifyError(new Error("Request failed with status code 401")),
    ).toBe("auth_error");
  });

  it("prefers the transport code over any status", () => {
    const err: any = new Error("timeout of 2000ms exceeded");
    err.code = "ECONNABORTED";
    expect(classifyError(err)).toBe("timeout");
    const refused: any = new Error("connect ECONNREFUSED 10.0.0.1:443");
    refused.code = "ECONNREFUSED";
    expect(classifyError(refused)).toBe("network");
  });

  it("treats Zod errors as validation", () => {
    const zod: any = new Error("Invalid input");
    zod.name = "ZodError";
    zod.issues = [];
    expect(classifyError(zod)).toBe("validation");
  });

  it("classifies entitlement refusals and message-only timeouts", () => {
    expect(
      classifyError(
        new Error("BrowserStack AI is not enabled for `tm` on your account."),
      ),
    ).toBe("auth_error");
    expect(classifyError(new Error("Scan timed out after 300s"))).toBe(
      "timeout",
    );
  });

  it("falls back to unknown for anything else, including non-Errors", () => {
    expect(classifyError(new Error("Converting circular structure to JSON"))).toBe(
      "unknown",
    );
    expect(classifyError("some string")).toBe("unknown");
    expect(classifyError(undefined)).toBe("unknown");
  });
});

describe("trackMCP failure row", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds error_class next to the existing error fields", () => {
    trackMCP("fetchBuildInsights", { name: "c" }, axiosLike(404), {
      "browserstack-username": "u",
      "browserstack-access-key": "k",
    });
    const props = (apiClient.post as any).mock.calls[0][0].body.event_properties;
    expect(props.success).toBe(false);
    expect(props.error_type).toBe("Error");
    expect(props.error_message).toBe("Request failed with status code 404");
    expect(props.error_class).toBe("not_found");
  });

  it("does not add error_class to the success row", () => {
    trackMCP("listTestCases", { name: "c" }, undefined, {
      "browserstack-username": "u",
      "browserstack-access-key": "k",
    });
    const props = (apiClient.post as any).mock.calls[0][0].body.event_properties;
    expect(props).not.toHaveProperty("error_class");
  });
});
