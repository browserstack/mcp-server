import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BrowserStackMcpServer } from "../../src/server-factory";

const NOTICE_MARKER = "Node version > 21.x.x";

// process.versions.node is read-only; override per-case then restore so both
// the below-22 and 22-or-newer paths run deterministically on any host Node.
const realNode = process.versions.node;
const setNode = (v: string) =>
  Object.defineProperty(process.versions, "node", {
    value: v,
    configurable: true,
  });

async function serverInstructions(): Promise<string | undefined> {
  const config: any = {
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  };
  const bs = new BrowserStackMcpServer(config); // sets instructions from faked node
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "e2e", version: "1.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    client.connect(clientT),
    bs.getInstance().connect(serverT),
  ]);
  const instructions = client.getInstructions();
  await client.close();
  return instructions;
}

describe("e2e: Node upgrade notice via server instructions (server prompt)", () => {
  afterEach(() => setNode(realNode));

  it("includes the notice in server instructions on simulated Node < 22", async () => {
    setNode("18.20.8");
    expect(await serverInstructions()).toContain(NOTICE_MARKER);
  });

  it("omits it (empty instructions) on simulated Node >= 22", async () => {
    setNode("22.18.0");
    const instructions = await serverInstructions();
    expect(instructions ?? "").not.toContain(NOTICE_MARKER);
  });
});
