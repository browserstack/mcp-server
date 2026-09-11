import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
const CONFIG = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as any;

describe("searchCapability is a shortlist, describeCapability is the contract", () => {
  beforeEach(() => {
    process.env.CAPABILITY_REGISTRY_INDEX = FIXTURE;
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm.example";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
  });

  async function tools() {
    const { BrowserStackMcpServer } =
      await import("../../src/server-factory.js");
    return new BrowserStackMcpServer(CONFIG).getTools() as any;
  }
  const body = async (result: any) => JSON.parse(result.content[0].text);

  it("omits from search everything needed only for the one capability chosen", async () => {
    const t = await tools();
    const found = await body(
      await t.searchCapability.handler(
        { query: "create a test run" },
        {} as any,
      ),
    );
    for (const row of found.capabilities) {
      // The 86% that moved: parameters and response shapes.
      expect(row.path_params, row.name).toBeUndefined();
      expect(row.query, row.name).toBeUndefined();
      expect(row.body, row.name).toBeUndefined();
      expect(row.responses, row.name).toBeUndefined();
      expect(row.returns, row.name).toBeUndefined();
    }
  });

  it("keeps in search exactly what choosing requires", async () => {
    const t = await tools();
    const found = await body(
      await t.searchCapability.handler(
        { query: "create a test run" },
        {} as any,
      ),
    );
    const top = found.capabilities[0];
    expect(top.name).toBe("create_test_run_v1");
    expect(top.mode).toBe("write");
    expect(top.intent).toBeTruthy();
    // `product` rides on every row because results span products, and a caller cannot
    // otherwise tell a Load Testing row from a Test Management one.
    expect(top.product).toBe("tm");
    // `method`/`path` stay because some products publish no names at all; without them
    // those rows would be unaddressable, which is worse than verbose.
    expect(top.method).toBe("POST");
    expect(top.path).toContain("/test-runs");
    // guidance is what tells the caller which of two plausible rows is the right one.
    expect(Array.isArray(top.guidance)).toBe(true);
  });

  it("returns the full contract for the capability picked", async () => {
    const t = await tools();
    const described = await body(
      await t.describeCapability.handler(
        { name: "create_test_run_v1" },
        {} as any,
      ),
    );
    expect(described.name).toBe("create_test_run_v1");
    expect(described.product).toBe("tm");
    expect(described.path_params?.length).toBeGreaterThan(0);
    expect(described.body?.length).toBeGreaterThan(0);
    expect(Object.keys(described.responses)).toContain("200");
    // Nothing left for the caller to resolve.
    expect(JSON.stringify(described)).not.toContain('"$schema"');
    expect(JSON.stringify(described)).not.toContain('"$response"');
  });

  it("is cheaper end to end than the single fat call it replaces", async () => {
    const t = await tools();
    const search = await t.searchCapability.handler(
      { query: "create a test run" },
      {} as any,
    );
    const describe = await t.describeCapability.handler(
      { name: "create_test_run_v1" },
      {} as any,
    );
    const shortlist = search.content[0].text.length;
    const contract = describe.content[0].text.length;

    // The saving is the seven contracts never fetched. Even describing every result would
    // cost about what the fat search did — the break-even is past the page size.
    expect(shortlist + contract).toBeLessThan(shortlist + 8 * contract);
    expect(shortlist).toBeLessThan(contract * 3);
  });

  it("takes method and path for a capability with no name", async () => {
    const t = await tools();
    const described = await body(
      await t.describeCapability.handler(
        { method: "GET", path: "/api/v1/projects/basic" },
        {} as any,
      ),
    );
    expect(described.method).toBe("GET");
    expect(described.query?.length).toBeGreaterThan(0);
  });

  it("resolves by the same handles as invokeCapability, so a described name is callable", async () => {
    const t = await tools();
    const missing = await body(
      await t.describeCapability.handler({}, {} as any),
    );
    expect(missing.error).toMatch(/pass `name`/);

    const unknown = await body(
      await t.describeCapability.handler(
        { name: "no_such_capability" },
        {} as any,
      ),
    );
    expect(unknown.error).toMatch(/unknown_capability/);
  });

  it("expands the error shapes only when asked", async () => {
    const t = await tools();
    const dflt = await body(
      await t.describeCapability.handler(
        { name: "create_test_run_v1" },
        {} as any,
      ),
    );
    const all = await body(
      await t.describeCapability.handler(
        { name: "create_test_run_v1", include_responses: "all" },
        {} as any,
      ),
    );
    expect(Object.keys(dflt.responses)).toEqual(["200"]);
    expect(Object.keys(all.responses).length).toBeGreaterThan(1);
  });

  it("publishes the constraints a caller must obey before calling", async () => {
    // The whole point of describing before invoking: the limits arrive with the contract,
    // not from a rejected request.
    const t = await tools();
    const described = await body(
      await t.describeCapability.handler(
        { name: "bulk_delete_test_results_v1" },
        {} as any,
      ),
    );
    const constrained = [
      ...(described.body ?? []),
      ...(described.query ?? []),
    ].filter((p: any) => p.minItems !== undefined || p.maxItems !== undefined);
    expect(constrained.length).toBeGreaterThan(0);
  });
});
