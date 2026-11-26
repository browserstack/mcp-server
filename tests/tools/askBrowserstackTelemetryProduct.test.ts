import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Every askBrowserStackAI row read as "no product" in BigQuery, so the AskAI failures
// could not be sliced by product the way capability calls are. The product is on the
// row from the first track call, before anything is sent.

const track = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: track }));
// register.ts reaches trackMCP through index.ts on some paths, which reads env on import.
vi.mock("../../src/index.js", () => ({ trackMCP: track }));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { addAskBrowserStackAITool } from "../../src/tools/ask-browserstack/register.js";
import { RUN_QUESTION_PREFIX } from "../../src/tools/ask-browserstack/workflows.js";

describe("askBrowserStackAI telemetry", () => {
  it("records the product the question is for", async () => {
    const mcp = new McpServer({ name: "t", version: "0" });
    const tools = addAskBrowserStackAITool(mcp, {
      agentUrl: () => "https://atlas.example/agent",
      mintToken: async () => "minted",
      credentialsFor: () => ({ username: "", accessKey: "" }),
    });
    // Refused before anything is sent: a question round with no answers.
    const result = await (tools.askBrowserStackAI as any).handler(
      {
        product: "testmanagement",
        query: "q",
        run_id: "run-1",
        perm_id: `${RUN_QUESTION_PREFIX}1`,
      },
      {},
    );
    expect(result.isError).toBe(true);
    const row = track.mock.calls.find((c) => c[0] === "askBrowserStackAI");
    expect(row?.[4]).toEqual({ product: "testmanagement" });
  });
});
