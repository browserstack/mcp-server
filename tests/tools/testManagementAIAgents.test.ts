import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import {
  agentMention,
  indexedAgents,
  viaAgentTool,
} from "../../src/tools/ask-browserstack/agent-tools.js";
import { addAskBrowserStackAITool } from "../../src/tools/ask-browserstack/register.js";
import type { AskResult } from "../../src/tools/ask-browserstack/types.js";
import type { AgentDoc } from "../../src/tools/capability-registry/types.js";

const DEDUPE: AgentDoc = {
  name: "tm-dedupe",
  title: "Test deduplication",
  handle: "find_duplicate_test_cases",
  tagline: "find duplicate or overlapping test cases in a folder or a project",
  description: "Finds duplicate test cases.",
  signals: ["duplicate"],
  intents: ["find duplicate test cases"],
};
const SELECTION: AgentDoc = {
  name: "test-selection",
  title: "Test selection",
  description: "Picks the test cases to run. Writes none.",
  signals: ["select"],
  intents: ["select test cases"],
};
const PERM = "perm-" + "a".repeat(32);
const PARKED = {
  status: 200,
  body: {
    status: "needs_approval",
    run_id: "run-abc",
    asks: [
      {
        perm_id: PERM,
        product: "tm",
        mode: "ask-always",
        description: "Save the suggestions",
      },
    ],
  },
};

async function connect(
  agents: AgentDoc[] = [DEDUPE, SELECTION],
  reply: unknown = { status: 200, body: { status: "ok", answer: "done" } },
) {
  const server = new McpServer({ name: "t", version: "0" });
  const sent: any[] = [];
  const tools = addAskBrowserStackAITool(server, {
    agentUrl: () => "https://atlas.example.test/agent",
    mintToken: async () => "t",
    credentialsFor: () => ({ username: "", accessKey: "" }),
    deferredTransport: async (_url, _h, body) => {
      sent.push(body);
      return reply as never;
    },
    agentsFor: (product) => (product === "tm" ? agents : []),
  });
  const client = new Client({ name: "c", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name, arguments: args });
    if (res.isError && res.content.length === 1) return res;
    const [shown, internal] = res.content;
    const rest = internal
      ? JSON.parse(internal.text.split("\n").slice(1).join("\n"))
      : {};
    return { ...JSON.parse(shown.text), ...rest };
  };
  return { client, tools, call, sent };
}

