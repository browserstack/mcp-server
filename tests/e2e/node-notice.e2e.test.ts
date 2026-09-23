import { describe, it, expect, vi } from "vitest";

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

describe("e2e: Node upgrade notice rides on a real tools/call round-trip", () => {
  it("appends the notice below Node 22 and omits it on Node >= 22", async () => {
    const major = Number(process.versions.node.split(".")[0]) || 0;

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

    const res: any = await client.callTool({
      name: "listTestCases",
      arguments: { project_identifier: "PR-1" },
    });

    const blocks: any[] = res.content ?? [];
    const joined = blocks.map((c) => c.text ?? "").join("\n");

    if (major < 22) {
      expect(joined).toContain(NOTICE_MARKER);
      // payload stays first; the notice is appended last
      expect(blocks[blocks.length - 1].text).toContain(NOTICE_MARKER);
    } else {
      expect(joined).not.toContain(NOTICE_MARKER);
    }

    await client.close();
  });
});
