import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskError } from "../../src/tools/ask-browserstack/config.js";
import { resetTokenCache } from "../../src/tools/ask-browserstack/central-oauth.js";
import { addAskBrowserstackAITool } from "../../src/tools/ask-browserstack/register.js";

/** Captured before anything stubs the global, so the loopback hop stays real. */
const realFetch = globalThis.fetch.bind(globalThis);

const CONFIG = {
  "browserstack-username": "ing_Xx",
  "browserstack-access-key": "SECRET",
} as any;

const PERM_A = "perm-" + "a".repeat(32);
const AUTH_URL = "https://auth.example/oauth2/v2/token";
const MINTED = "minted.central.jwt";
const PERM_B = "perm-" + "b".repeat(32);

interface AtlasCall {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * Plays Atlas: receives POST /agent, then calls the MCP server back over REAL loopback
 * HTTP for each ask before answering. Every hop except Atlas's own logic is genuine.
 */
function atlas(options: {
  asks?: { perm_id: string; description: string }[];
  token?: (real: string) => string;
  payload?: (decisions: any[]) => unknown;
  throws?: boolean;
  authStatus?: number;
  authError?: string;
}) {
  const calls: AtlasCall[] = [];
  const decisions: any[] = [];
  const mints: Record<string, string>[] = [];

  const stub = async (url: string, init: any) => {
    if (String(url) === AUTH_URL) {
      mints.push(Object.fromEntries(new URLSearchParams(init.body)));
      return {
        status: options.authStatus ?? 200,
        headers: { get: () => "application/json" },
        json: async () => (options.authStatus && options.authStatus !== 200
          ? {
              error: options.authError ?? "invalid_client",
              error_description:
                "scope ai_agent_notify only valid for: user_management, access_key SECRET",
            }
          : { access_token: MINTED, expires_in: 3600, token_type: "Bearer" }),
      };
    }
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: init.headers, body });
    if (options.throws) throw new Error("connection reset");

