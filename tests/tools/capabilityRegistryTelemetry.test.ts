import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);

const CONFIG = {
  "browserstack-username": "ing_Xx",
  "browserstack-access-key": "SECRET",
} as any;

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({ status: 200, data: {} }) },
}));

/** Every telemetry row this test run produced, newest last. */
async function rows() {
  const { apiClient } = await import("../../src/lib/apiClient.js");
  return (apiClient.post as any).mock.calls.map(
    (c: any) => c[0].body.event_properties,
  );
}

async function rowsFor(tool: string) {
  return (await rows()).filter((r: any) => r.tool_name === tool);
}

async function buildServer() {
  const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
  return new BrowserStackMcpServer(CONFIG);
}

const call = (server: any, tool: string, args: unknown) =>
  server.getTools()[tool].handler(args, {});

describe("capability registry telemetry", () => {
  beforeEach(async () => {
    process.env.CAPABILITY_REGISTRY_INDEX = FIXTURE;
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm.example.com";
    delete process.env.CAPABILITY_REGISTRY_DISABLED;
    vi.resetModules();
    const { apiClient } = await import("../../src/lib/apiClient.js");
    (apiClient.post as any).mockClear();
  });

  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    vi.unstubAllGlobals();
  });

  it("records what was invoked and how the product answered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ success: true, test_cases: [] }),
      }),
    );
    const server = await buildServer();

    await call(server, "invokeCapability", {
      name: "list_archived_test_cases",
      product: "tm",
      path_params: { project_id: 1 },
    });

    const recorded = await rowsFor("invokeCapability");
    expect(recorded.length).toBeGreaterThanOrEqual(1);
    const last = recorded[recorded.length - 1];
    expect(last).toMatchObject({
      product: "tm",
      capability_method: expect.any(String),
      capability_path: expect.any(String),
      capability: "list_archived_test_cases",
      capability_mode: "read",
      upstream_ok: true,
      upstream_status: 200,
    });
    // success is the TOOL's verdict and is untouched by this change.
    expect(last.success).toBe(true);
  });

  it("writes exactly ONE row per completed invoke", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ success: true }),
      }),
    );
    const server = await buildServer();

    await call(server, "invokeCapability", {
      name: "list_archived_test_cases",
      product: "tm",
      path_params: { project_id: 1 },
    });

    const recorded = await rowsFor("invokeCapability");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      capability: "list_archived_test_cases",
      upstream_ok: true,
      upstream_status: 200,
    });
  });

  it("writes exactly ONE row when a call is refused before the network", async () => {
    const server = await buildServer();
    await call(server, "invokeCapability", { product: "tm" });
    expect(await rowsFor("invokeCapability")).toHaveLength(1);
  });

  it("keeps success true but marks upstream_ok false when the product rejects the call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ error: "not found" }),
      }),
    );
    const server = await buildServer();

    await call(server, "invokeCapability", {
      name: "list_archived_test_cases",
      product: "tm",
      path_params: { project_id: 1 },
    });

    const recorded = await rowsFor("invokeCapability");
    const last = recorded[recorded.length - 1];
    expect(last.success).toBe(true);
    expect(last.upstream_ok).toBe(false);
    expect(last.upstream_status).toBe(404);
  });

  it("records a refusal that never reached the network, with its reason", async () => {
    const server = await buildServer();
    const result = await call(server, "invokeCapability", {
      product: "tm",
    });

    expect(result.isError).toBe(true);
    const recorded = await rowsFor("invokeCapability");
    const refusal = recorded.find((r: any) => r.refusal_reason);
    expect(refusal).toBeDefined();
    expect(refusal.success).toBe(false);
    expect(refusal.refusal_reason).toBe("no_handle");
    expect(refusal.upstream_status).toBeUndefined();
  });

  it.each([
    [
      { name: "no_such_capability_at_all", product: "tm" },
      "unknown_capability",
    ],
    [
      { name: "list_archived_test_cases", product: "tm", path_params: {} },
      "missing_parameter",
    ],
    [
      {
        name: "list_archived_test_cases",
        product: "tm",
        path_params: { project_id: "not-a-number" },
      },
      "bad_parameter_type",
    ],
  ])("records the specific refusal reason (%#)", async (args, expected) => {
    const server = await buildServer();
    await call(server, "invokeCapability", args);
    const last = (await rowsFor("invokeCapability")).at(-1);
    expect(last.success).toBe(false);
    expect(last.refusal_reason).toBe(expected);
  });

  it("records search quality on every search", async () => {
    const server = await buildServer();
    await call(server, "searchCapability", {
      product: "tm",
      product_choice: "user_confirmed",
      query: "create a test case",
    });

    const recorded = await rowsFor("searchCapability");
    const last = recorded[recorded.length - 1];
    expect(last).toMatchObject({
      product: "tm",
      truncated: expect.any(Boolean),
      weak_match: expect.any(Boolean),
    });
    expect(last.results_returned).toBeGreaterThanOrEqual(0);
    expect(last.total_matched).toBeGreaterThanOrEqual(0);
    expect(last.search_query).toBe("create a test case");
  });

  it("redacts PII from the recorded search query", async () => {
    const server = await buildServer();
    await call(server, "searchCapability", {
      product: "tm",
      product_choice: "user_confirmed",
      query: "find cases assigned to priya.sharma@customer.co.uk",
    });

    const last = (await rowsFor("searchCapability")).at(-1);
    expect(last.search_query).toBe("find cases assigned to [email]");
  });

  it("does not put registry fields on other tools' rows", async () => {
    const server = await buildServer();
    await call(server, "listProducts", {});
    const last = (await rowsFor("listProducts")).at(-1);
    expect(last.capability).toBeUndefined();
    expect(last.upstream_status).toBeUndefined();
    expect(last.refusal_reason).toBeUndefined();
  });
});
