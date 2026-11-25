import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

// The accessibility fix workflow ships as a prompt the user can start, and as the fixWorkflow
// argument of fetchAccessibilityIssues, for an agent the user simply asks to fix issues. One
// line in the server instructions points at the argument: Claude Code shows the agent a
// deferred tool's name only, but always shows the instructions. There is no resource for it.

vi.mock("../../src/lib/instrumentation.js", () => ({
  trackMCP: vi.fn(),
  withToolCall: (_tool: string, _client: unknown, _config: unknown, fn: () => unknown) => fn(),
}));
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
    expect(text).toMatch(/If either is empty, ask for it in Stage 1\./);
    expect(text).toMatch(/use the user's full words: some clients split arguments on spaces\.$/);
    await client.close();
  });

  it("sends general WCAG questions to askBrowserStackAI, not the deprecated accessibilityExpert", async () => {
    const client = await connected();

    const { messages } = await client.getPrompt({ name: "fix-accessibility-issues", arguments: {} });
    const text = (messages[0].content as { text: string }).text;
    expect(text).not.toContain("accessibilityExpert");
    expect(text).toContain(
      "For general WCAG or ARIA questions that are not about this report, also ask BrowserStack AI: call `askBrowserStackAI` with `product: \"a11y\"` and the question.",
    );
    await client.close();
  });

  it("points the agent at fixWorkflow from the server instructions, and not for advice", async () => {
    const client = await connected();

    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain(
      "Before editing code to fix accessibility issues, call fetchAccessibilityIssues with fixWorkflow: true.",
    );
    expect(instructions).toContain("Don't call it for questions or advice.");
    await client.close();
  });

  it("returns the workflow alone when fixWorkflow names no report", async () => {
    const client = await connected();

    const { tools } = await client.listTools();
    const fetch = tools.find((t) => t.name === "fetchAccessibilityIssues");
    expect(fetch?.inputSchema.properties).toHaveProperty("fixWorkflow");

    const result = await client.callTool({
      name: "fetchAccessibilityIssues",
      arguments: { fixWorkflow: true },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    expect(content[0].text).toMatch(/^You are fixing accessibility issues in this codebase/);
    expect(content[0].text).toMatch(
      /\*\*This run:\*\* take the target and the scope from the user's request\./,
    );
    // Not the prompt's ending: there are no slash-command arguments to echo back.
    expect(content[0].text).not.toContain("some clients split arguments on spaces");
    await client.close();
  });

  it("advertises no resources", async () => {
    const client = await connected();

    expect(client.getServerCapabilities()?.prompts).toBeDefined();
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    await client.close();
  });
});
