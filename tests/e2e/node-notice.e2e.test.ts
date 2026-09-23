import { describe, it, expect, vi, afterEach } from "vitest";

// Keep the tool off the network so we exercise the response path, not the API.
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/lib/tm-base-url", () => ({
  getTMBaseURL: vi.fn().mockResolvedValue("https://tm.example.com"),
}));
vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, test_cases: [] } }),
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BrowserStackMcpServer } from "../../src/server-factory";

const NOTICE_MARKER = "Node version > 21.x.x";

// process.versions.node is read-only; override per-case then restore so both
// the wrapped (<22) and unchanged (>=22) registration paths run deterministically
// regardless of the host Node version.
const realNode = process.versions.node;
const setNode = (v: string) =>
  Object.defineProperty(process.versions, "node", {
    value: v,
    configurable: true,
  });

async function callListTestCases(): Promise<Array<{ text?: string }>> {
  const config: any = {
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  };
  const bs = new BrowserStackMcpServer(config); // applies wrapper based on faked node
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "e2e", version: "1.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    client.connect(clientT),
    bs.getInstance().connect(serverT),
  ]);
  const res: any = await client.callTool({
    name: "listTestCases",
    arguments: { project_identifier: "PR-1" },
  });
  await client.close();
  return res.content ?? [];
}

describe("e2e: Node upgrade notice on a real tools/call round-trip", () => {
  afterEach(() => setNode(realNode));

  it("appends the notice as the last block on simulated Node < 22", async () => {
    setNode("18.20.8");
    const blocks = await callListTestCases();
    const joined = blocks.map((c) => c.text ?? "").join("\n");
    expect(joined).toContain(NOTICE_MARKER);
    expect(blocks[blocks.length - 1].text).toContain(NOTICE_MARKER); // payload stays first
  });

  it("omits the notice on simulated Node >= 22", async () => {
    setNode("22.18.0");
    const blocks = await callListTestCases();
    const joined = blocks.map((c) => c.text ?? "").join("\n");
    expect(joined).not.toContain(NOTICE_MARKER);
  });
});
