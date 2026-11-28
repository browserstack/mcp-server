import { describe, expect, it } from "vitest";

import type { AskResult } from "../../src/tools/ask-browserstack/types.js";
import { withConversation } from "../../src/tools/ask-browserstack/workflows.js";

const base = {
  ok: false,
  answer: null,
  approvals: [],
  approvals_source: "mcp",
  elicitations: [],
  needs_approval: [],
  applied_before_stop: null,
  permission_relay: { used: true, reason: "", detail: "" },
  atlas_response: null,
} as unknown as AskResult;

describe("a running agent", () => {
  it("is returned at once with how to check back, on every install", () => {
    const out = withConversation(
      { ...base, status: "running" } as AskResult,
      {
        conversation_id: "run-abc",
        run: {
          title: "Test case generation",
          steps: [{ title: "Writing", status: "running" }],
        },
      },
      "tm",
    ) as AskResult & Record<string, unknown>;
    expect(out.conversation_id).toBe("run-abc");
    expect(out.run).toEqual({
      title: "Test case generation",
      steps: [{ title: "Writing", status: "running" }],
    });
    expect(out.next_step).toEqual({
      instruction:
        "A BrowserStack AI agent is still working on this. Call askBrowserStackAI " +
        "again with this conversation_id and no query to check on it.",
      call: "askBrowserStackAI",
      params: { product: "tm", conversation_id: "run-abc" },
    });
  });

  it("leaves a result with no conversation untouched", () => {
    const result = { ...base, status: "ok" } as AskResult;
    expect(withConversation(result, { answer: "x" })).toBe(result);
  });
});

describe("actions", () => {
  const actions = [{ label: "Generate", reply: "Generate" }];

  it("are offered with params the schema accepts", () => {
    const out = withConversation(
      { ...base, status: "ok" } as AskResult,
      { conversation_id: "run-abc", actions },
      "tm",
    );
    expect(out.next_step?.params).toEqual({
      product: "tm",
      conversation_id: "run-abc",
    });
  });

  it("do not replace how to answer a pending approval, or a retry", () => {
    const approval = {
      instruction: "answer the approval",
      call: "askBrowserStackAI",
      params: { run_id: "run-abc", perm_id: "perm-1", decision: "<allow|deny>" },
    };
    for (const status of ["needs_approval", "rate_limited"]) {
      const out = withConversation(
        { ...base, status, next_step: approval } as unknown as AskResult,
        { conversation_id: "run-abc", actions },
        "tm",
      );
      expect(out.next_step).toEqual(approval);
    }
  });
});
