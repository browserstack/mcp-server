import { describe, it, expect, vi, beforeEach } from "vitest";
import { instrumentToolLatency } from "../../src/lib/tool-latency";
import { apiClient } from "../../src/lib/apiClient";
import {
  submitFeedback,
  FEEDBACK_ACK,
  FEEDBACK_LIMITS,
} from "../../src/tools/feedback";
import {
  withFeedbackHint,
  FEEDBACK_HINT,
} from "../../src/lib/feedback-hint";

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
const config = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as any;
const server = { server: { getClientVersion: () => clientInfo } } as any;

const rows = () =>
  (apiClient.post as any).mock.calls.map(
    (c: any) => c[0].body.event_properties,
  );

/** Runs submitFeedback the way the server does: inside the latency wrapper. */
async function callFeedback(args: any) {
  const tools = {
    submitFeedback: {
      handler: async () => submitFeedback(args, server, config),
      enabled: true,
    } as any,
  };
  instrumentToolLatency(tools, () => clientInfo, config);
  return tools.submitFeedback.handler(args, {});
}

describe("submitFeedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes one MCPInstrumentation row carrying the report and acks", async () => {
    const out = await callFeedback({
      message: "No tool to delete a test plan, user had to do it in the UI.",
      category: "missing_capability",
      toolName: "listTestPlans",
      intent: "Clean up old test plans",
    });

    expect(out.content[0].text).toBe(FEEDBACK_ACK);
    expect(out.isError).toBeUndefined();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(
      (apiClient.post as any).mock.calls[0][0].body.event_type,
    ).toBe("MCPInstrumentation");
    expect(rows()[0]).toMatchObject({
      tool_name: "submitFeedback",
      success: true,
      outcome: "ok",
      feedback_category: "missing_capability",
      feedback_message:
        "No tool to delete a test plan, user had to do it in the UI.",
      feedback_tool: "listTestPlans",
      feedback_intent: "Clean up old test plans",
    });
  });

  it("redacts PII and credentials before they leave the machine", async () => {
    await callFeedback({
      message:
        "Upload failed for jane.doe@acme.com with key ab12CD34ef56GH78ij90KL from 10.0.0.12",
      category: "tool_error",
    });

    const msg = rows()[0].feedback_message;
    expect(msg).not.toContain("jane.doe@acme.com");
    expect(msg).not.toContain("ab12CD34ef56GH78ij90KL");
    expect(msg).not.toContain("10.0.0.12");
    expect(msg).toContain("[email]");
    expect(msg).toContain("[token]");
  });

  it("keeps a full-length message intact rather than the default 512 cap", async () => {
    const message = "step ".repeat(400).slice(0, FEEDBACK_LIMITS.message);
    await callFeedback({ message, category: "other" });

    expect(rows()[0].feedback_message.length).toBe(
      message.trim().length,
    );
  });

  it("omits absent optional fields instead of sending nulls", async () => {
    await callFeedback({ message: "Positive: worked well.", category: "positive" });

    // What actually goes on the wire.
    const sent = JSON.parse(JSON.stringify(rows()[0]));
    expect(sent).not.toHaveProperty("feedback_tool");
    expect(sent).not.toHaveProperty("feedback_intent");
  });

  it("never gets the feedback hint appended to its own result", async () => {
    const out = await callFeedback({ message: "x".repeat(20), category: "other" });
    expect(JSON.stringify(out)).not.toContain(FEEDBACK_HINT);
  });
});

