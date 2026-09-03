/**
 * CONTRACT v2 (A1) — the stream transport.
 *
 * These test the PIPE, not the judgement. Whether a human approved, how an elicitation
 * outcome maps to allow/deny, what the result looks like: all of that is `relay.ts`,
 * which A1 does not touch and which `askBrowserstack.test.ts` already covers. Mixing
 * the two here would imply the transport can influence a decision, which is the exact
 * property the design prevents.
 *
 * Chunk boundaries get most of the attention on purpose. A dropped frame is an ask that
 * never reaches the human — a write that silently never gets approved and never says
 * why — and it is the failure a hand-rolled SSE parser actually produces.
 */

import { describe, expect, it, vi } from "vitest";

import {
  EVENT_PERMISSION,
  EVENT_RESULT,
  EVENT_RUN,
  WHOLE_RUN_TIMEOUT_MS,
  decisionUrl,
  fetchAgentStreamTransport,
  fetchDecisionTransport,
  parseFrame,
  splitFrames,
} from "../../src/tools/ask-browserstack/stream.js";

describe("splitFrames", () => {
  it("returns complete frames and keeps the remainder", () => {
    const { frames, rest } = splitFrames("a\n\nb\n\npartial");
    expect(frames).toEqual(["a", "b"]);
    expect(rest).toBe("partial");
  });

  it("holds a frame that has not terminated yet", () => {
    // The single most likely real failure: an ask arrives split across two reads. If
    // this returned it early the JSON would be truncated and the ask lost.
    const { frames, rest } = splitFrames("event: permission\ndata: {\"perm");
    expect(frames).toEqual([]);
    expect(rest).toBe('event: permission\ndata: {"perm');
  });

  it("handles several frames arriving in one read", () => {
    const { frames, rest } = splitFrames("one\n\ntwo\n\nthree\n\n");
    expect(frames).toEqual(["one", "two", "three"]);
    expect(rest).toBe("");
  });
});

describe("parseFrame", () => {
  it("parses an event and its JSON payload", () => {
    expect(parseFrame('event: run\ndata: {"run_id":"run-abc"}')).toEqual({
      event: "run",
      data: { run_id: "run-abc" },
    });
  });

  it("ignores the heartbeat", () => {
    // A bare comment. Its only job is to be a read on the socket so the ingress does
    // not close the connection while a human is thinking, so it must not surface as
    // an event the caller has to know about.
    expect(parseFrame(": keepalive")).toBeNull();
  });

  it("ignores a frame with no event name", () => {
    expect(parseFrame('data: {"stray":true}')).toBeNull();
  });

  it("drops a frame whose JSON will not parse rather than guessing", () => {
    // Safe to drop: the only consequence is that an ask goes unanswered and Atlas's
    // gate denies on its own expiry. Never that something is approved.
    expect(parseFrame("event: permission\ndata: {not json")).toBeNull();
  });

  it("keeps a description containing JSON-escaped punctuation", () => {
    const frame =
      'event: permission\ndata: {"perm_id":"p","description":"Mark run \\"1043\\" done"}';
    expect((parseFrame(frame)?.data as { description: string }).description).toBe(
      'Mark run "1043" done',
    );
  });
});

