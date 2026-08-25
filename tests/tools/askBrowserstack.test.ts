import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CALLBACK_PATH,
  CallbackListener,
  parseAsk,
  startCallbackListener,
} from "../../src/tools/ask-browserstack/callback.js";
import {
  AskError, atlasBaseUrl, authTokenUrl,
} from "../../src/tools/ask-browserstack/config.js";
import {
  AUTH_REJECTED_DETAIL,
  AUTH_SCOPE_REFUSED_DETAIL,
  AUTH_UNREACHABLE_DETAIL,
  CENTRAL_SCOPE,
  refusalIsAboutScope,
  REFRESH_SKEW_MS,
  mintCentralToken,
  mintForm,
  resetTokenCache,
} from "../../src/tools/ask-browserstack/central-oauth.js";
import { agentHeaders } from "../../src/tools/ask-browserstack/egress.js";
import {
  approvalOutcome,
  buildResult,
  decide,
  elicitationShape,
  errorResult,
  deriveStatus,
  elicitationMessage,
  looksLikeDelegationResult,
  neverReachedAgent,
  UNAUTHENTICATED_DETAIL,
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
  it("allows an accept whose form carried no confirm field at all", () => {
    // THE LIVE BUG. `confirm` used to be required with `default: false`, so a client
    // rendered one unchecked checkbox and pressing APPROVE sent accept + confirm: false —
    // and a human who approved was told "refused: a human said no". The approve path was
    // unreachable. Absence of the field is now consent; `accept` already IS the answer.
    expect(decide({ action: "accept" }))
      .toEqual({ decision: "allow", reason: "" });
    expect(decide({ action: "accept", content: {} }))
      .toEqual({ decision: "allow", reason: "" });
  });

  it("allows an accept that volunteers confirm: true", () => {
    expect(decide({ action: "accept", content: { confirm: true } }))
      .toEqual({ decision: "allow", reason: "" });
  });

  it("still honours an explicit untick as the human saying no", () => {
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

  it("ignores whatever a client volunteers, except an explicit false", () => {
    // Nothing is requested any more, so the action decides. A volunteered `false` is still
    // honoured as defensive belt, but no other value can override an accept.
    for (const confirm of ["true", 1, "yes", null, undefined]) {
      expect(decide({ action: "accept", content: { confirm } } as never))
        .toEqual({ decision: "allow", reason: "" });
    }
    expect(decide({ action: "accept", content: { confirm: false } }))
      .toEqual({ decision: "deny", reason: "declined" });
  });

  it("describes the shape a client answered with, and nothing a human wrote", () => {
    expect(elicitationShape({ action: "accept" }))
      .toBe("action=accept content=absent confirm=absent");
    expect(elicitationShape({ action: "accept", content: {} }))
      .toBe("action=accept content=present confirm=absent");
    expect(elicitationShape({ action: "accept", content: { confirm: false } }))
      .toBe("action=accept content=present confirm=false");
    expect(elicitationShape({ action: "cancel" }))
      .toBe("action=cancel content=absent confirm=absent");
    expect(elicitationShape({ action: "accept", content: { confirm: "yes" } } as never))
      .toBe("action=accept content=present confirm=non-boolean");

    // It can only ever contain a fixed action enum and a boolean — never a description, a
    // credential, or anything a user typed into a form.
    const line = elicitationShape({
      action: "accept",
      content: { confirm: "SECRET", notes: 'Creating the folder "askrelay-smoke-1"' },
    } as never);
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("askrelay-smoke-1");
    expect(line).toBe("action=accept content=present confirm=non-boolean");
  });

  it("treats an action it does not recognise as no answer at all", () => {
    expect(decide({ action: "something-new" } as never).decision).toBe("deny");
  });
});

describe("applied_before_stop — read from Atlas, never derived (D2/D4)", () => {
  function build(body: Record<string, unknown>) {
    return buildResult({ status: 200, body: { status: "ok", answer: "", ...body } }, [], true);
  }

  it("reports exactly what Atlas said, both ways", () => {
    expect(build({ applied_before_stop: true }).applied_before_stop).toBe(true);
    expect(build({ applied_before_stop: false }).applied_before_stop).toBe(false);
  });

  it("reports null — NOT false — when Atlas said nothing", () => {
    // Absence means no gate ran, or an Atlas that predates the field. Rendering it as
    // `false` would assert something nobody measured, in the direction that makes a caller
    // retry a task that already half-applied.
    expect(build({}).applied_before_stop).toBeNull();
  });

  it("ignores a non-boolean rather than coercing it", () => {
    expect(build({ applied_before_stop: "true" }).applied_before_stop).toBeNull();
    expect(build({ applied_before_stop: 1 }).applied_before_stop).toBeNull();
    expect(build({ applied_before_stop: null }).applied_before_stop).toBeNull();
  });

  it("does not re-derive it from the trail it can see", () => {
    // The old rule ("any allow preceded a deny") would have said true here. Atlas says
    // false, because the approved step's request never landed — which only Atlas knows.
    const result = build({
      approvals: [
        { description: "a", decision: "allow", reason: "", applied: false },
        { description: "b", decision: "deny", reason: "declined", applied: false },
      ],
      applied_before_stop: false,
    });
    expect(result.applied_before_stop).toBe(false);
  });
});

describe("the authoritative approval trail (D4)", () => {
  const MINE: ApprovalRecord[] = [
    { description: "Creating the Alpha folder", decision: "allow", reason: "" },
  ];

  function build(body: Record<string, unknown>, mine = MINE) {
    return buildResult({ status: 200, body: { status: "ok", answer: "", ...body } }, mine, true);
  }

  it("prefers Atlas's trail over ours, and says which it used", () => {
    const result = build({
      approvals: [
        { description: "Creating the Alpha folder", decision: "allow", reason: "", applied: true },
      ],
    });
    expect(result.approvals_source).toBe("atlas");
    expect(result.approvals[0].applied).toBe(true);
  });

  it("keeps our own trail beside it, because the disagreement IS the signal", () => {
    // A callback answered with no prompt appearing — an attacker probing the loopback port
    // — is a denial to Atlas and nothing at all to us. Folding the two together would
    // destroy the only evidence that it happened.
    const result = build({
      approvals: [{ description: "Creating the Alpha folder", decision: "deny", reason: "error", applied: false }],
    }, []);
    expect(result.approvals_source).toBe("atlas");
    expect(result.approvals[0].decision).toBe("deny");
    expect(result.elicitations).toEqual([]);
  });

  it("falls back to ours only when Atlas sent no trail at all", () => {
    const result = build({});
    expect(result.approvals_source).toBe("mcp");
    expect(result.approvals[0].description).toBe("Creating the Alpha folder");
  });

  it("treats an EMPTY trail from Atlas as a trail, not as absence", () => {
    // "The relay ran and nothing was asked" is a fact Atlas sent; ours is not a better
    // answer to it.
    const result = build({ approvals: [] });
    expect(result.approvals_source).toBe("atlas");
    expect(result.approvals).toEqual([]);
  });

  it("rebuilds each entry rather than trusting it, failing closed on a garbled decision", () => {
    const result = build({
      approvals: [
        { description: "x", decision: "ALLOW", reason: "" },
        { description: "y", decision: "allow", reason: "" },
        "not an entry",
        null,
      ],
    });
    // Anything that is not exactly "allow" reports as a refusal.
    expect(result.approvals.map((e) => e.decision)).toEqual(["deny", "allow"]);
  });

  it("carries `applied` only when it is genuinely a boolean", () => {
    const result = build({
      approvals: [
        { description: "a", decision: "allow", reason: "", applied: "yes" },
        { description: "b", decision: "allow", reason: "" },
      ],
    });
    expect("applied" in result.approvals[0]).toBe(false);
    expect("applied" in result.approvals[1]).toBe(false);
  });
});

describe("approvalOutcome — 'approved then failed' must not read like a refusal", () => {
  const base = { description: "Creating the Alpha folder", reason: "" };

  it("distinguishes an applied allow from one whose request failed", () => {
    const applied = approvalOutcome({ ...base, decision: "allow", applied: true });
    const failed = approvalOutcome({ ...base, decision: "allow", applied: false });
    expect(applied).toBe("approved, and the change went through");
    expect(failed).toMatch(/APPROVED, BUT THE CHANGE DID NOT GO THROUGH/);
    expect(failed).toMatch(/nobody refused it/);
    expect(applied).not.toBe(failed);
  });

  it("does not render an unmeasured allow as a failure", () => {
    // An older Atlas, or our own trail, simply does not know.
    const unknown = approvalOutcome({ ...base, decision: "allow" });
    expect(unknown).toBe("approved; whether the change went through was not reported");
    expect(unknown).not.toMatch(/DID NOT GO THROUGH/);
  });

  it("keeps a failed write clearly apart from every kind of refusal", () => {
    const failed = approvalOutcome({ ...base, decision: "allow", applied: false });
    for (const reason of ["declined", "cancelled", "timeout", "error", "anything-else"]) {
      const refusal = approvalOutcome({ ...base, decision: "deny", reason });
      expect(refusal).toMatch(/^refused/);
      expect(refusal).not.toBe(failed);
    }
  });

  it("says WHICH kind of refusal, since they call for different things", () => {
    const of = (reason: string) => approvalOutcome({ ...base, decision: "deny", reason });
    expect(of("declined")).toMatch(/a human said no/);
    expect(of("cancelled")).toMatch(/nobody was there/);
    expect(of("timeout")).toMatch(/nobody answered in time/);
    expect(of("error")).toMatch(/channel broke/);
    expect(of("something-new")).toBe("refused");
  });

  it("is attached to every entry in both trails", () => {
    const result = buildResult(
      {
        status: 200,
        body: {
          status: "ok", answer: "",
          approvals: [{ description: "a", decision: "allow", reason: "", applied: false }],
        },
      },
      [{ description: "a", decision: "allow", reason: "" }],
      true,
    );
    expect(result.approvals[0].outcome).toMatch(/DID NOT GO THROUGH/);
    expect(result.elicitations[0].outcome).toMatch(/not reported/);
  });
});

describe("result assembly", () => {
  it("prefers the status Atlas declared over anything it could infer", () => {
    expect(deriveStatus({ status: 200, body: { status: "blocked" } }, [], [])).toBe("blocked");
  });

  it("calls a run blocked when something was denied or left needing approval", () => {
    // A real result that simply declared no usable status — `ok` and `answer` are what mark
    // it as a delegation result at all.
    const ran = { ok: true, answer: "" };
    const denied: ApprovalRecord[] = [{ description: "d", decision: "deny", reason: "cancelled" }];
    expect(deriveStatus({ status: 200, body: ran }, denied, [])).toBe("blocked");
    expect(deriveStatus({ status: 200, body: ran }, [], ["a write"])).toBe("blocked");
    expect(deriveStatus({ status: 200, body: ran }, [], [])).toBe("ok");
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
    expect(agentHeaders("minted.central.jwt")).toEqual({
      Authorization: "Bearer minted.central.jwt",
      "Content-Type": "application/json",
      "request-source": "ai-chatbot",
    });
  });
});

describe("where we sign in", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses by name rather than guessing an auth host", () => {
    delete process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL;
    delete process.env.ASK_BROWSERSTACK_ENV;
    delete process.env.CAPABILITY_REGISTRY_ENV;
    expect(() => authTokenUrl()).toThrow(AskError);
    expect(() => authTokenUrl()).toThrow(/ASK_BROWSERSTACK_AUTH_TOKEN_URL/);
  });

  it("lets the environment pick it, so preprod cannot sign in against production", () => {
    delete process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL;
    process.env.ASK_BROWSERSTACK_ENV = "preprod";
    process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL_PREPROD = "  https://auth-pp.example/t  ";
    expect(authTokenUrl()).toBe("https://auth-pp.example/t");
  });

  it("lets an explicit endpoint win", () => {
    process.env.ASK_BROWSERSTACK_ENV = "preprod";
    process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL_PREPROD = "https://auth-pp.example/t";
    process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL = "https://auth.example/t";
    expect(authTokenUrl()).toBe("https://auth.example/t");
  });
});