describe("withFeedbackHint", () => {
  const err = (text: string) => ({
    content: [{ type: "text", text }],
    isError: true,
  });

  it("appends the hint to failures the agent cannot fix", () => {
    const out: any = withFeedbackHint(
      "listBuildId",
      err("Failed: Request failed with status code 502"),
    );
    expect(out.content.at(-1).text).toBe(FEEDBACK_HINT);
  });

  it.each([
    "Failed: Request failed with status code 404",
    "Failed: 401 Unauthorized",
    "Failed: Invalid projectId",
    "Failed: sessionId is required",
  ])("leaves self-fixable failures alone: %s", (text) => {
    const result = err(text);
    expect(withFeedbackHint("listBuildId", result)).toBe(result);
  });

  it.each(["createAccessibilityAuthConfig", "getAccessibilityAuthConfig"])(
    "never hints on %s, whose failures sit next to site passwords",
    (tool) => {
      const result = err("Failed: Request failed with status code 502");
      expect(withFeedbackHint(tool, result)).toBe(result);
    },
  );

  it("leaves successful results alone", () => {
    const ok = { content: [{ type: "text", text: "done" }] };
    expect(withFeedbackHint("listBuildId", ok)).toBe(ok);
  });

  it("records the tool's own error text, not the hint", async () => {
    vi.clearAllMocks();
    const tools = {
      listBuildId: {
        handler: async () => err("Failed: status code 500"),
        enabled: true,
      } as any,
    };
    instrumentToolLatency(tools, () => clientInfo, config);
    const out: any = await tools.listBuildId.handler({}, {});

    expect(out.content.at(-1).text).toBe(FEEDBACK_HINT);
    expect(rows()[0].error_message).not.toContain("submitFeedback");
  });
});

describe("redactFeedback", () => {
  it.each([
    ["username admin password Hunter2!", "Hunter2!", "password [secret]"],
    ["pwd=abc123 then retried", "abc123", "pwd=[secret]"],
    ['password: "my pass word" rejected', "my pass word", "password: [secret]"],
    ["Bearer sk_live_51Hx was refused", "sk_live_51Hx", "Bearer [secret]"],
    ["api_key=abc123def and token: x9y8", "abc123def", "api_key=[secret]"],
    ["session_id=deadbeef1 expired", "deadbeef1", "session_id=[secret]"],
    ["card 4111 1111 1111 1111 declined", "1111", "card [card] declined"],
    ["card 4111-1111-1111-1111 declined", "4111", "[card]"],
    ["OTP 482913 was not accepted", "482913", "OTP [code]"],
    ["verification code: 7731 expired", "7731", "code: [code]"],
    [
      "Scan of https://staging.acme.corp/checkout?customer=4471&t=z failed",
      "customer=4471",
      "https://staging.acme.corp/checkout?[query]",
    ],
    ["see https://app.acme.com/page#user=42", "user=42", "https://app.acme.com/page?[query]"],
  ])("redacts %s", async (input, leaked, expected) => {
    const { redactFeedback } = await import(
      "../../src/tools/capability-registry/redact"
    );
    const out = redactFeedback(input, 2000)!;
    expect(out).not.toContain(leaked);
    expect(out).toContain(expected);
  });

  it.each([
    "Request failed with status code 500",
    "error code 1001 from the upload API",
    "The token expired before the scan finished",
    "Password reset page is not covered by any tool",
    "Build 12345678 had 42 failures",
  ])("keeps useful report text intact: %s", async (input) => {
    const { redactFeedback } = await import(
      "../../src/tools/capability-registry/redact"
    );
    const out = redactFeedback(input, 2000)!;
    expect(out).not.toContain("[secret]");
    expect(out).not.toContain("[code]");
    expect(out).not.toContain("[card]");
  });

  it("still applies the base rules after the feedback ones", async () => {
    const { redactFeedback } = await import(
      "../../src/tools/capability-registry/redact"
    );
    expect(redactFeedback("mail jane@acme.com from 10.0.0.1", 2000)).toBe(
      "mail [email] from [ip]",
    );
  });

  it("fails closed on non-string input", async () => {
    const { redactFeedback } = await import(
      "../../src/tools/capability-registry/redact"
    );
    expect(redactFeedback(undefined, 2000)).toBeUndefined();
    expect(redactFeedback(42 as any, 2000)).toBeUndefined();
  });
});