/** A Response whose body streams the given chunks, as Node's fetch would. */
function streamingResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("fetchAgentStreamTransport", () => {
  it("yields run, permission and result in order across chunk boundaries", async () => {
    // The frames are deliberately split mid-JSON and mid-frame, which is what a real
    // socket does and what a naive parser gets wrong.
    const fetchMock = vi.fn().mockResolvedValue(
      streamingResponse([
        'event: run\ndata: {"run_id":"run-1"}\n',
        '\nevent: permission\ndata: {"perm_id":"perm-1","product":"tm",',
        '"mode":"ask-once","description":"Mark run 1043 complete"}\n\n',
        ": keepalive\n\n",
        'event: result\ndata: {"ok":true,"status":"ok"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const seen: Array<{ event: string; data: unknown }> = [];
    for await (const ev of fetchAgentStreamTransport()(
      "https://atlas.test/agent",
      { Authorization: "Bearer t" },
      { task: "t", product: "tm" } as never,
    )) {
      seen.push(ev);
    }

    expect(seen.map((e) => e.event)).toEqual([
      EVENT_RUN,
      EVENT_PERMISSION,
      EVENT_RESULT,
    ]);
    expect((seen[1].data as { description: string }).description).toBe(
      "Mark run 1043 complete",
    );
    // Asks for a stream explicitly, and keeps the caller's auth header.
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(init.headers.Authorization).toBe("Bearer t");
    expect(init.redirect).toBe("manual");
    vi.unstubAllGlobals();
  });

  it("throws rather than iterating empty when the response is not a stream", async () => {
    // An empty iteration is indistinguishable from "the run finished and said
    // nothing", so a refusal has to be loud.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 403 })),
    );
    const iterate = async () => {
      for await (const _ of fetchAgentStreamTransport()(
        "https://atlas.test/agent",
        {},
        {} as never,
      )) {
        void _;
      }
    };
    await expect(iterate()).rejects.toThrow(/HTTP 403/);
    vi.unstubAllGlobals();
  });

  it("yields a trailing frame that never got its blank line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamingResponse(['event: result\ndata: {"ok":true}']),
      ),
    );
    const seen = [];
    for await (const ev of fetchAgentStreamTransport()(
      "https://atlas.test/agent",
      {},
      {} as never,
    )) {
      seen.push(ev);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toBe(EVENT_RESULT);
    vi.unstubAllGlobals();
  });

  it("bounds the whole run, not one request", () => {
    // v2 §4: the old 330s outer rung meant nothing once the stream spans a run that
    // may hold several 300s approvals in series.
    expect(WHOLE_RUN_TIMEOUT_MS).toBe(1_800_000);
  });
});

