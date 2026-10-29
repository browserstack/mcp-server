import { describe, expect, it } from "vitest";

import {
  internalView,
  toAudienceResult,
  userView,
} from "../../src/tools/ask-browserstack/result-audience.js";
import type { AskResult } from "../../src/tools/ask-browserstack/types.js";

const CONV = "run-" + "a".repeat(32);
const PERM = "wf-" + "b".repeat(32);
const ASK = "wfq-" + "c".repeat(32);
const ATT = "att_" + "d".repeat(32);
const ID_PATTERN = /(run|wf|wfq|perm)-[0-9a-f]{32}|att_[0-9a-f]{32}/;

const base = {
  ok: false,
  answer: null,
  approvals: [],
  approvals_source: "mcp",
  elicitations: [],
  needs_approval: [],
  applied_before_stop: null,
  permission_relay: { used: true, reason: "", detail: "" },
  atlas_response: { conversation_id: CONV },
} as unknown as AskResult;

function result(over: Record<string, unknown>): AskResult {
  return { ...base, ...over } as AskResult;
}

describe("the user-facing block", () => {
  it("carries the answer and actions but no handles", () => {
    const r = result({
      ok: true,
      status: "ok",
      answer: "16 gaps found.",
      conversation_id: CONV,
      run: {
        run_id: `wf:${CONV}:toolu_01X`,
        title: "Test case maintenance",
        stage: "review",
      },
      actions: [
        {
          label: "Generate test cases",
          reply: "Generate test cases",
          card_id: `ag:wf:${CONV}:x`,
        },
      ],
      next_step: {
        instruction: "…",
        call: "askBrowserStackAI",
        params: { conversation_id: CONV },
      },
    });
    const view = userView(r);
    expect(view.answer).toBe("16 gaps found.");
    expect(view.run).toEqual({
      title: "Test case maintenance",
      stage: "review",
    });
    expect(view.actions).toEqual([
      { label: "Generate test cases", reply: "Generate test cases" },
    ]);
    expect(JSON.stringify(view)).not.toMatch(ID_PATTERN);
    expect(view).not.toHaveProperty("next_step");
    expect(view).not.toHaveProperty("conversation_id");
  });

  it("strips ids that leak into text, such as a generic approval label", () => {
    const r = result({
      status: "needs_approval",
      run_id: CONV,
      perm_id: PERM,
      approvals: [
        { description: `approval ${PERM}`, decision: "allow", reason: "" },
      ],
      answer: `Stopped at: Save 6 test cases. (${PERM})`,
    });
    const text = JSON.stringify(userView(r));
    expect(text).not.toMatch(ID_PATTERN);
    expect(text).toContain("Stopped at: Save 6 test cases.");
  });

  it("keeps the questions' text but not their ask id", () => {
    const r = result({
      status: "needs_input",
      questions: [
        {
          ask_id: ASK,
          title: "Which plan?",
          questions: [{ id: "plan", prompt: "Plan?" }],
        },
      ],
    });
    const view = userView(r);
    expect(view.questions).toEqual([
      { title: "Which plan?", questions: [{ id: "plan", prompt: "Plan?" }] },
    ]);
    expect(internalView(r)?.questions).toEqual([{ ask_id: ASK }]);
  });

  it("names uploads without their ids or commands", () => {
    const r = result({
      status: "needs_upload",
      uploads: [{ name: "prd.pdf", attachment_id: ATT, command: "curl …" }],
    });
    expect(userView(r).uploads).toEqual([{ name: "prd.pdf" }]);
    expect(internalView(r)?.uploads).toEqual([
      { name: "prd.pdf", attachment_id: ATT, command: "curl …" },
    ]);
  });
});

describe("the tool result", () => {
  it("puts the handles in a second block for the assistant only", () => {
    const res = toAudienceResult(
      result({
        status: "running",
        conversation_id: CONV,
        next_step: {
          instruction: "check back",
          call: "askBrowserStackAI",
          params: { conversation_id: CONV },
        },
      }),
    );
    expect(res.content).toHaveLength(2);
    const [shown, internal] = res.content as {
      text: string;
      annotations?: { audience?: string[] };
    }[];
    expect(shown.annotations).toBeUndefined();
    expect(shown.text).not.toMatch(ID_PATTERN);
    expect(internal.annotations).toEqual({ audience: ["assistant"] });
    expect(internal.text).toMatch(
      /^For the assistant only:.*Never show conversation_id/,
    );
    expect(
      JSON.parse(internal.text.split("\n").slice(1).join("\n")).conversation_id,
    ).toBe(CONV);
  });

  it("flags failures as errors", () => {
    expect(
      toAudienceResult(result({ status: "error", error: "boom" })).isError,
    ).toBe(true);
    expect(toAudienceResult(result({ status: "ok" })).isError).toBeUndefined();
  });

  it("sends one block when there is nothing internal", () => {
    const r = {
      ok: true,
      status: "ok",
      answer: "done",
    } as unknown as AskResult;
    expect(toAudienceResult(r).content).toHaveLength(1);
  });
});
