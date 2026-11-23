import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../src/tools/testmanagement-utils/create-testrun",
  async (orig) => ({
    ...(await orig<object>()),
    createTestRun: vi.fn(async () => ({
      content: [{ type: "text", text: "created" }],
    })),
  }),
);
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

import addTestManagementTools from "../../src/tools/testmanagement.js";
import { createTestRun } from "../../src/tools/testmanagement-utils/create-testrun";

const config = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as never;

async function connect() {
  const server = new McpServer({ name: "t", version: "0" });
  addTestManagementTools(server, config);
  const client = new Client({ name: "c", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const tool = (await client.listTools()).tools.find(
    (t) => t.name === "createTestRun",
  )!;
  const run = (args: Record<string, unknown>) =>
    client.callTool({
      name: "createTestRun",
      arguments: { project_identifier: "PR-1", ...args },
    }) as Promise<any>;
  return { tool, run };
}

describe("createTestRun, with the test selection agent reachable", () => {
  beforeEach(() => vi.mocked(createTestRun).mockClear());

  it("reads as it always did, with a way to ask for an empty run", async () => {
    const { tool } = await connect();
    expect(tool.description).not.toContain("tmAIAgents");
    expect(tool.inputSchema.properties).toHaveProperty("allow_empty");
  });

  it("refuses a run with nothing named in it, and says which call to make", async () => {
    const { run } = await connect();
    const res = await run({ test_run: { name: "Smoke" } });
    expect(res.content[0].text).toMatch(/^No test run was created/);
    expect(res.content[0].text).toContain(
      "call tmAIAgents with agent 'create_test_run_from_requirement'",
    );
    expect(createTestRun).not.toHaveBeenCalled();
  });

  it("creates a run of named cases, or of folders", async () => {
    const { run } = await connect();
    await run({ test_run: { name: "A", test_cases: ["TC-1"] } });
    await run({ test_run: { name: "B", folder_ids: [7] } });
    expect(createTestRun).toHaveBeenCalledTimes(2);
  });

  it("creates an empty run when asked to, without passing the flag on", async () => {
    const { run } = await connect();
    await run({ test_run: { name: "Empty" }, allow_empty: true });
    expect(vi.mocked(createTestRun).mock.calls[0][0]).not.toHaveProperty(
      "allow_empty",
    );
  });
});

describe("createTestRun, with BrowserStack AI switched off", () => {
  beforeEach(() => {
    vi.mocked(createTestRun).mockClear();
    process.env.ASK_BROWSERSTACK_DISABLED = "true";
  });
  afterEach(() => {
    delete process.env.ASK_BROWSERSTACK_DISABLED;
  });

  it("reads and behaves as it always did", async () => {
    const { tool, run } = await connect();
    expect(tool.description).not.toContain("tmAIAgents");
    expect(tool.inputSchema.properties).not.toHaveProperty("allow_empty");
    await run({ test_run: { name: "Smoke" } });
    expect(createTestRun).toHaveBeenCalledTimes(1);
  });
});
