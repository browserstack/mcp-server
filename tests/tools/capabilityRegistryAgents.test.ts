import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  agentsOf,
  matchAgents,
} from "../../src/tools/capability-registry/agents.js";

/**
 * BrowserStack AI agents in the capability index.
 *
 * The shipped tm index, not the fixture: the agents block is the thing under test, and a
 * fixture copy of it would pass while the shipped one drifted.
 */
const SHIPPED = fileURLToPath(
  new URL("../../capability/tm.capability-index.json", import.meta.url),
);
const TM = JSON.parse(readFileSync(SHIPPED, "utf8")).tm;
const CONFIG = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as any;

const names = (query: string) =>
  matchAgents(TM, query).map((m) => m.agent.name);

describe("the shipped tm agents", () => {
  it("are well-formed, so none is silently dropped at load", () => {
    expect(agentsOf(TM).length).toBe(TM.agents.length);
    expect(TM.agents.map((a: any) => a.name).sort()).toEqual([
      "tm-dedupe",
      "tm-generate-test-cases",
      "tm-generate-test-data",
      "tm-maintain-test-cases",
    ]);
  });
});

describe("matchAgents", () => {
  it("hands requirement-driven generation to the generate or maintain agents", () => {
    for (const query of [
      "generate test cases from this PRD",
      "write test cases from the attached document",
      "create test cases for the login feature from the spec",
      "generate test cases from this Figma design",
      "update the test cases in this folder for the new requirement",
    ]) {
      const hit = names(query);
      expect(hit.length, query).toBeGreaterThan(0);
      expect(
        hit.every((n) =>
          ["tm-generate-test-cases", "tm-maintain-test-cases"].includes(n),
        ),
        query,
      ).toBe(true);
    }
  });

  it("hands duplicate checks to dedupe and dataset asks to test data", () => {
    expect(names("find duplicate test cases in the Checkout folder")[0]).toBe(
      "tm-dedupe",
    );
    expect(names("generate boundary values for the age input")[0]).toBe(
      "tm-generate-test-data",
    );
    expect(names("generate test data for this requirement")).toContain(
      "tm-generate-test-data",
    );
  });

  it("leaves single CRUD asks to the capabilities", () => {
    // The false positive that matters: one edit sent through a multi-minute agent run.
    for (const query of [
      "create a test case named Login",
      "update TC-12 priority to high",
      "list test cases in folder Checkout",
      "list datasets in this project",
      "generate a report for test run TR-4",
      "delete test case TC-9",
    ]) {
      expect(names(query), query).toEqual([]);
    }
  });

  it("returns nothing for a product without agents or a blank request", () => {
    expect(
      matchAgents(
        { summary: "", capabilities: [], entities: {} },
        "generate test cases from this PRD",
      ),
    ).toEqual([]);
    expect(matchAgents(TM, "")).toEqual([]);
  });

  it("drops malformed entries instead of failing", () => {
    const bundle = {
      ...TM,
      agents: [
        { name: "no-signals", description: "x", intents: ["a b"] },
        { name: 3, description: "x", signals: ["a"], intents: ["a"] },
        TM.agents[0],
      ],
    };
    expect(agentsOf(bundle).map((a) => a.name)).toEqual([TM.agents[0].name]);
  });
});

describe("the tools surface the handoff", () => {
  beforeEach(() => {
    process.env.CAPABILITY_REGISTRY_INDEX = SHIPPED;
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm.example";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    delete process.env.ASK_BROWSERSTACK_DISABLED;
  });

  async function tools() {
    const { BrowserStackMcpServer } =
      await import("../../src/server-factory.js");
    return new BrowserStackMcpServer(CONFIG).getTools() as any;
  }
  const body = (raw: any) => JSON.parse(raw.content[0].text);

  it("searchCapability leads with use_agent, and still returns the shortlist", async () => {
    const t = await tools();
    const out = body(
      await t.searchCapability.handler({
        query: "generate test cases from this PRD",
        product: "tm",
      }),
    );
    expect(Object.keys(out)[0]).toBe("use_agent");
    expect(out.use_agent.product).toBe("tm");
    expect(out.use_agent.next_step).toMatch(/askBrowserStackAI/);
    expect(out.use_agent.next_step).toMatch(/verbatim/);
    // An account without Ask AI must still be able to finish the task.
    expect(out.use_agent.next_step).toMatch(
      /not enabled on this account: then do the task with the capabilities/,
    );
    expect(out.capabilities.length).toBeGreaterThan(0);
  });

  it("searchCapability says nothing about agents for a plain CRUD ask", async () => {
    const t = await tools();
    const out = body(
      await t.searchCapability.handler({
        query: "create a test case named Login",
        product: "tm",
      }),
    );
    expect(out.use_agent).toBeUndefined();
  });

  it("listProducts lists the agents and flags a matching request", async () => {
    const t = await tools();
    const out = body(
      await t.listProducts.handler({
        query: "find duplicate test cases in my Checkout folder",
      }),
    );
    expect(out.agent_match.agents[0].name).toBe("tm-dedupe");
    const tm = out.products.find((p: any) => p.name === "tm");
    expect(tm.agents.map((a: any) => a.name)).toContain(
      "tm-generate-test-cases",
    );
    // Summaries only: the matching vocabulary is ours, not the caller's.
    expect(tm.agents[0].signals).toBeUndefined();
    expect(tm.agents[0].intents).toBeUndefined();
  });

  it("advertises no agent when askBrowserStackAI is switched off", async () => {
    process.env.ASK_BROWSERSTACK_DISABLED = "true";
    const t = await tools();
    expect(t.askBrowserStackAI).toBeUndefined();
    const search = body(
      await t.searchCapability.handler({
        query: "generate test cases from this PRD",
        product: "tm",
      }),
    );
    expect(search.use_agent).toBeUndefined();
    const list = body(
      await t.listProducts.handler({
        query: "generate test cases from this PRD",
      }),
    );
    expect(list.agent_match).toBeUndefined();
    expect(list.products[0].agents).toBeUndefined();
  });
});
