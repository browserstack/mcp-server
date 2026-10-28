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

/** The tools already over the ceiling, at their length on main (2.2.6). Lower only. */
const GRANDFATHERED: Record<string, number> = {
  addTestResult: 293,
  askBrowserStackAI: 1006,
  createLCASteps: 340,
  createProjectOrFolder: 264,
  createTestCase: 283,
  createTestRun: 265,
  describeCapability: 753,
  describeEntity: 219,
  expandPercyVisualTesting: 266,
  fetchRCA: 236,
  fetchSelfHealedSelectors: 452,
  getFailureLogs: 242,
  getSubTestPlan: 649,
  getTestPlan: 807,
  invokeCapability: 852,
  listFolders: 437,
  listProducts: 856,
  listSubTestPlans: 655,
  listTestCases: 472,
  listTestPlans: 652,
  listTestRuns: 301,
  percyVisualTestIntegrationAgent: 342,
  prepareSelfHealingPlan: 806,
  runAppTestsOnBrowserStack: 297,
  searchCapability: 2019,
  setupBrowserStackAppAutomateTests: 268,
  setupBrowserStackAutomateTests: 328,
  updateTestCase: 501,
  updateTestRun: 272,
  uploadProductRequirementFile: 429,
};

/** Each tool's description as a client lists it at connect time. */
async function descriptions(): Promise<[string, number][]> {
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
  return tools.map((t) => [t.name, (t.description ?? "").length]);
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
});
