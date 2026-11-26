import { describe, expect, it } from "vitest";

import type { AskResult } from "../../src/tools/ask-browserstack/types.js";
import {
  settleRun,
  withConversation,
} from "../../src/tools/ask-browserstack/workflows.js";

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

describe("settling a run before the model sees it", () => {
  const reading = (status: string, httpStatus = 200) => ({
    status: httpStatus,
    body: { status, conversation_id: "run-abc" },
  });

  /** A clock and a sleep that only move when the code under test asks them to. */
  const fakeTime = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
      get elapsed() {
        return t;
      },
    };
  };

  const settle = async (
    readings: Array<{ status: number; body: unknown }>,
    ceilingMs = 90_000,
  ) => {
    const clock = fakeTime();
    const waits: number[] = [];
    let i = 0;
    const out = await settleRun(
      async () => readings[Math.min(i++, readings.length - 1)],
      {
        ceilingMs,
        intervalMs: 3_000,
        onWait: (ms) => waits.push(ms),
        sleep: clock.sleep,
        now: clock.now,
      },
    );
    return { out, reads: i, waits, elapsed: clock.elapsed };
  };

  it("returns the first reading when the run is already answerable", async () => {
    const { out, reads, waits } = await settle([reading("ended")]);
    expect(out.body).toMatchObject({ status: "ended" });
    expect(reads).toBe(1);
    expect(waits).toEqual([]);
  });

  it("stops the moment a human is asked, instead of waiting for a result", async () => {
    // The case that makes "poll until done" wrong: the run is not finished and never
    // will be until somebody answers it.
    const { out, reads } = await settle([
      reading("running"),
      reading("running"),
      reading("needs_approval"),
    ]);
    expect(out.body).toMatchObject({ status: "needs_approval" });
    expect(reads).toBe(3);
  });

  it("gives up at the ceiling and hands back the running reading unchanged", async () => {
    // Shape is what the model used to get immediately, so `next_step` still applies.
    const { out, elapsed } = await settle([reading("running")], 10_000);
    expect(out.body).toMatchObject({ status: "running" });
    expect(elapsed).toBeLessThanOrEqual(10_000);
  });

  it("reports progress once per wait, never for a run it did not wait on", async () => {
    const { waits } = await settle([reading("running"), reading("ended")]);
    expect(waits).toEqual([0]);
    const quiet = await settle([reading("ended")]);
    expect(quiet.waits).toEqual([]);
  });

  it("does not wait at all when the ceiling is zero", async () => {
    // The override that returns the old behaviour without a release.
    const { out, reads } = await settle([reading("running")], 0);
    expect(out.body).toMatchObject({ status: "running" });
    expect(reads).toBe(1);
  });

  it("surfaces a failed read instead of sitting on it", async () => {
    const { out, reads } = await settle([reading("running", 503)]);
    expect(out.status).toBe(503);
    expect(reads).toBe(1);
  });
});
