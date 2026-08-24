import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CALLBACK_PATH,
  CallbackListener,
  parseAsk,
  startCallbackListener,
} from "../../src/tools/ask-browserstack/callback.js";
import {
  AskError, atlasBaseUrl, atlasToken,
} from "../../src/tools/ask-browserstack/config.js";
import { agentHeaders } from "../../src/tools/ask-browserstack/egress.js";
import {
  appliedBeforeStop,
  buildResult,
  decide,
  errorResult,
  deriveStatus,
  elicitationMessage,
  neverReachedAgent,
} from "../../src/tools/ask-browserstack/relay.js";
import { ApprovalRecord } from "../../src/tools/ask-browserstack/types.js";

const PERM = "perm-" + "a".repeat(32);

function ask(overrides: Record<string, unknown> = {}) {
  return {
    perm_id: PERM,
    product: "tm",
    mode: "ask-always",
    description: "Create the folder \"Regression\" under Sprint 42.",
    ...overrides,
  };
}

async function post(
  listener: CallbackListener,
  body: unknown,
  token: string | null = listener.token,
  path = CALLBACK_PATH,
  method = "POST",
) {
  const response = await fetch(
    listener.url.replace(CALLBACK_PATH, path),
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe("decide — CONTRACT §7, and nothing but", () => {
  it("allows only an explicit accept AND confirm: true", () => {
    expect(decide({ action: "accept", content: { confirm: true } }))
      .toEqual({ decision: "allow", reason: "" });
  });

  it("denies accept + confirm: false as the human saying no", () => {
    expect(decide({ action: "accept", content: { confirm: false } }))
      .toEqual({ decision: "deny", reason: "declined" });
  });

  it("denies a decline", () => {
    expect(decide({ action: "decline" }))
      .toEqual({ decision: "deny", reason: "declined" });
  });

  it("denies a cancel, and says WHICH — no human was there", () => {
    // The load-bearing row: a headless Claude Code returns cancel, so an unattended run
    // must never be able to self-approve.
    expect(decide({ action: "cancel" }))
      .toEqual({ decision: "deny", reason: "cancelled" });
  });

  it("does not accept a truthy stand-in for consent", () => {
    // A string "true" or a 1 is a client bug, not an approval.
    expect(decide({ action: "accept", content: { confirm: "true" } }).decision).toBe("deny");
    expect(decide({ action: "accept", content: {} }).decision).toBe("deny");
    expect(decide({ action: "accept" }).decision).toBe("deny");
  });

  it("treats an action it does not recognise as no answer at all", () => {
    expect(decide({ action: "something-new" } as never).decision).toBe("deny");
  });
});

describe("applied_before_stop — the field that stops a half-applied retry", () => {
  const allow: ApprovalRecord = { description: "a", decision: "allow", reason: "" };
  const deny: ApprovalRecord = { description: "b", decision: "deny", reason: "declined" };

  it("is false when nothing was asked", () => {
    expect(appliedBeforeStop([])).toBe(false);
  });

  it("is false when the FIRST thing asked was refused: nothing happened", () => {
    expect(appliedBeforeStop([deny, allow])).toBe(false);
  });

  it("is true when an allow preceded a deny: some steps applied, then it stopped", () => {
    expect(appliedBeforeStop([allow, deny])).toBe(true);
  });

  it("is false when everything was allowed, because nothing stopped", () => {
    expect(appliedBeforeStop([allow, allow])).toBe(false);
  });
});

describe("result assembly", () => {
  it("prefers the status Atlas declared over anything it could infer", () => {
    expect(deriveStatus({ status: 200, body: { status: "blocked" } }, [], [])).toBe("blocked");
  });

  it("calls a run blocked when something was denied or left needing approval", () => {
    const denied: ApprovalRecord[] = [{ description: "d", decision: "deny", reason: "cancelled" }];
    expect(deriveStatus({ status: 200, body: {} }, denied, [])).toBe("blocked");
    expect(deriveStatus({ status: 200, body: {} }, [], ["a write"])).toBe("blocked");
    expect(deriveStatus({ status: 200, body: {} }, [], [])).toBe("ok");
  });

  it("maps 429 to rate_limited and every other non-2xx, including 0, to error", () => {
    expect(deriveStatus({ status: 429, body: {} }, [], [])).toBe("rate_limited");
    expect(deriveStatus({ status: 500, body: {} }, [], [])).toBe("error");
    expect(deriveStatus({ status: 0, body: null }, [], [])).toBe("error");
  });

  it("carries Atlas's payload through and never rewrites the answer", () => {
    const body = { status: "ok", answer: "Created folder 12.", needs_approval: [], extra: "kept" };
    const result = buildResult({ status: 200, body }, [], true);
    expect(result.ok).toBe(true);
    expect(result.answer).toBe("Created folder 12.");
    // Belt and braces: nothing Atlas sent is lost, even a field this side does not map.
    expect(result.atlas_response).toEqual(body);
    expect(result.permission_relay).toEqual({
      used: true, reason: "", detail: expect.stringContaining("asked before each change"),
    });
  });

  it("explains a read-only run rather than leaving a refused write unexplained", () => {
    const result = buildResult(
      { status: 200, body: { status: "blocked", answer: "", needs_approval: ["create folder"] } },
      [], false,
    );
    expect(result.status).toBe("blocked");
    expect(result.needs_approval).toEqual(["create folder"]);
    expect(result.permission_relay.used).toBe(false);
    expect(result.permission_relay.reason).toBe("no_human");
    expect(result.permission_relay.detail).toMatch(/does not support MCP elicitation/);
  });
});

describe("the loopback callback listener", () => {
  const open: CallbackListener[] = [];

  afterEach(async () => {
    while (open.length) await open.pop()!.close();
  });

  async function listen(handler: Parameters<typeof startCallbackListener>[0]) {
    const listener = await startCallbackListener(handler);
    open.push(listener);
    return listener;
  }

  it("binds loopback on a port the OS chose, never 0.0.0.0 and never a fixed one", async () => {
    const first = await listen(async () => ({ perm_id: PERM, decision: "deny", reason: "" }));
    const second = await listen(async () => ({ perm_id: PERM, decision: "deny", reason: "" }));

    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/atlas-permission$/);
    expect(first.url).not.toBe(second.url);
    // Two concurrent calls must not be able to answer each other's asks.
    expect(first.token).not.toBe(second.token);
    expect(first.token).toHaveLength(64);
  });

  it("answers a properly authenticated ask, echoing perm_id exactly", async () => {
    const seen: string[] = [];
    const listener = await listen(async (incoming) => {
      seen.push(incoming.description);
      return { perm_id: incoming.perm_id, decision: "allow", reason: "" };
    });

    const response = await post(listener, ask());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ perm_id: PERM, decision: "allow", reason: "" });
    expect(seen).toEqual(["Create the folder \"Regression\" under Sprint 42."]);
  });

  it("401s a callback with a wrong or missing token, and elicits NOTHING", async () => {
    // A stray local process must not be able to make an approval prompt appear.
    const handler = vi.fn();
    const listener = await listen(handler as never);

    expect((await post(listener, ask(), null)).status).toBe(401);
    expect((await post(listener, ask(), "")).status).toBe(401);
    expect((await post(listener, ask(), "not-the-token")).status).toBe(401);
    expect((await post(listener, ask(), listener.token + "x")).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a perm_id that is not Atlas's shape, without asking anyone", async () => {
    const handler = vi.fn();
    const listener = await listen(handler as never);

    expect((await post(listener, ask({ perm_id: "perm-nope" }))).status).toBe(400);
    expect((await post(listener, ask({ perm_id: "1234" }))).status).toBe(400);
    expect((await post(listener, ask({ perm_id: undefined }))).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a blank description: a prompt asking a human to approve nothing", async () => {
    const handler = vi.fn();
    const listener = await listen(handler as never);
    expect((await post(listener, ask({ description: "   " }))).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a body it cannot parse", async () => {
    const handler = vi.fn();
    const listener = await listen(handler as never);
    expect((await post(listener, "{not json")).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("404s anything that is not a POST to the callback path", async () => {
    const handler = vi.fn();
    const listener = await listen(handler as never);
    expect((await post(listener, ask(), listener.token, "/", "POST")).status).toBe(404);
    expect((await post(listener, ask(), listener.token, CALLBACK_PATH, "PUT")).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed with a non-200 when the relay itself throws", async () => {
    const listener = await listen(async () => {
      throw new Error("client went away");
    });
    // Atlas maps a non-200 to a deny, so a broken relay cannot approve anything.
    expect((await post(listener, ask())).status).toBe(500);
  });

  it("stops accepting connections once closed", async () => {
    const listener = await startCallbackListener(async (incoming) => ({
      perm_id: incoming.perm_id, decision: "allow", reason: "",
    }));
    const url = listener.url;
    await listener.close();
    await expect(fetch(url, { method: "POST", body: "{}" })).rejects.toThrow();
  });
});

describe("parseAsk", () => {
  it("keeps only the four fields of CONTRACT §2", () => {
    // op_key, method, path and host stay on Atlas's side; if one ever arrived it would not
    // be carried onward from here.
    expect(parseAsk({ ...ask(), op_key: "x", method: "POST", path: "/api/v1/x" }))
      .toEqual(ask());
  });

  it("rejects a non-object", () => {
    expect(parseAsk(null)).toBeNull();
    expect(parseAsk([ask()])).toBeNull();
    expect(parseAsk("perm-x")).toBeNull();
  });
});

describe("host resolution", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses by name rather than guessing a host", () => {
    delete process.env.ASK_BROWSERSTACK_ATLAS_URL;
    delete process.env.ASK_BROWSERSTACK_ENV;
    delete process.env.CAPABILITY_REGISTRY_ENV;
    expect(() => atlasBaseUrl()).toThrow(AskError);
    expect(() => atlasBaseUrl()).toThrow(/ASK_BROWSERSTACK_ATLAS_URL/);
  });

  it("lets the named environment pick the host, so preprod cannot fall back to prod", () => {
    delete process.env.ASK_BROWSERSTACK_ATLAS_URL;
    process.env.ASK_BROWSERSTACK_ENV = "preprod";
    process.env.ASK_BROWSERSTACK_ATLAS_URL_PREPROD = "https://atlas-preprod.example/";
    expect(atlasBaseUrl()).toBe("https://atlas-preprod.example");
  });

  it("lets an explicit override win", () => {
    process.env.ASK_BROWSERSTACK_ENV = "preprod";
    process.env.ASK_BROWSERSTACK_ATLAS_URL = "https://atlas.example/";
    expect(atlasBaseUrl()).toBe("https://atlas.example");
  });
});

describe("the verified /agent response shape — CONTRACT v1.1 §B", () => {
  it("reads an ABSENT needs_approval as empty, because public() omits it when empty", () => {
    // The trap: Atlas never sends `[]`, it sends nothing at all. Same for narration,
    // artifacts, error, cost_breach and usage.
    const result = buildResult(
      { status: 200, body: { ok: true, status: "ok", answer: "done", steps: [] } },
      [], true,
    );
    expect(result.needs_approval).toEqual([]);
    expect(result.status).toBe("ok");
    expect(result.ok).toBe(true);
  });

  it("passes through every status in the verified vocabulary", () => {
    for (const status of ["ok", "error", "blocked", "rate_limited"]) {
      expect(deriveStatus({ status: 200, body: { status } }, [], [])).toBe(status);
    }
  });

  it("ignores a status outside the vocabulary and derives one instead", () => {
    // `interrupted` is in the dataclass comment but is not emitted on this path.
    expect(deriveStatus({ status: 200, body: { status: "interrupted" } }, [], [])).toBe("ok");
    expect(deriveStatus(
      { status: 200, body: { status: "interrupted", needs_approval: ["x"] } }, [], ["x"],
    )).toBe("blocked");
  });

  it("lifts Atlas's own error string to the top level rather than burying it", () => {
    const result = buildResult(
      { status: 200, body: { ok: true, status: "error", answer: "", error: "the run died" } },
      [], true,
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe("the run died");
  });

  it("has no error key when Atlas reported none", () => {
    const result = buildResult({ status: 200, body: { status: "ok", answer: "" } }, [], true);
    expect("error" in result).toBe(false);
  });
});

describe("Atlas's permission_relay verdict — CONTRACT v1.1 §D", () => {
  function relayOf(permission_relay: unknown, relayUsed = true) {
    return buildResult(
      { status: 200, body: { status: "blocked", answer: "", permission_relay } },
      [], relayUsed,
    ).permission_relay;
  }

  it("prefers Atlas's used/reason over anything this side inferred", () => {
    // We offered the channel and would have inferred used: true. Atlas knows better.
    expect(relayOf({ used: false, reason: "disabled" })).toMatchObject({
      used: false, reason: "disabled",
    });
    expect(relayOf({ used: true, reason: "" })).toMatchObject({ used: true, reason: "" });
  });

  it("says plainly that a disabled relay is NOT anyone declining", () => {
    // The distinction a user cannot make for themselves, and will retry forever without.
    const relay = relayOf({ used: false, reason: "disabled" });
    expect(relay.detail).toMatch(/NOBODY DECLINED THIS/);
    expect(relay.detail).toMatch(/administrator turns the relay on/);
    expect(relay.detail).not.toMatch(/does not support MCP elicitation/);
  });

  it("gives host_not_allowed and malformed their own distinct sentences", () => {
    const host = relayOf({ used: false, reason: "host_not_allowed" }).detail;
    const malformed = relayOf({ used: false, reason: "malformed" }).detail;
    expect(host).toMatch(/allowed-callback list/);
    expect(host).toMatch(/same host/);
    expect(malformed).toMatch(/bug on this side/);
    expect(host).not.toBe(malformed);
  });

  it("degrades an unrecognised reason to a sentence instead of crashing", () => {
    // Forward compatibility: an Atlas newer than this build may name a reason we have
    // never heard of, and a result is not the place to throw.
    const relay = relayOf({ used: false, reason: "quota_exhausted" });
    expect(relay.used).toBe(false);
    expect(relay.reason).toBe("quota_exhausted");
    expect(relay.detail).toMatch(/does not recognise/);
    expect(relay.detail).toMatch(/quota_exhausted/);
  });

  it("bounds an absurd reason before putting it in a sentence a human reads", () => {
    const relay = relayOf({ used: false, reason: "x".repeat(5000) });
    expect(relay.detail.length).toBeLessThan(500);
  });

  it("falls back to the inferred verdict when Atlas sends none (an Atlas older than v1.1)", () => {
    expect(relayOf(undefined)).toEqual({
      used: true, reason: "", detail: expect.stringContaining("asked before each change"),
    });
  });

  it("treats an unreadable verdict as no verdict rather than half-trusting it", () => {
    expect(relayOf({ reason: "disabled" }).used).toBe(true);      // no `used` boolean
    expect(relayOf("disabled").used).toBe(true);
    expect(relayOf([{ used: false }]).used).toBe(true);
  });

  it("keeps no_human ours: Atlas is never told the client cannot be prompted", () => {
    // We omitted the block, so anything Atlas says about a relay cannot be about this run.
    const relay = relayOf({ used: true, reason: "" }, false);
    expect(relay).toEqual({
      used: false,
      reason: "no_human",
      detail: expect.stringContaining("does not support MCP elicitation"),
    });
  });
});

describe("the elicitation message — CONTRACT v1.1 §G", () => {
  it("names the product and leaves the description untouched", () => {
    const message = elicitationMessage("tm", "Create folder \"Regression\".");
    expect(message).toBe(
      "BrowserStack AI (Test Management) needs your approval to continue:\n\n" +
        "Create folder \"Regression\".",
    );
    // Verbatim: the human must approve what the model actually said.
    expect(message.endsWith("Create folder \"Regression\".")).toBe(true);
  });

  it("labels every product the tool accepts", () => {
    expect(elicitationMessage("a11y", "x")).toMatch(/\(Accessibility\)/);
    expect(elicitationMessage("tra", "x")).toMatch(/\(Test Reporting & Analytics\)/);
  });

  it("carries a product it has no label for rather than dropping it", () => {
    expect(elicitationMessage("newproduct", "x")).toMatch(/\(newproduct\)/);
  });

  it("omits the brackets entirely rather than showing an empty pair", () => {
    expect(elicitationMessage("", "x")).toBe(
      "BrowserStack AI needs your approval to continue:\n\nx",
    );
  });

  it("still reads as a prompt when Atlas withheld a route-shaped description", () => {
    // v1.1 §A: a description that trips Atlas's route guard is replaced, not dropped, so
    // what arrives is a sentence — and must not look like a bug once framed.
    //
    // THE REAL BYTES, from `collector.py:172-176` — `f"({kind} withheld: it referenced
    // internal API detail)"` with kind="approval request" — and observed on the wire in the
    // integration run. An invented placeholder is the one string in this feature a test can
    // assert on and be confidently wrong about.
    const withheld = "(approval request withheld: it referenced internal API detail)";
    expect(elicitationMessage("tm", withheld)).toBe(
      "BrowserStack AI (Test Management) needs your approval to continue:\n\n" + withheld,
    );
  });
});

describe("POST /agent headers — CONTRACT v1.2 §4", () => {
  it("is exactly three headers, and Api-Token is not one of them", () => {
    // /agent has no Api-Token path, and that header carries the user's access key. Asserting
    // the exact key set is what stops it being reintroduced by a helpful future edit.
    expect(agentHeaders("shared-delegation-token")).toEqual({
      Authorization: "Bearer shared-delegation-token",
      "Content-Type": "application/json",
      "request-source": "ai-chatbot",
    });
  });
});

describe("the delegation token", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses by name, naming the variable and never a value", () => {
    delete process.env.ASK_BROWSERSTACK_ATLAS_TOKEN;
    delete process.env.ASK_BROWSERSTACK_ENV;
    delete process.env.CAPABILITY_REGISTRY_ENV;
    expect(() => atlasToken()).toThrow(AskError);
    expect(() => atlasToken()).toThrow(/ASK_BROWSERSTACK_ATLAS_TOKEN/);
  });

  it("treats a blank token as unset rather than sending `Bearer `", () => {
    process.env.ASK_BROWSERSTACK_ATLAS_TOKEN = "   ";
    delete process.env.ASK_BROWSERSTACK_ENV;
    delete process.env.CAPABILITY_REGISTRY_ENV;
    expect(() => atlasToken()).toThrow(AskError);
  });

  it("takes the environment's token when one is named, and trims it", () => {
    delete process.env.ASK_BROWSERSTACK_ATLAS_TOKEN;
    process.env.ASK_BROWSERSTACK_ENV = "preprod";
    process.env.ASK_BROWSERSTACK_ATLAS_TOKEN_PREPROD = "  preprod-token  ";
    expect(atlasToken()).toBe("preprod-token");
  });

  it("lets an explicit token win", () => {
    process.env.ASK_BROWSERSTACK_ENV = "preprod";
    process.env.ASK_BROWSERSTACK_ATLAS_TOKEN_PREPROD = "preprod-token";
    process.env.ASK_BROWSERSTACK_ATLAS_TOKEN = "explicit-token";
    expect(atlasToken()).toBe("explicit-token");
  });
});

describe("pre-run refusals — the request never reached the agent (D3)", () => {
  // Atlas omits its permission_relay verdict on every refusal that dies before the
  // delegation layer, so "no verdict" alone cannot be read as "an old Atlas".
  const REFUSALS: [string, { status: number; body: unknown; error?: string }][] = [
    ["401 unauthorized", { status: 401, body: { detail: "unauthorized" } }],
    ["400 bad body", { status: 400, body: { detail: "task is required" } }],
    ["503 delegation not enabled", { status: 503, body: { detail: "delegation is not enabled" } }],
    ["unreachable", { status: 0, body: null, error: "BrowserStack AI could not be reached" }],
  ];

  it.each(REFUSALS)("detects %s", (_name, response) => {
    expect(neverReachedAgent(response)).toBe(true);
  });

  it.each(REFUSALS)("never claims the channel was used on %s", (_name, response) => {
    // The bug: `used: true` with an empty `approvals` and an `error` saying nothing was
    // asked — three fields in one payload contradicting each other.
    const relay = buildResult(response, [], true).permission_relay;
    expect(relay.used).toBe(false);
    expect(relay.reason).toBe("not_reached");
    expect(relay.detail).toMatch(/NOTHING WAS ASKED AND NOTHING WAS REFUSED/);
    expect(relay.detail).not.toMatch(/asked before each change/);
  });

  it.each(REFUSALS)("always says why, on %s", (_name, response) => {
    // A pre-run refusal with `status: "error"` and no `error` string leaves a caller with
    // nothing to act on. 400 and 503 carry `detail`, never `error`.
    const result = buildResult(response, [], true);
    expect(result.status).toBe("error");
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
    expect(result.approvals).toEqual([]);
    expect(result.applied_before_stop).toBe(false);
  });

  it("names the HTTP status and quotes Atlas's detail on a 400 and a 503", () => {
    expect(buildResult({ status: 400, body: { detail: "task is required" } }, [], true).error)
      .toBe('BrowserStack AI refused this request before the agent started (HTTP 400): "task is required".');
    expect(buildResult(
      { status: 503, body: { detail: "delegation is not enabled" } }, [], true,
    ).error).toMatch(/HTTP 503.*delegation is not enabled/);
  });

  it("bounds a detail string before putting it in front of a person", () => {
    const result = buildResult({ status: 400, body: { detail: "x".repeat(5000) } }, [], true);
    expect(result.error!.length).toBeLessThan(400);
  });

  it("still says something when a non-2xx has nothing to say for itself", () => {
    expect(buildResult({ status: 502, body: null }, [], true).error)
      .toBe("BrowserStack AI refused this request before the agent started (HTTP 502).");
  });

  it("outranks no_human: a client that cannot elicit did not 'run read-only' either", () => {
    // Saying the run went read-only would be as wrong as saying the channel was used —
    // nothing ran at all. The elicitation gap resurfaces on the next run.
    const relay = buildResult(
      { status: 401, body: { detail: "unauthorized" } }, [], false,
    ).permission_relay;
    expect(relay.reason).toBe("not_reached");
    expect(relay.detail).not.toMatch(/does not support MCP elicitation/);
  });

  it("treats a 200 carrying a bare detail as not a delegation result", () => {
    expect(neverReachedAgent({ status: 200, body: { detail: "nope" } })).toBe(true);
    // ...but a real result that happens to carry a detail field is still a result.
    expect(neverReachedAgent({
      status: 200, body: { ok: true, status: "ok", answer: "", detail: "fyi" },
    })).toBe(false);
  });

  it("leaves a genuine agent run alone", () => {
    const response = { status: 200, body: { ok: true, status: "ok", answer: "done" } };
    expect(neverReachedAgent(response)).toBe(false);
    expect(buildResult(response, [], true).permission_relay).toEqual({
      used: true, reason: "", detail: expect.stringContaining("asked before each change"),
    });
  });

  it("says the same thing when the call never left this process", () => {
    // No token, no host, a transport that threw: nothing was sent, so nothing was asked.
    const relay = errorResult("BrowserStack AI is not authenticated: set …", []).permission_relay;
    expect(relay).toEqual({
      used: false,
      reason: "not_reached",
      detail: expect.stringContaining("NOTHING WAS ASKED AND NOTHING WAS REFUSED"),
    });
  });

  it("keeps a pre-run refusal from reading like a relay that was switched off", () => {
    // `disabled` means the agent RAN with the relay off — retry after an admin acts.
    // `not_reached` means it never ran at all — fix what `error` names and retry now.
    const notReached = buildResult(
      { status: 401, body: { detail: "unauthorized" } }, [], true,
    ).permission_relay;
    const disabled = buildResult(
      { status: 200, body: { status: "blocked", permission_relay: { used: false, reason: "disabled" } } },
      [], true,
    ).permission_relay;
    expect(notReached.reason).not.toBe(disabled.reason);
    expect(notReached.detail).not.toBe(disabled.detail);
    expect(disabled.detail).toMatch(/administrator turns the relay on/);
    expect(notReached.detail).toMatch(/run it again/);
  });
});