describe("minting a central JWT", () => {
  const URL_ = "https://auth.example/oauth2/v2/token";
  const CREDS = { username: "ing_Xx", accessKey: "SECRET" };
  const OK = { status: 200, body: { access_token: "jwt.aaa", expires_in: 3600 } };

  beforeEach(() => resetTokenCache());
  afterEach(() => resetTokenCache());

  function recording(response: any = OK) {
    const seen: { url: string; form: Record<string, string> }[] = [];
    const transport = async (url: string, form: Record<string, string>) => {
      seen.push({ url, form });
      return typeof response === "function" ? response() : response;
    };
    return { seen, transport };
  }

  it("sends the client_credentials grant verbatim, with BOTH scope parts", () => {
    expect(mintForm(CREDS)).toEqual({
      grant_type: "client_credentials",
      username: "ing_Xx",
      access_key: "SECRET",
      scope: "oauth_user_profile ai_agent_notify",
      expires_in: "3600",
    });
    // Exact string, both members, in order: `ai_agent_notify` is what Atlas matches on, and
    // `oauth_user_profile` is what makes the pair obtainable through this flow at all.
    expect(CENTRAL_SCOPE).toBe("oauth_user_profile ai_agent_notify");
    expect(CENTRAL_SCOPE.split(" ")).toEqual(["oauth_user_profile", "ai_agent_notify"]);
  });

  it("never falls back to another scope, on any path", async () => {
    // A silent downgrade to a different authorization is the kind of thing nobody notices
    // until it matters. Every refusal shape must fail, once, with the scope we chose.
    for (const response of [
      { status: 400, body: { error: "invalid_scope" } },
      { status: 401, body: { error: "invalid_client" } },
      { status: 403, body: { error: "unauthorized_client" } },
      { status: 500, body: null },
    ]) {
      resetTokenCache();
      const { seen, transport } = recording(response);
      await mintCentralToken(URL_, CREDS, transport, 0).catch(() => undefined);
      expect(seen).toHaveLength(1);
      expect(seen[0].form.scope).toBe("oauth_user_profile ai_agent_notify");
    }
    // and nothing anywhere in the module names the scope it replaced
    expect(JSON.stringify([AUTH_SCOPE_REFUSED_DETAIL(400), AUTH_REJECTED_DETAIL(401)]))
      .not.toContain("central_ai_s2s");
  });

  it("returns the token the endpoint issued", async () => {
    const { seen, transport } = recording();
    expect(await mintCentralToken(URL_, CREDS, transport, 0)).toBe("jwt.aaa");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(URL_);
  });

  it("does not re-mint inside the cache window", async () => {
    const { seen, transport } = recording();
    await mintCentralToken(URL_, CREDS, transport, 0);
    await mintCentralToken(URL_, CREDS, transport, 60_000);
    await mintCentralToken(URL_, CREDS, transport, 1_000_000);
    expect(seen).toHaveLength(1);
  });

  it("refreshes once the token is inside the skew", async () => {
    const { seen, transport } = recording();
    await mintCentralToken(URL_, CREDS, transport, 0);
    // Expires at 3_600_000; the skew is the whole /agent budget plus a minute, because
    // Atlas holds this token for the life of the run and re-uses it for product egress.
    expect(REFRESH_SKEW_MS).toBe(390_000);
    await mintCentralToken(URL_, CREDS, transport, 3_600_000 - REFRESH_SKEW_MS + 1);
    expect(seen).toHaveLength(2);
  });

  it("mints ONCE for concurrent callers rather than once each", async () => {
    const { seen, transport } = recording();
    const answers = await Promise.all([
      mintCentralToken(URL_, CREDS, transport, 0),
      mintCentralToken(URL_, CREDS, transport, 0),
      mintCentralToken(URL_, CREDS, transport, 0),
    ]);
    expect(seen).toHaveLength(1);
    expect(answers).toEqual(["jwt.aaa", "jwt.aaa", "jwt.aaa"]);
  });

  it("mints again when the access key rotates, rather than serving a revoked one", async () => {
    const { seen, transport } = recording();
    await mintCentralToken(URL_, CREDS, transport, 0);
    await mintCentralToken(URL_, { ...CREDS, accessKey: "ROTATED" }, transport, 0);
    expect(seen).toHaveLength(2);
  });

  it("trusts the lifetime the SERVER granted, not the one we asked for", async () => {
    const { seen, transport } = recording({
      status: 200, body: { access_token: "jwt.aaa", expires_in: 600 },
    });
    await mintCentralToken(URL_, CREDS, transport, 0);
    // Granted 600s, so it is already inside the 390s skew at t=300s.
    await mintCentralToken(URL_, CREDS, transport, 300_000);
    expect(seen).toHaveLength(2);
  });

  it("reports a refused SCOPE as a provisioning problem, naming the scope", async () => {
    // The likely outcome: `ai_agent_notify` is documented as client_id/secret auth and is
    // not in USERNAME_ACCESS_KEY_ONLY_SCOPES. Sending someone to check their password would
    // be sending them to the wrong place entirely.
    const transport = async () => ({
      status: 400,
      body: {
        error: "invalid_scope",
        error_description: "scope ai_agent_notify only valid for: user_management, access_key SECRET",
      },
    });
    const message = await mintCentralToken(URL_, CREDS, transport, 0).catch((e) => e.message);
    expect(message).toContain("oauth_user_profile ai_agent_notify");
    expect(message).toMatch(/provisioning problem/);
    expect(message).toMatch(/YOUR CREDENTIALS ARE NOT THE PROBLEM/);
    expect(message).toMatch(/NOT quietly retry with a weaker scope/);
    expect(message).not.toMatch(/Check BROWSERSTACK_USERNAME/);
    // The body still never crosses, even while being read to classify.
    expect(message).not.toContain("SECRET");
    expect(message).not.toContain("error_description");
    expect(message).not.toContain("only valid for");
  });

  it("classifies a refusal by the OAuth2 code, falling back to the status", () => {
    // The `error` code is a fixed spec token and cannot carry a credential;
    // `error_description` is free text and can, so only the code is ever consulted.
    expect(refusalIsAboutScope(400, { error: "invalid_scope" })).toBe(true);
    expect(refusalIsAboutScope(403, { error: "unauthorized_client" })).toBe(true);
    expect(refusalIsAboutScope(400, { error: "invalid_request" })).toBe(true);
    expect(refusalIsAboutScope(401, { error: "invalid_client" })).toBe(false);
    expect(refusalIsAboutScope(400, { error: "invalid_grant" })).toBe(false);
    // No usable code: 400 is a bad request (for us, the scope), 401/403 a bad caller.
    expect(refusalIsAboutScope(400, null)).toBe(true);
    expect(refusalIsAboutScope(400, { error: 42 })).toBe(true);
    expect(refusalIsAboutScope(400, { error: "something_new" })).toBe(true);
    expect(refusalIsAboutScope(401, {})).toBe(false);
    expect(refusalIsAboutScope(500, { error: "server_error" })).toBe(false);
  });

  it("keeps a scope refusal and a credential refusal as two different problems", async () => {
    const scope = await mintCentralToken(
      URL_, CREDS, async () => ({ status: 400, body: { error: "invalid_scope" } }), 0,
    ).catch((e) => e.message);
    resetTokenCache();
    const credential = await mintCentralToken(
      URL_, CREDS, async () => ({ status: 401, body: { error: "invalid_client" } }), 0,
    ).catch((e) => e.message);
    expect(scope).not.toBe(credential);
    expect(scope).toMatch(/provisioning/);
    expect(credential).toMatch(/credentials were rejected/);
    expect(credential).not.toMatch(/provisioning/);
  });

  it("surfaces ONLY the status when the CREDENTIAL is refused, never the body", async () => {
    // The real endpoint's error body echoes the credential straight back.
    const transport = async () => ({
      status: 401,
      body: { error: "invalid_client", error_description: "access_key SECRET is invalid" },
    });
    await expect(mintCentralToken(URL_, CREDS, transport, 0)).rejects.toThrow(AskError);
    const message = await mintCentralToken(URL_, CREDS, transport, 0).catch((e) => e.message);
    expect(message).toMatch(/rejected by BrowserStack auth \(HTTP 401\)/);
    expect(message).not.toContain("SECRET");
    expect(message).not.toContain("invalid_client");
    expect(message).not.toContain("access_key");
  });

  it("says unreachable, distinctly from refused", async () => {
    const transport = async () => ({ status: 0, body: null, error: "auth could not be reached" });
    const message = await mintCentralToken(URL_, CREDS, transport, 0).catch((e) => e.message);
    expect(message).toBe(AUTH_UNREACHABLE_DETAIL);
    expect(message).not.toMatch(/rejected/);
  });

  it("says so when a 200 carries no access_token", async () => {
    const transport = async () => ({ status: 200, body: { token_type: "Bearer" } });
    const message = await mintCentralToken(URL_, CREDS, transport, 0).catch((e) => e.message);
    expect(message).toMatch(/without issuing a token/);
  });

  it("does not cache a failure", async () => {
    let calls = 0;
    const transport = async () => {
      calls += 1;
      return calls === 1 ? { status: 500, body: null } : OK;
    };
    await mintCentralToken(URL_, CREDS, transport, 0).catch(() => undefined);
    expect(await mintCentralToken(URL_, CREDS, transport, 0)).toBe("jwt.aaa");
    expect(calls).toBe(2);
  });

  it("refuses before any network call when a credential is missing", async () => {
    const { seen, transport } = recording();
    for (const creds of [
      { username: "", accessKey: "SECRET" },
      { username: "ing_Xx", accessKey: "" },
    ]) {
      const message = await mintCentralToken(URL_, creds, transport, 0).catch((e) => e.message);
      expect(message).toMatch(/BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY/);
      // Our missing configuration, not the user's password being wrong.
      expect(message).not.toMatch(/rejected/);
    }
    expect(seen).toHaveLength(0);
  });

  it("keeps the four auth failures readable as four different problems", () => {
    const scopeRefused = AUTH_SCOPE_REFUSED_DETAIL(400);
    const rejected = AUTH_REJECTED_DETAIL(401);
    const unreachable = AUTH_UNREACHABLE_DETAIL;
    const refusedByAtlas = UNAUTHENTICATED_DETAIL;
    const all = [scopeRefused, rejected, unreachable, refusedByAtlas];
    expect(new Set(all).size).toBe(4);
    // provisioning vs "your credentials are wrong" vs "auth is down" vs "server misconfigured"
    expect(scopeRefused).toMatch(/provisioning problem/);
    expect(rejected).toMatch(/credentials were rejected/);
    expect(unreachable).toMatch(/Could not reach BrowserStack auth/);
    expect(refusedByAtlas).toMatch(/SUCCEEDED/);
    // The two that are NOT the user's credentials say so in as many words.
    for (const message of [scopeRefused, refusedByAtlas]) {
      expect(message).toMatch(/YOUR CREDENTIALS ARE NOT THE PROBLEM/);
    }
    // None of them is a permission denial.
    for (const message of all) {
      expect(message).toMatch(/NOTHING REACHED THE AGENT|never reached the agent/);
    }
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
    // Nobody measured anything, so the field asserts nothing.
    expect(result.applied_before_stop).toBeNull();
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

describe("a result body outranks the HTTP status (N1)", () => {
  // Atlas answers 502 with a COMPLETE result when a delegation ran and a step failed, and
  // 429 carries a full body too. The status describes the OUTCOME; the body describes
  // whether there was a RUN, and only the second question decides `not_reached`.
  const RAN = {
    ok: false,
    status: "error",
    answer: "The folder was not created.",
    approvals: [
      {
        description: 'Creating the "Regression" folder.',
        decision: "allow",
        reason: "",
        applied: false,
      },
    ],
    applied_before_stop: false,
    permission_relay: { used: true, reason: "" },
  };

  it.each([[502], [429], [500], [503]])(
    "treats HTTP %i carrying a real result as a run that happened",
    (status) => {
      expect(neverReachedAgent({ status, body: RAN })).toBe(false);
    },
  );

  it("reports the approval that WAS shown, on the 502 that regressed", () => {
    const result = buildResult({ status: 502, body: RAN }, [], true);

    // The whole object, so `permission_relay` and `approvals` can never disagree again
    // without this failing.
    expect(result.permission_relay).toEqual({
      used: true,
      reason: "",
      detail: expect.stringContaining("asked before each change"),
    });
    expect(result.permission_relay.detail).not.toMatch(/NOTHING WAS ASKED/);
    expect(result.approvals).toEqual([
      {
        description: 'Creating the "Regression" folder.',
        decision: "allow",
        reason: "",
        applied: false,
        outcome: expect.stringContaining("APPROVED, BUT THE CHANGE DID NOT GO THROUGH"),
      },
    ]);
    expect(result.approvals_source).toBe("atlas");
    // Atlas's status and its own verdict, not one derived from the 502.
    expect(result.status).toBe("error");
    expect(result.applied_before_stop).toBe(false);
    // "refused before the agent started" would be false — the agent ran.
    expect(result.error).toBeUndefined();
  });

  it("keeps Atlas's own status on a 429 with a full body", () => {
    const result = buildResult(
      {
        status: 429,
        body: { ok: false, status: "rate_limited", answer: "", approvals: [], applied_before_stop: false },
      },
      [], true,
    );
    expect(result.status).toBe("rate_limited");
    expect(result.permission_relay.used).toBe(true);
    expect(result.permission_relay.reason).toBe("");
    expect(result.applied_before_stop).toBe(false);
  });

  it("still honours Atlas's `disabled` verdict on a result-carrying non-2xx", () => {
    const result = buildResult(
      {
        status: 502,
        body: { ok: false, status: "error", answer: "",
                permission_relay: { used: false, reason: "disabled" } },
      },
      [], true,
    );
    expect(result.permission_relay.reason).toBe("disabled");
    expect(result.permission_relay.detail).toMatch(/NOBODY DECLINED THIS/);
  });

  it("lets Atlas's own error string speak on a 502 rather than talking over it", () => {
    const result = buildResult(
      { status: 502, body: { ok: false, status: "error", answer: "", error: "the folder API returned 500" } },
      [], true,
    );
    expect(result.error).toBe("the folder API returned 500");
  });

  it("still calls a bare {detail} refusal not_reached, whatever else changed", () => {
    for (const status of [400, 401, 403, 503]) {
      const result = buildResult({ status, body: { detail: "nope" } }, [], true);
      expect(neverReachedAgent({ status, body: { detail: "nope" } })).toBe(true);
      expect(result.permission_relay.used).toBe(false);
      expect(result.permission_relay.reason).toBe("not_reached");
      expect(result.applied_before_stop).toBeNull();
      expect(result.approvals).toEqual([]);
    }
  });

  it("still calls a transport failure not_reached", () => {
    const result = buildResult(
      { status: 0, body: null, error: "BrowserStack AI could not be reached" }, [], true,
    );
    expect(result.permission_relay.reason).toBe("not_reached");
    expect(result.applied_before_stop).toBeNull();
    expect(result.error).toBe("BrowserStack AI could not be reached");
  });

  it("recognises a result by any of the four keys, and nothing by none of them", () => {
    for (const key of ["ok", "status", "answer", "approvals"]) {
      expect(looksLikeDelegationResult({ [key]: null })).toBe(true);
    }
    expect(looksLikeDelegationResult({ detail: "x" })).toBe(false);
    expect(looksLikeDelegationResult({})).toBe(false);
    expect(looksLikeDelegationResult(null)).toBe(false);
    expect(looksLikeDelegationResult("a string")).toBe(false);
    // A result that also carries a detail field is still a result.
    expect(looksLikeDelegationResult({ ok: true, detail: "fyi" })).toBe(true);
  });
});

describe("a 2xx carrying no delegation result is internally consistent (N4)", () => {
  it("does not report success alongside an error", () => {
    const result = buildResult({ status: 200, body: { detail: "nope" } }, [], true);
    // It used to say ok: true AND carry an error — a shape real Atlas never emits, but one
    // that contradicted itself.
    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.error).toBe(
      'BrowserStack AI answered HTTP 200 with no delegation result: "nope".',
    );
    expect(result.permission_relay.reason).toBe("not_reached");
    expect(result.applied_before_stop).toBeNull();
  });

  it("says the same about a 2xx with an empty or unparseable body", () => {
    for (const body of [{}, null, "not json"]) {
      const result = buildResult({ status: 200, body }, [], true);
      expect(result.ok).toBe(false);
      expect(result.status).toBe("error");
      expect(result.error).toBe("BrowserStack AI answered HTTP 200 with no delegation result.");
    }
  });
});
