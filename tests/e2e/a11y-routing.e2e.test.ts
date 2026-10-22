import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BrowserStackMcpServer } from "../../src/server-factory";

// An agent asked to "check this for accessibility" has to know which product scans what
// before it picks a tool: a web page goes to Website Scanner (or Automate, for a flow), an
// app to its tests on App Automate. The server's instructions say so up front.

async function connect(): Promise<{ instructions: string; tools: string[] }> {
  const config: any = {
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  };
  const bs = new BrowserStackMcpServer(config);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "e2e", version: "1.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    client.connect(clientT),
    bs.getInstance().connect(serverT),
  ]);
  const instructions = client.getInstructions() ?? "";
  await client.close();
  return { instructions, tools: Object.keys(bs.getTools()) };
}

describe("e2e: accessibility routing in the server instructions", () => {
  it("sends a web page to Website Scanner, a web flow to Automate and an app to App Automate", async () => {
    const { instructions } = await connect();

    expect(instructions).toMatch(/web page[^;]*startAccessibilityScan/i);
    expect(instructions).toMatch(/flow[^;]*setupBrowserStackAutomateTests/i);
    expect(instructions).toMatch(
      /app[^;]*setupBrowserStackAppAutomateTests[^;]*runAppTestsOnBrowserStack/i,
    );
    expect(instructions).toMatch(/fetchAccessibilityIssues/);
  });

  it("names only tools the server registers", async () => {
    const { instructions, tools } = await connect();
    const routing = instructions
      .split("\n")
      .find((line) => line.includes("startAccessibilityScan"))!;

    const named = routing.match(/\b[a-z]+[A-Z]\w+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !tools.includes(name))).toEqual([]);
  });
});