describe("testManagementAIAgents", () => {
  it("lists every agent on `agent`, one line each, and keeps its own text short", async () => {
    const { client } = await connect();
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "testManagementAIAgents",
    )!;
    expect(tool.description!.length).toBeLessThanOrEqual(200);
    const agent = (tool.inputSchema.properties as any).agent;
    expect(agent.enum).toEqual(["find_duplicate_test_cases", "selection"]);
    expect(agent.description).toContain(
      "- find_duplicate_test_cases: find duplicate or overlapping test cases in a folder or a project",
    );
    // No handle or tagline authored: the handle comes from the name, and no line is added.
    expect(agent.description).toMatch(/\n- selection$/);
    expect(tool.inputSchema.required).toEqual(["agent"]);
    expect(tool.inputSchema.properties).not.toHaveProperty("product");
  });

  it("refuses a call that names no agent", async () => {
    const { call, sent } = await connect();
    const res = await call("testManagementAIAgents", {
      query: "find duplicates",
    });
    expect(res.isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it("starts the named agent as an @agent mention", async () => {
    const { call, sent } = await connect();
    await call("testManagementAIAgents", {
      agent: "find_duplicate_test_cases",
      query: "find duplicates in the Auth folder",
    });
    expect(sent[0]).toMatchObject({
      task: "@tm-dedupe find duplicates in the Auth folder",
      product: "tm",
      context: {
        mentions: [
          { type: "agent", id: "tm-dedupe", title: "Test deduplication" },
        ],
      },
      permission_relay: { mode: "deferred", contract: 3 },
    });
  });

  it("names the agent on a follow-up turn too", async () => {
    const { call, sent } = await connect();
    await call("testManagementAIAgents", {
      agent: "find_duplicate_test_cases",
      query: "now the Payments folder",
      conversation_id: "run-abc",
    });
    expect(sent[0]).toMatchObject({
      conversation_id: "run-abc",
      context: { mentions: [{ id: "tm-dedupe" }] },
    });
  });

  it("returns an approval that is answered through it, with the agent", async () => {
    const { call } = await connect(undefined, PARKED);
    const out = await call("testManagementAIAgents", {
      agent: "find_duplicate_test_cases",
      query: "find duplicates",
    });
    expect(out.status).toBe("needs_approval");
    expect(out.next_step.call).toBe("testManagementAIAgents");
    expect(out.next_step.instruction).toContain(
      "call testManagementAIAgents again",
    );
    expect(out.next_step.instruction).not.toContain("askBrowserStackAI");
    expect(out.next_step.params).toEqual({
      agent: "find_duplicate_test_cases",
      run_id: "run-abc",
      perm_id: PERM,
      decision: expect.any(String),
    });
  });

  it("leaves askBrowserStackAI as it was: no mention, its own next step", async () => {
    const { call, sent } = await connect(undefined, PARKED);
    const out = await call("askBrowserStackAI", {
      product: "tm",
      query: "find duplicates",
    });
    expect(sent[0].task).toBe("find duplicates");
    expect(sent[0]).not.toHaveProperty("context");
    expect(out.next_step.call).toBe("askBrowserStackAI");
    expect(out.next_step.params.product).toBe("tm");
  });

  it("is not registered for a product with no agents", async () => {
    const { tools } = await connect([]);
    expect(Object.keys(tools)).toEqual(["askBrowserStackAI"]);
  });

  it("is what askBrowserStackAI sends agent work to, and only when it exists", async () => {
    const describe = async (agents: AgentDoc[]) =>
      (await (await connect(agents)).client.listTools()).tools.find(
        (t) => t.name === "askBrowserStackAI",
      )!.description!;
    expect(await describe([DEDUPE])).toMatch(
      / To run a Test Management agent, use testManagementAIAgents\.$/,
    );
    expect(await describe([])).not.toContain("AIAgents");
  });

  it("says to use it, not askBrowserStackAI, within 200 characters", async () => {
    const { client } = await connect();
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "testManagementAIAgents",
    )!;
    expect(tool.description).toMatch(
      /^Use this tool to run a BrowserStack AI agent for Test Management, not askBrowserStackAI/,
    );
    expect(tool.description!.length).toBeLessThanOrEqual(200);
  });
});

describe("the agent mention", () => {
  it("does not tag a request twice", () => {
    expect(agentMention("@tm-dedupe find duplicates", DEDUPE).task).toBe(
      "@tm-dedupe find duplicates",
    );
  });

  it("carries no title when the agent has none", () => {
    const untitled = { ...DEDUPE, title: undefined };
    expect(agentMention("x", untitled).context).toEqual({
      mentions: [{ type: "agent", id: "tm-dedupe" }],
    });
  });
});

describe("a result through the agent tool", () => {
  const via = {
    tool: "testManagementAIAgents",
    agent: DEDUPE,
    handle: "find_duplicate_test_cases",
  };

  it("is returned as it came without a next step, or with another tool's", () => {
    const plain = { status: "ok" } as AskResult;
    expect(viaAgentTool(plain, via)).toBe(plain);
    const other = {
      status: "ok",
      next_step: { instruction: "x", call: "listTestCases", params: {} },
    } as unknown as AskResult;
    expect(viaAgentTool(other, via)).toBe(other);
  });
});

describe("the agents in the capability index", () => {
  it("are the five TM agents, under BrowserStack AI's names", () => {
    expect(indexedAgents("tm").map((a) => a.name)).toEqual([
      "tm-generate-test-cases",
      "tm-maintain-test-cases",
      "tm-generate-test-data",
      "tm-dedupe",
      "test-selection",
    ]);
  });

  it("are none when the index cannot be read", async () => {
    vi.resetModules();
    vi.doMock(
      "../../src/tools/capability-registry/config.js",
      async (orig) => ({
        ...(await orig<object>()),
        indexPaths: () => [],
      }),
    );
    const fresh =
      await import("../../src/tools/ask-browserstack/agent-tools.js");
    expect(fresh.indexedAgents("tm")).toEqual([]);
    vi.doUnmock("../../src/tools/capability-registry/config.js");
    vi.resetModules();
  });
});
