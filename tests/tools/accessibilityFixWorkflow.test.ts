import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

// The accessibility fix workflow ships as a prompt only: the user starts it on purpose. There
// is no resource for it, no pointer in the instructions, and no link after issue results.

vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { BrowserStackMcpServer } from "../../src/server-factory.js";

/** A client connected to the whole server, as an MCP client sees it. */
async function connected() {
  const server = new BrowserStackMcpServer({
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  } as any);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fix-workflow", version: "1" });
  await Promise.all([
    client.connect(clientSide),
    server.getInstance().connect(serverSide),
  ]);
  return client;
}

describe("the fix workflow over MCP", () => {
  it("lists the prompt and fills in what the user asked for", async () => {
    const client = await connected();

    const { prompts } = await client.listPrompts();
    const prompt = prompts.find((p) => p.name === "fix-accessibility-issues");
    expect(prompt?.title).toBe("Fix accessibility issues");
    expect(prompt?.arguments?.map((a) => [a.name, a.required])).toEqual([
      ["target", false],
      ["scope", false],
    ]);

    const { messages } = await client.getPrompt({
      name: "fix-accessibility-issues",
      arguments: { target: "http://localhost:3000/cart", scope: "critical only" },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const text = (messages[0].content as { text: string }).text;
    expect(text).toMatch(/^You are fixing accessibility issues in this codebase/);
    expect(text).toContain("- **Target:** http://localhost:3000/cart\n- **Scope:** critical only");
    expect(text).toMatch(/If either is empty, settle it in Step 1\. Don't guess\./);
    expect(text).toMatch(/use the user's full words: some clients split arguments on spaces\.$/);
    await client.close();
  });

  it("advertises no resources: the workflow is a prompt only", async () => {
    const client = await connected();

    expect(client.getServerCapabilities()?.prompts).toBeDefined();
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    await client.close();
  });
});