    for (const ask of options.asks || []) {
      const relay = body.permission_relay;
      const response = await realFetch(relay.callback_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.token ? options.token(relay.token) : relay.token}`,
        },
        body: JSON.stringify({ ...ask, product: body.product, mode: "ask-always" }),
      });
      decisions.push({ status: response.status, body: await response.json() });
    }

    const payload = options.payload
      ? options.payload(decisions)
      : { status: "ok", answer: "done", needs_approval: [] };
    return {
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => payload,
    };
  };

  vi.stubGlobal("fetch", stub);
  return { calls, decisions, mints };
}

/**
 * A bare fetch stub that still signs in. Every path to `/agent` now mints first, so a stub
 * that only knows about `/agent` would have the mint land on it instead.
 */
function withAuth(agent: (url: string, init: any) => Promise<any>) {
  return async (url: string, init: any) => {
    if (String(url) === AUTH_URL) {
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ access_token: MINTED, expires_in: 3600 }),
      };
    }
    return agent(url, init);
  };
}

async function buildServer() {
  const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
  return new BrowserStackMcpServer(CONFIG);
}

/** Give the server a client that can (or cannot) be prompted, and script its answers. */
function fakeClient(
  mcp: McpServer,
  capabilities: Record<string, unknown> | undefined,
  answers: any[] = [],
) {
  vi.spyOn(mcp.server, "getClientCapabilities").mockReturnValue(capabilities as never);
  const elicit = vi.spyOn(mcp.server, "elicitInput");
  for (const answer of answers) {
    if (answer instanceof Error) elicit.mockRejectedValueOnce(answer);
    else elicit.mockResolvedValueOnce(answer);
  }
  return elicit;
}

async function call(tools: Record<string, any>, args = { product: "tm", query: "make a folder" }) {
  const result = await tools.askBrowserstackAI.handler(args, {} as any);
  return { result, payload: JSON.parse(result.content[0].text) };
}

describe("askBrowserstackAI, end to end through the server factory", () => {
  beforeEach(() => {
    process.env.ASK_BROWSERSTACK_ATLAS_URL = "https://atlas.example";
    process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL = AUTH_URL;
    resetTokenCache();
    delete process.env.ASK_BROWSERSTACK_DISABLED;
    delete process.env.ASK_BROWSERSTACK_ENV;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.ASK_BROWSERSTACK_ATLAS_URL;
    delete process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL;
    resetTokenCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers alongside the existing surface, and honours its kill switch", async () => {
    const server = await buildServer();
    expect(server.getTools().askBrowserstackAI).toBeDefined();
    expect(server.getTools().listTestCases ?? server.getTools().createTestCase).toBeDefined();

    process.env.ASK_BROWSERSTACK_DISABLED = "true";
    vi.resetModules();
    expect((await buildServer()).getTools().askBrowserstackAI).toBeUndefined();
  });

  describe("the client CAN elicit", () => {
    it("relays an ask, approves it, and forwards the caller's own credentials", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
      ]);
      const stub = atlas({
        asks: [{ perm_id: PERM_A, description: "Create folder \"Regression\"." }],
        payload: () => ({
          ok: true, status: "ok", answer: "Created folder 12.", steps: [],
          // Atlas's authoritative trail, with the `applied` bit only it can fill in.
          approvals: [
            { description: "Create folder \"Regression\".", decision: "allow", reason: "", applied: true },
          ],
          applied_before_stop: false,
          permission_relay: { used: true, reason: "" },
        }),
      });

      const { payload } = await call(server.getTools());

      // 1. the request: authenticated with the SHARED DELEGATION TOKEN, attributed, relay
      //    offered on loopback with a per-run token
      expect(stub.calls[0].url).toBe("https://atlas.example/agent");
      expect(stub.calls[0].headers.Authorization).toBe(`Bearer ${MINTED}`);
      // The EXACT key set. /agent has no Api-Token path, and that header carries the user's
      // access key — this assertion is what stops it creeping back in.
      expect(Object.keys(stub.calls[0].headers).sort())
        .toEqual(["Authorization", "Content-Type", "request-source"]);
      expect(stub.calls[0].body.task).toBe("make a folder");
      expect(stub.calls[0].body.product).toBe("tm");
      expect(stub.calls[0].body.user_id).toBe("ing_Xx");
      expect(stub.calls[0].body.permission_relay.callback_url)
        .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/atlas-permission$/);
      expect(stub.calls[0].body.permission_relay.token).toHaveLength(64);

      // 2. the prompt: framed with the product, Atlas's description verbatim, boolean confirm
      expect(elicit).toHaveBeenCalledTimes(1);
      const request = elicit.mock.calls[0][0] as any;
      expect(request.message).toBe(
        "BrowserStack AI (Test Management) needs your approval to continue:\n\n" +
          "Create folder \"Regression\".",
      );
      // NOTHING IS REQUESTED. A `confirm` boolean here made the approve button unable to
      // approve — the client rendered a form field and submitted its unset value, so an
      // approval came back as a refusal. The action is the whole answer now, and this
      // assertion is what stops the field creeping back.
      expect(request.requestedSchema).toEqual({ type: "object", properties: {} });
      expect(request.requestedSchema.required).toBeUndefined();
      expect(Object.keys(request.requestedSchema.properties)).toEqual([]);
      // The inner rung of the timeout ladder, shorter than Atlas's 300s gate.
      expect((elicit.mock.calls[0][1] as any).timeout).toBe(270_000);

      // 3. the answer on the wire, echoing Atlas's own id
      expect(stub.decisions[0])
        .toEqual({ status: 200, body: { perm_id: PERM_A, decision: "allow", reason: "" } });

      // 4. the result
      expect(payload.ok).toBe(true);
      expect(payload.answer).toBe("Created folder 12.");
      // Atlas's trail wins, carrying the applied bit; ours is kept beside it.
      expect(payload.approvals_source).toBe("atlas");
      expect(payload.approvals).toEqual([{
        description: "Create folder \"Regression\".", decision: "allow", reason: "",
        applied: true, outcome: "approved, and the change went through",
      }]);
      expect(payload.elicitations).toEqual([{
        description: "Create folder \"Regression\".", decision: "allow", reason: "",
        outcome: "approved; whether the change went through was not reported",
      }]);
      expect(payload.applied_before_stop).toBe(false);
      expect(payload.permission_relay.used).toBe(true);
    });

    it("APPROVES when the client accepts without sending a confirm field", async () => {
      // Exactly what a real client sends for a schema with no required fields, and the
      // shape the user hit on preprod when they pressed approve and were told they had
      // refused.
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept" },
      ]);
      const stub = atlas({
        asks: [{ perm_id: PERM_A, description: 'Creating the root folder "askrelay-smoke-1".' }],
        payload: () => ({
          ok: true, status: "ok", answer: "Created it.", steps: [],
          approvals: [{
            description: 'Creating the root folder "askrelay-smoke-1".',
            decision: "allow", reason: "", applied: true,
          }],
          applied_before_stop: false,
          permission_relay: { used: true, reason: "" },
        }),
      });

      const { payload } = await call(server.getTools());

      expect(elicit).toHaveBeenCalledTimes(1);
      // On the wire to Atlas: an allow, not a denial.
      expect(stub.decisions[0].body)
        .toEqual({ perm_id: PERM_A, decision: "allow", reason: "" });
      // And the two trails agree that it was approved.
      expect(payload.approvals[0]).toMatchObject({ decision: "allow", applied: true });
      expect(payload.elicitations[0]).toMatchObject({ decision: "allow", reason: "" });
      expect(payload.approvals[0].outcome).toBe("approved, and the change went through");
      expect(payload.status).toBe("ok");
    });

    it("logs the SHAPE of the answer, never the description or a credential", async () => {
      // The module's default export is a Proxy, so it is swapped wholesale rather than spied.
      const { setLogger } = await import("../../src/logger.js");
      const lines: string[] = [];
      const capture = (...args: unknown[]) => lines.push(args.map(String).join(" "));
      const previous = (await import("pino")).pino({ level: "silent" });
      setLogger({ info: capture, warn: capture, error: capture, debug: capture, flush: () => {} });

      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [{ action: "accept" }]);
      atlas({
        asks: [{ perm_id: PERM_A, description: 'Creating the root folder "askrelay-smoke-1".' }],
      });

      try {
        await call(server.getTools());
      } finally {
        setLogger(previous);
      }

      const answered = lines.filter((line) => line.includes("elicitation answered"));
      expect(answered).toHaveLength(1);   // once per ask, never per retry
      expect(answered[0]).toContain("action=accept");
      expect(answered[0]).toContain("content=absent");
      // The whole point: readable next time, and safe to leave switched on.
      const everything = lines.join("\n");
      expect(everything).not.toContain("askrelay-smoke-1");
      expect(everything).not.toContain("SECRET");
      expect(everything).not.toContain(MINTED);
    });

    it("denies when the human confirms false, and never asks a second time", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: false } },
      ]);
      const stub = atlas({
        asks: [{ perm_id: PERM_A, description: "Delete the sprint." }],
        payload: () => ({
          status: "blocked", answer: "", needs_approval: ["Delete the sprint."],
          approvals: [
            { description: "Delete the sprint.", decision: "deny", reason: "declined", applied: false },
          ],
          applied_before_stop: false,
        }),
      });

      const { payload } = await call(server.getTools());

      expect(stub.decisions[0].body)
        .toEqual({ perm_id: PERM_A, decision: "deny", reason: "declined" });
      expect(elicit).toHaveBeenCalledTimes(1);
      expect(payload.status).toBe("blocked");
      expect(payload.approvals[0].reason).toBe("declined");
      expect(payload.approvals[0].outcome).toBe("refused: a human said no");
      // Nothing had applied, so a retry of the whole task is safe.
      expect(payload.applied_before_stop).toBe(false);
    });

    it("denies a decline", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [{ action: "decline" }]);
      const stub = atlas({ asks: [{ perm_id: PERM_A, description: "Archive the plan." }] });

      const { payload } = await call(server.getTools());
      expect(stub.decisions[0].body)
        .toEqual({ perm_id: PERM_A, decision: "deny", reason: "declined" });
      expect(payload.approvals[0].decision).toBe("deny");
    });

    it("denies a cancel as 'nobody was there', not as a refusal, and does not retry", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, [{ action: "cancel" }]);
      const stub = atlas({ asks: [{ perm_id: PERM_A, description: "Archive the plan." }] });

      const { payload } = await call(server.getTools());

      // This is the security property: an unattended run cannot self-approve, and a second
      // prompt would only be an attempt to wear a human down.
      expect(stub.decisions[0].body)
        .toEqual({ perm_id: PERM_A, decision: "deny", reason: "cancelled" });
      expect(elicit).toHaveBeenCalledTimes(1);
      expect(payload.approvals[0].reason).toBe("cancelled");
    });

    it("denies on an elicitation timeout without killing the run", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [
        new McpError(ErrorCode.RequestTimeout, "timed out"),
      ]);
      const stub = atlas({ asks: [{ perm_id: PERM_A, description: "Archive the plan." }] });

      const { payload } = await call(server.getTools());
      expect(stub.decisions[0])
        .toEqual({ status: 200, body: { perm_id: PERM_A, decision: "deny", reason: "timeout" } });
      expect(payload.approvals[0].reason).toBe("timeout");
    });

    it("fails closed with a non-200 when the relay breaks in an unexpected way", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [new Error("client went away")]);
      const stub = atlas({ asks: [{ perm_id: PERM_A, description: "Archive the plan." }] });

      const { payload } = await call(server.getTools());
      // Atlas's fail-closed rule reads any non-200 as a deny.
      expect(stub.decisions[0].status).toBe(500);
      expect(payload.approvals[0]).toEqual({
        description: "Archive the plan.", decision: "deny", reason: "error",
        outcome: "refused: the approval channel broke before any answer arrived",
      });
    });

    it("ignores a callback that cannot present the run's token, and elicits nothing", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
      ]);
      const stub = atlas({
        asks: [{ perm_id: PERM_A, description: "Create folder." }],
        token: () => "a-stray-local-process",
      });

      await call(server.getTools());
      expect(stub.decisions[0].status).toBe(401);
      expect(elicit).not.toHaveBeenCalled();
    });

    it("says some steps applied before it stopped", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
        { action: "decline" },
      ]);
      atlas({
        asks: [
          { perm_id: PERM_A, description: "Create folder \"Regression\"." },
          { perm_id: PERM_B, description: "Move 40 test cases into it." },
        ],
        payload: () => ({
          status: "blocked", answer: "Created the folder; the move was refused.",
          needs_approval: ["Move 40 test cases into it."],
          approvals: [
            { description: "Create folder \"Regression\".", decision: "allow", reason: "", applied: true },
            { description: "Move 40 test cases into it.", decision: "deny", reason: "declined", applied: false },
          ],
          // Atlas's own verdict: it stopped on a refusal AND something had already changed.
          applied_before_stop: true,
        }),
      });

      const { payload } = await call(server.getTools());
      // The whole point of the field: a caller must not retry this task from scratch. It is
      // READ from Atlas, which is the only side that knows the folder creation landed.
      expect(payload.applied_before_stop).toBe(true);
      expect(payload.approvals_source).toBe("atlas");
      expect(payload.approvals.map((a: any) => a.decision)).toEqual(["allow", "deny"]);
      expect(payload.approvals.map((a: any) => a.applied)).toEqual([true, false]);
      expect(payload.approvals[0].outcome).toBe("approved, and the change went through");
      expect(payload.approvals[1].outcome).toBe("refused: a human said no");
      expect(payload.needs_approval).toEqual(["Move 40 test cases into it."]);
    });

    it("reports a server-side disabled relay as a configuration fact, not a refusal", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      // v1.1 §D: the block was supplied, `delegation.permission_relay` is "off", so Atlas
      // ignored it and ran read-only. Nobody was ever asked.
      const stub = atlas({
        payload: () => ({
          ok: true, status: "blocked", answer: "I could not create the folder.", steps: [],
          needs_approval: ["Create folder \"Regression\"."],
          permission_relay: { used: false, reason: "disabled" },
        }),
      });

      const { result, payload } = await call(server.getTools());

      expect(stub.calls[0].body.permission_relay).toBeDefined();   // we DID offer it
      expect(elicit).not.toHaveBeenCalled();                        // Atlas never called back
      expect(payload.permission_relay).toEqual({
        used: false,
        reason: "disabled",
        detail: expect.stringContaining("NOBODY DECLINED THIS"),
      });
      expect(payload.approvals).toEqual([]);
      // No gate ran, so Atlas omits the field and we must not invent a measured `false`.
      expect(payload.applied_before_stop).toBeNull();
      // A refusal is not a tool failure, and rendering it as one invites the retry loop
      // these distinct reasons exist to prevent.
      expect(result.isError).toBeUndefined();
    });

    it("treats an absent needs_approval as empty, end to end", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
      ]);
      atlas({
        asks: [{ perm_id: PERM_A, description: "Create folder." }],
        // Exactly what public() emits when nothing needed approval: the key is absent.
        payload: () => ({
          ok: true, status: "ok", answer: "Created folder 12.", steps: [],
          permission_relay: { used: true, reason: "" },
        }),
      });

      const { result, payload } = await call(server.getTools());
      expect(payload.needs_approval).toEqual([]);
      expect(payload.status).toBe("ok");
      expect(payload.permission_relay).toEqual({
        used: true, reason: "", detail: expect.stringContaining("asked before each change"),
      });
      expect(result.isError).toBeUndefined();
    });

    it("marks a genuine failure as an error but a refusal as a result", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [{ action: "decline" }]);
      atlas({
        asks: [{ perm_id: PERM_A, description: "Delete the sprint." }],
        payload: () => ({
          ok: true, status: "rate_limited", answer: "", error: "too many runs", steps: [],
        }),
      });

      const { result, payload } = await call(server.getTools());
      expect(payload.status).toBe("rate_limited");
      expect(payload.error).toBe("too many runs");
      expect(result.isError).toBe(true);
    });

    it("keeps the two trails apart when a probe is answered with no prompt (D4)", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      // A callback arriving with the wrong bearer: 401, zero prompts. Atlas sees the STEP
      // refused and records a denial; we saw nobody, and recorded nothing.
      const stub = atlas({
        asks: [{ perm_id: PERM_A, description: "Create folder." }],
        token: () => "a-stray-local-process",
        payload: () => ({
          status: "blocked", answer: "", needs_approval: ["Create folder."],
          approvals: [
            { description: "Create folder.", decision: "deny", reason: "error", applied: false },
          ],
          applied_before_stop: false,
          permission_relay: { used: true, reason: "" },
        }),
      });

      const { payload } = await call(server.getTools());

      expect(stub.decisions[0].status).toBe(401);
      expect(elicit).not.toHaveBeenCalled();
      // Atlas's is authoritative...
      expect(payload.approvals_source).toBe("atlas");
      expect(payload.approvals[0].decision).toBe("deny");
      // ...and ours is empty, which is the ONLY record that no prompt ever appeared. That
      // difference is what a probe of the loopback port looks like, so it must survive.
      expect(payload.elicitations).toEqual([]);
      expect(payload.applied_before_stop).toBe(false);
    });

    it("degrades cleanly when an older Atlas sends a trail with no applied bit", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
      ]);
      atlas({
        asks: [{ perm_id: PERM_A, description: "Create folder." }],
        payload: () => ({
          status: "ok", answer: "done",
          approvals: [{ description: "Create folder.", decision: "allow", reason: "" }],
          // and no applied_before_stop either
        }),
      });

      const { payload } = await call(server.getTools());
      expect("applied" in payload.approvals[0]).toBe(false);
      // Not rendered as a failure: nobody measured it.
      expect(payload.approvals[0].outcome).toBe(
        "approved; whether the change went through was not reported",
      );
      expect(payload.applied_before_stop).toBeNull();
    });

    it("does not claim nobody was asked when a 502 carries a real result (N1)", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
      ]);
      // Atlas answers 502 when a delegation RAN and a step then failed. One prompt was
      // shown and approved; the write did not land.
      const realFetchLocal = realFetch;
      vi.stubGlobal("fetch", withAuth(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        await realFetchLocal(body.permission_relay.callback_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${body.permission_relay.token}`,
          },
          body: JSON.stringify({
            perm_id: PERM_A, product: "tm", mode: "ask-always",
            description: 'Creating the "Regression" folder.',
          }),
        });
        return {
          status: 502,
          headers: { get: () => "application/json" },
          json: async () => ({
            ok: false, status: "error", answer: "The folder was not created.", steps: [],
            approvals: [{
              description: 'Creating the "Regression" folder.',
              decision: "allow", reason: "", applied: false,
            }],
            applied_before_stop: false,
            permission_relay: { used: true, reason: "" },
          }),
        };
      }));

      const { payload } = await call(server.getTools());

      // A prompt WAS shown and approved — the client recorded it.
      expect(elicit).toHaveBeenCalledTimes(1);
      expect(payload.elicitations[0].decision).toBe("allow");
      // ...so nothing in the payload may say otherwise.
      expect(payload.permission_relay).toEqual({
        used: true, reason: "",
        detail: expect.stringContaining("asked before each change"),
      });
      expect(payload.permission_relay.detail).not.toMatch(/NOTHING WAS ASKED/);
      expect(payload.approvals[0]).toMatchObject({
        decision: "allow", applied: false,
        outcome: expect.stringContaining("APPROVED, BUT THE CHANGE DID NOT GO THROUGH"),
      });
      expect(payload.approvals_source).toBe("atlas");
      expect(payload.status).toBe("error");
      expect(payload.applied_before_stop).toBe(false);
    });

    it("tears the listener down once the call ends, even when the call failed", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, []);
      const stub = atlas({ throws: true });

      const { payload } = await call(server.getTools());
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe("error");

      // The port must not survive the call that opened it.
      const url = stub.calls[0].body.permission_relay.callback_url;
      await expect(realFetch(url, { method: "POST", body: "{}" })).rejects.toThrow();
    });
  });

  describe("the client CANNOT elicit — the opencode/goose path", () => {
    it("omits permission_relay entirely and explains the read-only run", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { roots: {} }, []);
      const stub = atlas({
        payload: () => ({
          status: "blocked", answer: "I could not create the folder.",
          needs_approval: ["Create folder \"Regression\"."],
        }),
      });

      const { payload } = await call(server.getTools());

      // Absence is what selects Atlas's read-only HeadlessGate — not an empty object.
      expect("permission_relay" in stub.calls[0].body).toBe(false);
      expect(Object.keys(stub.calls[0].body).sort())
        .toEqual(["product", "task", "user_id"]);
      expect(elicit).not.toHaveBeenCalled();

      expect(payload.status).toBe("blocked");
      expect(payload.approvals).toEqual([]);
      expect(payload.approvals_source).toBe("mcp");
      expect(payload.applied_before_stop).toBeNull();
      expect(payload.needs_approval).toEqual(["Create folder \"Regression\"."]);
      expect(payload.permission_relay).toEqual({
        used: false,
        reason: "no_human",
        detail: expect.stringMatching(/does not support MCP elicitation/),
      });
    });

    it("does not depend on sampling, which Claude Code does not declare", async () => {
      const server = await buildServer();
      // Exactly what Claude Code sends: roots and elicitation, no sampling.
      fakeClient(server.getInstance(), { roots: { listChanged: true }, elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
      ]);
      const stub = atlas({ asks: [{ perm_id: PERM_A, description: "Create folder." }] });

      const { payload } = await call(server.getTools());
      expect(stub.calls[0].body.permission_relay).toBeDefined();
      expect(payload.approvals[0].decision).toBe("allow");
    });

    it("treats a client with no capabilities at all as unable to be asked", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), undefined, []);
      const stub = atlas({});

      const { payload } = await call(server.getTools());
      expect(stub.calls[0].body.permission_relay).toBeUndefined();
      expect(payload.permission_relay.reason).toBe("no_human");
    });
  });

  describe("POST /agent authentication — CONTRACT v1.2", () => {
    it("omits user_id entirely, never as \"\", when no username is available", async () => {
      // Driven through the seam: with central auth a blank username cannot sign in at all,
      // so this branch is no longer reachable from the factory — but the wire rule still
      // holds and must stay covered.
      const mcp = new McpServer({ name: "t", version: "0" });
      const transport = vi.fn(async () => ({ status: 200, body: { status: "ok", answer: "" } }));
      const tools = addAskBrowserstackAITool(mcp, {
        agentUrl: () => "https://atlas.example/agent",
        mintToken: async () => MINTED,
        credentialsFor: () => ({ username: "", accessKey: "" }),
        transport: transport as never,
      });

      await call(tools);
      const body = (transport.mock.calls[0] as any)[2];
      expect("user_id" in body).toBe(false);
      expect(Object.keys(body).sort()).toEqual(["product", "task"]);
    });

    it("signs in against the built-in staging endpoint when nothing is configured", async () => {
      // No refusal any more: the hosts ship with the tool, so an install needs no env var.
      delete process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL;
      delete process.env.ASK_BROWSERSTACK_ATLAS_URL;
      const seen: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        seen.push(String(url));
        return {
          status: 200,
          headers: { get: () => "application/json" },
          json: async () => (String(url).includes("oauth2")
            ? { access_token: MINTED, expires_in: 3600 }
            : { ok: true, status: "ok", answer: "" }),
        };
      });
      const server = await buildServer();
      fakeClient(server.getInstance(), { roots: {} }, []);

      const { payload } = await call(server.getTools());
      expect(payload.status).toBe("ok");
      expect(seen).toEqual([
        "https://auth-preprod.bsstag.com/oauth2/v2/token",
        "https://ai-platform-service.bsstag.com/agent",
      ]);
    });

    it("mints the token with the exact client_credentials grant", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, []);
      const stub = atlas({});

      await call(server.getTools());
      expect(stub.mints).toHaveLength(1);
      expect(stub.mints[0]).toEqual({
        grant_type: "client_credentials",
        username: "ing_Xx",
        access_key: "SECRET",
        // BOTH parts, exact string. `ai_agent_notify` is what Atlas matches on;
        // `oauth_user_profile` is what makes the pair obtainable through this flow.
        scope: "oauth_user_profile ai_agent_notify",
        expires_in: "3600",
      });
    });

    it("does not re-mint on a second call inside the cache window", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, []);
      const stub = atlas({});

      await call(server.getTools());
      await call(server.getTools());
      await call(server.getTools());
      expect(stub.calls).toHaveLength(3);   // three runs...
      expect(stub.mints).toHaveLength(1);   // ...one sign-in
    });

    it("never puts the access key or the minted token in the result", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
      ]);
      atlas({ asks: [{ perm_id: PERM_A, description: "Create folder." }] });

      const { result } = await call(server.getTools());
      // The whole serialised result, not just the fields we happen to check.
      expect(result.content[0].text).not.toContain("SECRET");
      expect(result.content[0].text).not.toContain(MINTED);
    });

    it("reports a refused scope as provisioning, not as a bad password", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      const stub = atlas({ authStatus: 400, authError: "invalid_scope" });

      const { result, payload } = await call(server.getTools());

      expect(payload.error).toContain("oauth_user_profile ai_agent_notify");
      expect(payload.error).toMatch(/provisioning problem/);
      expect(payload.error).not.toMatch(/Check BROWSERSTACK_USERNAME/);
      // Only one sign-in attempt, and no retry with a different scope.
      expect(stub.mints).toHaveLength(1);
      expect(stub.mints[0].scope).toBe("oauth_user_profile ai_agent_notify");
      // The body is read to classify but never surfaced.
      expect(result.content[0].text).not.toContain("SECRET");
      expect(result.content[0].text).not.toContain("only valid for");
      expect(stub.calls).toHaveLength(0);
      expect(elicit).not.toHaveBeenCalled();
      expect(payload.permission_relay.reason).toBe("not_reached");
      expect(payload.applied_before_stop).toBeNull();
    });

    it("says the credentials were rejected, and NEVER echoes the auth body back", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      // The endpoint's own error body echoes the access key straight back.
      const stub = atlas({ authStatus: 401 });

      const { result, payload } = await call(server.getTools());

      expect(payload.error).toMatch(/credentials were rejected by BrowserStack auth \(HTTP 401\)/);
      expect(payload.error).toMatch(/BROWSERSTACK_ACCESS_KEY/);
      // Only the status crosses. Not the body, not the key it contained.
      expect(result.content[0].text).not.toContain("SECRET");
      expect(result.content[0].text).not.toContain("invalid_client");
      // Never got as far as Atlas, let alone a prompt.
      expect(stub.calls).toHaveLength(0);
      expect(elicit).not.toHaveBeenCalled();
      expect(payload.permission_relay.reason).toBe("not_reached");
      expect(payload.applied_before_stop).toBeNull();
    });

    it("says auth was unreachable, distinctly from a rejected credential", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      vi.stubGlobal("fetch", async () => {
        throw new Error("ECONNREFUSED");
      });

      const { payload } = await call(server.getTools());
      expect(payload.error).toMatch(/Could not reach BrowserStack auth/);
      expect(payload.error).not.toMatch(/credentials were rejected/);
      expect(elicit).not.toHaveBeenCalled();
      expect(payload.permission_relay.reason).toBe("not_reached");
    });

    it("refuses before any network call when a credential is missing", async () => {
      const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
      const server = new BrowserStackMcpServer({
        "browserstack-username": "ing_Xx",
        "browserstack-access-key": "",
      } as any);
      fakeClient(server.getInstance(), { elicitation: {} }, []);
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const { payload } = await call(server.getTools());
      expect(payload.error).toMatch(/BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY/);
      // Our missing configuration, not the user's password being wrong.
      expect(payload.error).not.toMatch(/rejected/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reads a 401 as rejected credentials, not as anyone declining", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      vi.stubGlobal("fetch", withAuth(async () => ({
        status: 401,
        headers: { get: () => "application/json" },
        // Exactly what Atlas answers a bad bearer with: no `error` string of its own.
        json: async () => ({ detail: "unauthorized" }),
      })));

      const { result, payload } = await call(server.getTools());

      expect(payload.status).toBe("error");
      expect(result.isError).toBe(true);
      // The THIRD failure mode: we signed in fine, Atlas refused the token. It must not
      // read as "your password is wrong" — it is a server misconfiguration.
      expect(payload.error).toMatch(/Signing in with your BrowserStack credentials SUCCEEDED/);
      expect(payload.error).toMatch(/YOUR CREDENTIALS ARE NOT THE PROBLEM/);
      expect(payload.error).toMatch(/delegation\.required_scope/);
      expect(payload.error).toMatch(/NOBODY DECLINED ANYTHING/);
      // Nothing was ever asked, so nothing can look like a refusal.
      expect(elicit).not.toHaveBeenCalled();
      expect(payload.approvals).toEqual([]);
      expect(payload.applied_before_stop).toBeNull();
      // ...and the relay verdict must agree with `error` rather than contradict it.
      expect(payload.permission_relay).toEqual({
        used: false,
        reason: "not_reached",
        detail: expect.stringContaining("NOTHING WAS ASKED AND NOTHING WAS REFUSED"),
      });
    });

    it("does not claim the channel was used when Atlas is unreachable", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      const stub = atlas({ throws: true });

      const { payload } = await call(server.getTools());

      // We offered the channel and it was never exercised — zero prompts appeared.
      expect(stub.calls[0].body.permission_relay).toBeDefined();
      expect(elicit).not.toHaveBeenCalled();
      expect(payload.status).toBe("error");
      expect(payload.error).toMatch(/could not be reached/);
      expect(payload.permission_relay.used).toBe(false);
      expect(payload.permission_relay.reason).toBe("not_reached");
      expect(payload.approvals).toEqual([]);
    });

    it.each([
      [400, "task is required"],
      [503, "delegation is not enabled"],
    ])("reads a %i pre-run refusal as nothing-asked, and says why", async (status, detail) => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      // Exactly what Atlas answers with before the delegation layer: a bare detail.
      vi.stubGlobal("fetch", withAuth(async () => ({
        status,
        headers: { get: () => "application/json" },
        json: async () => ({ detail }),
      })));

      const { result, payload } = await call(server.getTools());

      expect(payload.status).toBe("error");
      expect(result.isError).toBe(true);
      expect(payload.error).toContain(`HTTP ${status}`);
      expect(payload.error).toContain(detail);
      expect(payload.permission_relay.reason).toBe("not_reached");
      expect(elicit).not.toHaveBeenCalled();
      expect(payload.approvals).toEqual([]);
    });

    it("keeps a 401 and a permission denial from reading alike", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [{ action: "decline" }]);
      atlas({
        asks: [{ perm_id: PERM_A, description: "Delete the sprint." }],
        payload: () => ({
          ok: true, status: "blocked", answer: "", steps: [],
          needs_approval: ["Delete the sprint."],
          permission_relay: { used: true, reason: "" },
        }),
      });

      const { result, payload } = await call(server.getTools());
      // A denial: not an error, and the trail says who said no.
      expect(payload.status).toBe("blocked");
      expect(result.isError).toBeUndefined();
      expect(payload.error).toBeUndefined();
      expect(payload.approvals[0]).toMatchObject({ decision: "deny", reason: "declined" });
    });

    it("an environment selector no longer changes anything", async () => {
      // The map and ASK_BROWSERSTACK_ENV are gone; a leftover selector must be inert rather
      // than quietly repointing the tool.
      process.env.ASK_BROWSERSTACK_ENV = "prod";
      process.env.ASK_BROWSERSTACK_ATLAS_URL_PROD = "https://should-be-ignored.example";
      try {
        const server = await buildServer();
        fakeClient(server.getInstance(), { roots: {} }, []);
        const stub = atlas({});

        await call(server.getTools());
        // Still the explicit override this suite sets, never the selector's host.
        expect(stub.calls[0].url).toBe("https://atlas.example/agent");
        expect(stub.calls[0].headers.Authorization).toBe(`Bearer ${MINTED}`);
      } finally {
        delete process.env.ASK_BROWSERSTACK_ENV;
        delete process.env.ASK_BROWSERSTACK_ATLAS_URL_PROD;
      }
    });
  });

  describe("REMOTE_MCP — the hosted deployment must not attempt the relay", () => {
    /**
     * `appConfig` reads `process.env.REMOTE_MCP` once at module load, so the whole graph is
     * re-imported with the env in place — the same trick `tests/lib/tm-base-url.test.ts` uses.
     */
    async function buildRemoteServer() {
      vi.resetModules();
      process.env.REMOTE_MCP = "true";
      const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
      return new BrowserStackMcpServer(CONFIG);
    }

    afterEach(() => {
      delete process.env.REMOTE_MCP;
      vi.resetModules();
    });

    it("never binds a listener, omits permission_relay, and says why", async () => {
      const server = await buildRemoteServer();
      // A client that CAN be prompted — this is the case where remote_mode has to beat
      // no_human, because switching clients would not help.
      const elicit = fakeClient(server.getInstance(), { roots: {}, elicitation: {} }, []);
      const stub = atlas({
        payload: () => ({
          ok: true, status: "blocked", answer: "I could not create the folder.", steps: [],
          needs_approval: ["Create folder \"Regression\"."],
        }),
      });

      const { result, payload } = await call(server.getTools());

      // 1. nothing was offered to Atlas
      expect("permission_relay" in stub.calls[0].body).toBe(false);
      expect(Object.keys(stub.calls[0].body).sort())
        .toEqual(["product", "task", "user_id"]);
      // 2. nothing was ever asked
      expect(elicit).not.toHaveBeenCalled();
      // 3. the result blames the deployment, not the human and not the client
      expect(payload.permission_relay).toEqual({
        used: false,
        reason: "remote_mode",
        detail: expect.stringContaining("hosted, multi-tenant mode"),
      });
      expect(payload.permission_relay.detail)
        .not.toMatch(/does not support MCP elicitation/);
      // 4. a read-only run is not a tool failure
      expect(result.isError).toBeUndefined();
      expect(payload.needs_approval).toEqual(["Create folder \"Regression\"."]);
    });

    it("binds no port at all — the listener is never even constructed", async () => {
      // Not "bound and left to fail on a callback that cannot arrive": never bound. In the
      // shared process that would be one ephemeral listener per concurrent tool call.
      //
      // Asserted through the injected seam rather than a module spy, so a negative result
      // means the code did not call it — not that the spy failed to attach. The positive
      // control below is what makes this assertion mean anything.
      vi.resetModules();
      process.env.REMOTE_MCP = "true";
      const { addAskBrowserstackAITool } = await import(
        "../../src/tools/ask-browserstack/register.js"
      );
      const { McpServer: RemoteMcpServer } = await import(
        "@modelcontextprotocol/sdk/server/mcp.js"
      );

      const startListener = vi.fn(async () => ({
        url: "http://127.0.0.1:1/atlas-permission", token: "t", close: async () => {},
      }));
      const transport = vi.fn(async () => ({ status: 200, body: { status: "ok", answer: "" } }));

      const remote = new RemoteMcpServer({ name: "t", version: "0" });
      vi.spyOn(remote.server, "getClientCapabilities")
        .mockReturnValue({ elicitation: {} } as never);
      const tools = addAskBrowserstackAITool(remote, {
        agentUrl: () => "https://atlas.example/agent",
        mintToken: async () => MINTED,
        credentialsFor: () => ({ username: "ing_Xx", accessKey: "SECRET" }),
        transport: transport as never,
        startListener: startListener as never,
      });

      const { payload } = await call(tools);
      expect(startListener).not.toHaveBeenCalled();
      expect("permission_relay" in (transport.mock.calls[0] as any)[2]).toBe(false);
      expect(payload.permission_relay.reason).toBe("remote_mode");
    });

    it("positive control: the same seam IS called when not in remote mode", async () => {
      // Without this, the assertion above would pass just as happily if the seam were
      // broken and nothing ever called it.
      vi.resetModules();
      delete process.env.REMOTE_MCP;
      const { addAskBrowserstackAITool } = await import(
        "../../src/tools/ask-browserstack/register.js"
      );
      const { McpServer: StdioMcpServer } = await import(
        "@modelcontextprotocol/sdk/server/mcp.js"
      );

      const startListener = vi.fn(async () => ({
        url: "http://127.0.0.1:1/atlas-permission", token: "t", close: async () => {},
      }));
      const transport = vi.fn(async () => ({ status: 200, body: { status: "ok", answer: "" } }));

      const stdio = new StdioMcpServer({ name: "t", version: "0" });
      vi.spyOn(stdio.server, "getClientCapabilities")
        .mockReturnValue({ elicitation: {} } as never);
      const tools = addAskBrowserstackAITool(stdio, {
        agentUrl: () => "https://atlas.example/agent",
        mintToken: async () => MINTED,
        credentialsFor: () => ({ username: "ing_Xx", accessKey: "SECRET" }),
        transport: transport as never,
        startListener: startListener as never,
      });

      await call(tools);
      expect(startListener).toHaveBeenCalledTimes(1);
      expect((transport.mock.calls[0] as any)[2].permission_relay).toBeDefined();
    });

    it("stdio does not regress: the listener still binds and the block is still sent", async () => {
      // REMOTE_MCP unset — byte-identical to every other test in this file.
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept" },
      ]);
      const stub = atlas({ asks: [{ perm_id: PERM_A, description: "Create folder." }] });

      const { payload } = await call(server.getTools());
      expect(stub.calls[0].body.permission_relay.callback_url)
        .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/atlas-permission$/);
      expect(stub.calls[0].body.permission_relay.token).toHaveLength(64);
      expect(payload.permission_relay.used).toBe(true);
      expect(payload.permission_relay.reason).toBe("");
    });

    it("REMOTE_MCP=\"false\" is stdio, not remote", async () => {
      vi.resetModules();
      process.env.REMOTE_MCP = "false";
      const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
      const server = new BrowserStackMcpServer(CONFIG);
      fakeClient(server.getInstance(), { elicitation: {} }, [{ action: "accept" }]);
      const stub = atlas({ asks: [{ perm_id: PERM_A, description: "Create folder." }] });

      const { payload } = await call(server.getTools());
      expect(stub.calls[0].body.permission_relay).toBeDefined();
      expect(payload.permission_relay.used).toBe(true);
    });
  });

  it("falls back to the built-in staging host when no override is set", async () => {
    delete process.env.ASK_BROWSERSTACK_ATLAS_URL;
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(String(url));
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => (String(url).includes("oauth2")
          ? { access_token: MINTED, expires_in: 3600 }
          : { ok: true, status: "ok", answer: "" }),
      };
    });
    const server = await buildServer();
    fakeClient(server.getInstance(), { roots: {} }, []);

    const { result } = await call(server.getTools());
    expect(result.isError).toBeUndefined();
    // TEMPORARY-STAGING-DEFAULT: asserted literally so repointing must be deliberate.
    expect(seen).toContain("https://ai-platform-service.bsstag.com/agent");
  });
});