describe("fetchDecisionTransport", () => {
  it("returns the status so the caller can tell 204 from 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    const status = await fetchDecisionTransport()(
      "https://atlas.test/agent/run-1/permission",
      {},
      { perm_id: "perm-1", decision: "allow", reason: "" },
    );
    expect(status).toBe(204);
    vi.unstubAllGlobals();
  });

  it("reports 0 when the decision never left, rather than implying a refusal", async () => {
    // The gate on the far side is still waiting and denies on its own expiry, so a
    // lost decision is safe. But it must not be reported as "the human said no".
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket closed")));
    const status = await fetchDecisionTransport()(
      "https://atlas.test/agent/run-1/permission",
      {},
      { perm_id: "perm-1", decision: "allow", reason: "" },
    );
    expect(status).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe("decisionUrl", () => {
  it("builds the v2 §3 path from the agent url", () => {
    expect(decisionUrl("https://atlas.test/agent", "run-abc")).toBe(
      "https://atlas.test/agent/run-abc/permission",
    );
  });

  it("tolerates a trailing slash and escapes the id", () => {
    expect(decisionUrl("https://atlas.test/agent/", "run-a/b")).toBe(
      "https://atlas.test/agent/run-a%2Fb/permission",
    );
  });
});

describe("the relay never claims a person answered when none did", () => {
  it("says nobody was present, instead of 'the answers are in approvals'", async () => {
    // Observed live against a real Atlas: a headless client returned `cancel`, and the
    // result carried BOTH "BrowserStack asked before each change and the answers are in
    // `approvals`" AND an approvals entry reading "refused: nobody was there to be
    // asked". Two sentences in one payload contradicting each other.
    const { buildResult, RELAY_ON_NO_ANSWER_DETAIL, nobodyAnswered } = await import(
      "../../src/tools/ask-browserstack/relay.js"
    );

    expect(
      nobodyAnswered([
        { description: "Create folder.", decision: "deny", reason: "cancelled" },
      ]),
    ).toBe(true);

    const result = buildResult(
      {
        status: 200,
        body: {
          status: "blocked",
          answer: null,
          approvals: [
            { description: "Create folder.", decision: "deny", reason: "cancelled",
              applied: false },
          ],
          applied_before_stop: false,
          permission_relay: { used: true, reason: "" },
        },
      },
      [{ description: "Create folder.", decision: "deny", reason: "cancelled" }],
      "offered",
      "tm",
    );

    expect(result.permission_relay.used).toBe(true);
    expect(result.permission_relay.detail).toBe(RELAY_ON_NO_ANSWER_DETAIL);
    // And the two halves of the payload now agree with each other.
    expect(result.approvals[0].outcome).toMatch(/nobody was there/);
    expect(result.permission_relay.detail).toMatch(/without a person/);
  });

  it("still credits a real human answer", async () => {
    // The correction must not fire when somebody actually declined — "a person said no"
    // and "no person was there" call for different things from the reader.
    const { buildResult, RELAY_ON_DETAIL, nobodyAnswered } = await import(
      "../../src/tools/ask-browserstack/relay.js"
    );
    expect(
      nobodyAnswered([
        { description: "x", decision: "deny", reason: "declined" },
      ]),
    ).toBe(false);

    const result = buildResult(
      {
        status: 200,
        body: {
          status: "blocked",
          approvals: [{ description: "x", decision: "deny", reason: "declined",
                        applied: false }],
          permission_relay: { used: true, reason: "" },
        },
      },
      [{ description: "x", decision: "deny", reason: "declined" }],
      "offered",
      "tm",
    );
    expect(result.permission_relay.detail).toBe(RELAY_ON_DETAIL);
  });

  it("does not fire on an empty trail", async () => {
    // Nothing asked at all is a different state, already described correctly.
    const { nobodyAnswered } = await import("../../src/tools/ask-browserstack/relay.js");
    expect(nobodyAnswered([])).toBe(false);
  });

  it("does not fire when one ask was allowed", async () => {
    const { nobodyAnswered } = await import("../../src/tools/ask-browserstack/relay.js");
    expect(
      nobodyAnswered([
        { description: "a", decision: "allow", reason: "" },
        { description: "b", decision: "deny", reason: "cancelled" },
      ]),
    ).toBe(false);
  });
});

describe("an auth outage is not a credential problem", () => {
  it("a 5xx says the service is down, and never names your credentials", async () => {
    // Observed live: preprod auth returned 503 during an outage and the tool answered
    // "Your BrowserStack credentials were rejected … Check BROWSERSTACK_USERNAME and
    // BROWSERSTACK_ACCESS_KEY" — sending someone to audit env vars that had worked
    // minutes earlier. The reader asked "is preprod down?", which was right, and the
    // message argued against it.
    const { AUTH_SERVER_ERROR_DETAIL, mintCentralToken } = await import(
      "../../src/tools/ask-browserstack/central-oauth.js"
    );

    for (const status of [500, 502, 503, 504]) {
      const transport = vi.fn(async () => ({ status, body: null }));
      await expect(
        mintCentralToken(
          "https://auth.example/token",
          { username: "u", accessKey: "k" },
          transport as never,
        ),
      ).rejects.toThrow(/auth is unavailable/);
    }

    const text = AUTH_SERVER_ERROR_DETAIL(503);
    expect(text).toMatch(/CREDENTIALS ARE NOT THE PROBLEM/);
    expect(text).not.toMatch(/BROWSERSTACK_USERNAME/);
    expect(text).not.toMatch(/rejected/);
  });

  it("still blames the credentials on a 401", async () => {
    // The split must not make a genuine rejection sound like an outage: those need
    // opposite actions from the reader.
    const { mintCentralToken } = await import(
      "../../src/tools/ask-browserstack/central-oauth.js"
    );
    const transport = vi.fn(async () => ({
      status: 401,
      body: { error: "invalid_client" },
    }));
    await expect(
      mintCentralToken(
        "https://auth.example/token",
        { username: "u", accessKey: "k" },
        transport as never,
      ),
    ).rejects.toThrow(/credentials were rejected/);
  });
});
