import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CALLBACK_PATH,
  CallbackListener,
  parseAsk,
  startCallbackListener,
} from "../../src/tools/ask-browserstack/callback.js";
import { AskError, atlasBaseUrl } from "../../src/tools/ask-browserstack/config.js";
import {
  appliedBeforeStop,
  buildResult,
  decide,
  deriveStatus,
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