describe("askBrowserstackAI, against the injected seam", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses rather than calling Atlas unauthenticated, and never names the token", async () => {
    const mcp = new McpServer({ name: "t", version: "0" });
    const transport = vi.fn();
    const tools = addAskBrowserstackAITool(mcp, {
      agentUrl: () => "https://atlas.example/agent",
      mintToken: async () => {
        throw new AskError(
          "BrowserStack AI is not authenticated: BROWSERSTACK_USERNAME and " +
            "BROWSERSTACK_ACCESS_KEY are required to sign in",
        );
      },
      credentialsFor: () => ({ username: "u", accessKey: "k" }),
      transport: transport as never,
      startListener: (async () => ({ url: "x", token: "y", close: async () => {} })) as never,
    });

    const { payload } = await call(tools);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/BROWSERSTACK_ACCESS_KEY/);
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not need the user's access key to reach /agent", async () => {
    // It is not sent on this route, so its absence must not refuse the call the way the
    // product-API path would.
    const mcp = new McpServer({ name: "t", version: "0" });
    const transport = vi.fn(async () => ({ status: 200, body: { status: "ok", answer: "" } }));
    const tools = addAskBrowserstackAITool(mcp, {
      agentUrl: () => "https://atlas.example/agent",
      mintToken: async () => MINTED,
      credentialsFor: () => ({ username: "ing_Xx", accessKey: "" }),
      transport: transport as never,
      startListener: (async () => ({ url: "x", token: "y", close: async () => {} })) as never,
    });

    const { payload } = await call(tools);
    expect(payload.ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    expect((transport.mock.calls[0] as any)[2].user_id).toBe("ing_Xx");
  });

  it("closes the listener even when the transport throws", async () => {
    const mcp = new McpServer({ name: "t", version: "0" });
    vi.spyOn(mcp.server, "getClientCapabilities").mockReturnValue({ elicitation: {} } as never);
    const close = vi.fn(async () => {});
    const tools = addAskBrowserstackAITool(mcp, {
      agentUrl: () => "https://atlas.example/agent",
      mintToken: async () => MINTED,
      credentialsFor: () => ({ username: "u", accessKey: "k" }),
      transport: (async () => {
        throw new Error("boom");
      }) as never,
      startListener: (async () => ({
        url: "http://127.0.0.1:1/atlas-permission", token: "t", close,
      })) as never,
    });

    const { payload } = await call(tools);
    expect(payload.error).toBe("boom");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
