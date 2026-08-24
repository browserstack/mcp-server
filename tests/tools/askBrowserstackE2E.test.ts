import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskError } from "../../src/tools/ask-browserstack/config.js";
import { addAskBrowserstackAITool } from "../../src/tools/ask-browserstack/register.js";

/** Captured before anything stubs the global, so the loopback hop stays real. */
const realFetch = globalThis.fetch.bind(globalThis);

const CONFIG = {
  "browserstack-username": "ing_Xx",
  "browserstack-access-key": "SECRET",
} as any;

const PERM_A = "perm-" + "a".repeat(32);
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
}) {
  const calls: AtlasCall[] = [];
  const decisions: any[] = [];

  const stub = async (url: string, init: any) => {
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
  return { calls, decisions };
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
    process.env.ASK_BROWSERSTACK_ATLAS_TOKEN = "shared-delegation-token";
    delete process.env.ASK_BROWSERSTACK_DISABLED;
    delete process.env.ASK_BROWSERSTACK_ENV;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.ASK_BROWSERSTACK_ATLAS_URL;
    delete process.env.ASK_BROWSERSTACK_ATLAS_TOKEN;
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
        payload: () => ({ status: "ok", answer: "Created folder 12.", needs_approval: [] }),
      });

      const { payload } = await call(server.getTools());

      // 1. the request: authenticated with the SHARED DELEGATION TOKEN, attributed, relay
      //    offered on loopback with a per-run token
      expect(stub.calls[0].url).toBe("https://atlas.example/agent");
      expect(stub.calls[0].headers.Authorization).toBe("Bearer shared-delegation-token");
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
      expect(request.requestedSchema.properties.confirm.type).toBe("boolean");
      expect(request.requestedSchema.required).toEqual(["confirm"]);
      // The inner rung of the timeout ladder, shorter than Atlas's 300s gate.
      expect((elicit.mock.calls[0][1] as any).timeout).toBe(270_000);

      // 3. the answer on the wire, echoing Atlas's own id
      expect(stub.decisions[0])
        .toEqual({ status: 200, body: { perm_id: PERM_A, decision: "allow", reason: "" } });

      // 4. the result
      expect(payload.ok).toBe(true);
      expect(payload.answer).toBe("Created folder 12.");
      expect(payload.approvals)
        .toEqual([{ description: "Create folder \"Regression\".", decision: "allow", reason: "" }]);
      expect(payload.applied_before_stop).toBe(false);
      expect(payload.permission_relay.used).toBe(true);
    });

    it("denies when the human confirms false, and never asks a second time", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: false } },
      ]);
      const stub = atlas({
        asks: [{ perm_id: PERM_A, description: "Delete the sprint." }],
        payload: () => ({ status: "blocked", answer: "", needs_approval: ["Delete the sprint."] }),
      });

      const { payload } = await call(server.getTools());

      expect(stub.decisions[0].body)
        .toEqual({ perm_id: PERM_A, decision: "deny", reason: "declined" });
      expect(elicit).toHaveBeenCalledTimes(1);
      expect(payload.status).toBe("blocked");
      expect(payload.approvals[0].reason).toBe("declined");
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
        }),
      });

      const { payload } = await call(server.getTools());
      // The whole point of the field: a caller must not retry this task from scratch.
      expect(payload.applied_before_stop).toBe(true);
      expect(payload.approvals.map((a: any) => a.decision)).toEqual(["allow", "deny"]);
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
      expect(payload.applied_before_stop).toBe(false);
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
      expect(payload.applied_before_stop).toBe(false);
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
    it("omits user_id entirely, never as \"\", when no username is configured", async () => {
      const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
      const server = new BrowserStackMcpServer({
        "browserstack-username": "",
        "browserstack-access-key": "",
      } as any);
      fakeClient(server.getInstance(), { roots: {} }, []);
      const stub = atlas({});

      await call(server.getTools());
      expect("user_id" in stub.calls[0].body).toBe(false);
      expect(Object.keys(stub.calls[0].body).sort()).toEqual(["product", "task"]);
    });

    it("refuses by name when the token is unset, and never leaks it", async () => {
      delete process.env.ASK_BROWSERSTACK_ATLAS_TOKEN;
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, []);

      const { result, payload } = await call(server.getTools());
      expect(result.isError).toBe(true);
      expect(payload.error).toMatch(/ASK_BROWSERSTACK_ATLAS_TOKEN/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("never puts the token in the result, on success or on failure", async () => {
      const server = await buildServer();
      fakeClient(server.getInstance(), { elicitation: {} }, [
        { action: "accept", content: { confirm: true } },
      ]);
      atlas({ asks: [{ perm_id: PERM_A, description: "Create folder." }] });

      const { result } = await call(server.getTools());
      // The whole serialised result, not just the fields we happen to check.
      expect(result.content[0].text).not.toContain("shared-delegation-token");
    });

    it("reads a 401 as rejected credentials, not as anyone declining", async () => {
      const server = await buildServer();
      const elicit = fakeClient(server.getInstance(), { elicitation: {} }, []);
      vi.stubGlobal("fetch", async () => ({
        status: 401,
        headers: { get: () => "application/json" },
        // Exactly what Atlas answers a bad bearer with: no `error` string of its own.
        json: async () => ({ detail: "unauthorized" }),
      }));

      const { result, payload } = await call(server.getTools());

      expect(payload.status).toBe("error");
      expect(result.isError).toBe(true);
      expect(payload.error).toMatch(/rejected this server's credentials/);
      expect(payload.error).toMatch(/NOBODY DECLINED ANYTHING/);
      expect(payload.error).toMatch(/ASK_BROWSERSTACK_ATLAS_TOKEN/);
      // Nothing was ever asked, so nothing can look like a refusal.
      expect(elicit).not.toHaveBeenCalled();
      expect(payload.approvals).toEqual([]);
      expect(payload.applied_before_stop).toBe(false);
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
      vi.stubGlobal("fetch", async () => ({
        status,
        headers: { get: () => "application/json" },
        json: async () => ({ detail }),
      }));

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

    it("lets the named environment pick the token, so preprod cannot borrow prod's", async () => {
      delete process.env.ASK_BROWSERSTACK_ATLAS_TOKEN;
      process.env.ASK_BROWSERSTACK_ENV = "preprod";
      process.env.ASK_BROWSERSTACK_ATLAS_URL_PREPROD = "https://atlas-preprod.example";
      process.env.ASK_BROWSERSTACK_ATLAS_TOKEN_PREPROD = "preprod-token";
      delete process.env.ASK_BROWSERSTACK_ATLAS_URL;
      try {
        const server = await buildServer();
        fakeClient(server.getInstance(), { roots: {} }, []);
        const stub = atlas({});

        await call(server.getTools());
        expect(stub.calls[0].url).toBe("https://atlas-preprod.example/agent");
        expect(stub.calls[0].headers.Authorization).toBe("Bearer preprod-token");
      } finally {
        delete process.env.ASK_BROWSERSTACK_ENV;
        delete process.env.ASK_BROWSERSTACK_ATLAS_URL_PREPROD;
        delete process.env.ASK_BROWSERSTACK_ATLAS_TOKEN_PREPROD;
      }
    });
  });

  it("refuses by name when no host is configured, without calling anything", async () => {
    delete process.env.ASK_BROWSERSTACK_ATLAS_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const server = await buildServer();
    fakeClient(server.getInstance(), { elicitation: {} }, []);

    const { result, payload } = await call(server.getTools());
    expect(result.isError).toBe(true);
    expect(payload.error).toMatch(/ASK_BROWSERSTACK_ATLAS_URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("askBrowserstackAI, against the injected seam", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses rather than calling Atlas unauthenticated, and never names the token", async () => {
    const mcp = new McpServer({ name: "t", version: "0" });
    const transport = vi.fn();
    const tools = addAskBrowserstackAITool(mcp, {
      agentUrl: () => "https://atlas.example/agent",
      atlasToken: () => {
        throw new AskError(
          "BrowserStack AI is not authenticated: set ASK_BROWSERSTACK_ATLAS_TOKEN to the " +
            "shared delegation token",
        );
      },
      credentialsFor: () => ({ username: "u", accessKey: "k" }),
      transport: transport as never,
      startListener: (async () => ({ url: "x", token: "y", close: async () => {} })) as never,
    });

    const { payload } = await call(tools);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/ASK_BROWSERSTACK_ATLAS_TOKEN/);
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not need the user's access key to reach /agent", async () => {
    // It is not sent on this route, so its absence must not refuse the call the way the
    // product-API path would.
    const mcp = new McpServer({ name: "t", version: "0" });
    const transport = vi.fn(async () => ({ status: 200, body: { status: "ok", answer: "" } }));
    const tools = addAskBrowserstackAITool(mcp, {
      agentUrl: () => "https://atlas.example/agent",
      atlasToken: () => "shared-delegation-token",
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
      atlasToken: () => "shared-delegation-token",
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
