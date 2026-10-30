import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

// Every client loads every tool's description into the user's context at connect time,
// and listings cap the total (Kiro's: 30,000 characters). So a description may not grow:
// a tool keeps to 200 characters, or, if it was already longer, to the length it had.
// Guidance beyond that belongs in the argument descriptions or the answers.

vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const CEILING = 200;

/** The tools already over the ceiling, at their trimmed length. Lower only. */
const GRANDFATHERED: Record<string, number> = {
  askBrowserStackAI: 532,
  createProjectOrFolder: 217,
  describeCapability: 201,
  fetchSelfHealedSelectors: 226,
  getSubTestPlan: 394,
  getTestPlan: 422,
  invokeCapability: 454,
  listProducts: 252,
  listSubTestPlans: 396,
  listTestPlans: 325,
  prepareSelfHealingPlan: 261,
  searchCapability: 375,
  uploadProductRequirementFile: 306,
};

// Tool and parameter descriptions across every tool, in characters. Kiro renders the hosted
// subset of this text into one activation result capped at 30,000; at this total it is about
// 29,600. Lower only.
const TOTAL_CEILING = 21_500;

/** Each tool as a client lists it at connect time. */
async function listedTools() {
  const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
  const server = new BrowserStackMcpServer({
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  } as any);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "budget", version: "1" });
  await Promise.all([
    client.connect(clientSide),
    server.getInstance().connect(serverSide),
  ]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

/** Each tool's description length. */
async function descriptions(): Promise<[string, number][]> {
  return (await listedTools()).map((t) => [
    t.name,
    (t.description ?? "").length,
  ]);
}

const budget = (name: string) => Math.max(CEILING, GRANDFATHERED[name] ?? 0);

describe("tool descriptions", () => {
  it("measures every registered tool", async () => {
    expect((await descriptions()).length).toBeGreaterThan(30);
  });

  it("keeps every description within its budget", async () => {
    const over = (await descriptions())
      .filter(([name, length]) => length > budget(name))
      .map(([name, length]) => `${name}: ${length} > ${budget(name)}`);
    expect(over).toEqual([]);
  });

  it("keeps the total description text within its ceiling", async () => {
    const total = (await listedTools()).reduce((sum, t) => {
      const props = (t.inputSchema.properties ?? {}) as Record<
        string,
        { description?: string }
      >;
      const params = Object.values(props).reduce(
        (s, p) => s + (p.description ?? "").length,
        0,
      );
      return sum + (t.description ?? "").length + params;
    }, 0);
    expect(total).toBeLessThanOrEqual(TOTAL_CEILING);
  });
});
