import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
/** The stored layout: `capability/<product>.capability-index.json`, one file per product. */
const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/capability/", import.meta.url));

const CONFIG = {
  "browserstack-username": "ing_Xx",
  "browserstack-access-key": "SECRET",
} as any;

async function buildServer() {
  // Imported lazily so the env below is in place before config.ts resolves the artifact.
  const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
  return new BrowserStackMcpServer(CONFIG);
}

describe("capability registry, end to end through the server factory", () => {
  beforeEach(() => {
    process.env.CAPABILITY_REGISTRY_INDEX = FIXTURE;
    delete process.env.CAPABILITY_REGISTRY_DISABLED;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_INDEX_DIR;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    vi.unstubAllGlobals();
  });

  it("registers its five tools alongside the hand-written ones", async () => {
    const server = await buildServer();
    const tools = server.getTools();
    for (const name of ["listProducts", "listEntities", "describeEntity",
      "searchCapability", "invokeEndpoint"]) {
      expect(tools[name], name).toBeDefined();
    }
    // the existing surface is untouched
    expect(tools.listTestCases ?? tools.createTestCase).toBeDefined();
  });

  it("loads the stored layout: capability/<product>.capability-index.json", async () => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    process.env.CAPABILITY_REGISTRY_INDEX_DIR = FIXTURE_DIR;
    const server = await buildServer();
    const result: any = await (server.getTools().listProducts as any).handler(
      {}, {} as any,
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.products.map((p: any) => p.name)).toEqual(["tm"]);
    // Provenance travels per product, because each product is its own file.
    expect(payload.products[0].build_id).toMatch(/^[0-9a-f]{7,}_/);
    expect(payload.products[0].version).toMatch(/^\d+\.\d+$/);
  });

  it("names the loaded products in the descriptions and the schema", async () => {
    const server = await buildServer();
    const tools: any = server.getTools();

    // The accepted values travel in the SCHEMA, so a client validates them and the model
    // sees them without spending a listProducts call.
    const shape = tools.listEntities.inputSchema?.shape ?? tools.listEntities._def?.shape;
    const entries = shape.product._def?.entries ?? shape.product._def?.values;
    expect(Object.values(entries)).toEqual(["tm"]);

    // listProducts is the routing tool, so it is the one that carries the summaries.
    expect(tools.listProducts.description).toContain("tm —");
    expect(tools.listProducts.description).toContain("Test Management");
    // Everywhere else, the names are enough; repeating unbounded authored prose across
    // five descriptions would cost more static context than the round trip it saves.
    expect(tools.searchCapability.description).toContain("loaded products: tm");
    expect(tools.searchCapability.description).not.toContain("SSO/OAuth");
  });

  it("registers nothing, and does not throw, when the artifact is missing", async () => {
    process.env.CAPABILITY_REGISTRY_INDEX = "/nonexistent/index.json";
    const server = await buildServer();
    // A packaging problem must not take every other product's tools down with it.
    expect(server.getTools().invokeEndpoint).toBeUndefined();
    expect(Object.keys(server.getTools()).length).toBeGreaterThan(5);
  });

  it("honours the kill switch", async () => {
    process.env.CAPABILITY_REGISTRY_DISABLED = "true";
    const server = await buildServer();
    expect(server.getTools().searchCapability).toBeUndefined();
  });

  it("searches the real index through the registered tool", async () => {
    const server = await buildServer();
    const result: any = await (server.getTools().searchCapability as any).handler(
      { query: "list the test cases in a folder" }, {} as any,
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.build_id).toMatch(/^[0-9a-f]{7,}_/);
    expect(payload.capabilities.length).toBeGreaterThan(0);
    expect(payload.capabilities[0].path.startsWith("/api/")).toBe(true);
  });

  it("hands back response shapes with nothing left to dereference", async () => {
    const server = await buildServer();
    const result: any = await (server.getTools().searchCapability as any).handler(
      { query: "create a folder in a project" }, {} as any,
    );
    const payload = JSON.parse(result.content[0].text);
    const top = payload.capabilities[0];

    // Which product owns it — needed to disambiguate, and to know whose tables were read.
    expect(top.product).toBe("tm");
    // The 2xx shape, expanded: no `{"$response": …}` or `{"$schema": …}` reaches the caller.
    expect(Object.keys(top.responses)).toContain("200");
    expect(JSON.stringify(payload)).not.toContain('"$schema"');
    expect(JSON.stringify(payload)).not.toContain('"$response"');
    expect(top.responses["200"].schema).toBeDefined();
  });

  it("returns the success shape by default and the error shapes only on request", async () => {
    const server = await buildServer();
    const search = server.getTools().searchCapability as any;
    const run = async (args: Record<string, unknown>) =>
      JSON.parse((await search.handler(
        { query: "create a folder in a project", ...args }, {} as any,
      )).content[0].text);

    const dflt = await run({});
    const all = await run({ include_responses: "all" });
    const none = await run({ include_responses: "none" });

    expect(Object.keys(dflt.capabilities[0].responses)).toEqual(["200"]);
    expect(Object.keys(all.capabilities[0].responses)).toContain("404");
    expect(none.capabilities[0].responses).toBeUndefined();

    // The error shapes are near-identical across endpoints, so carrying them by default
    // would multiply the payload several times over to repeat boilerplate.
    expect(JSON.stringify(all).length).toBeGreaterThan(JSON.stringify(dflt).length * 1.5);
    expect(JSON.stringify(none).length).toBeLessThan(JSON.stringify(dflt).length);
  });

  it("invokes a real endpoint: forwards Api-Token and returns the response untouched", async () => {
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm.example";
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push({ url: String(url), headers: init.headers });
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({
          projects: [{ id: 1, name: "P", description: "d", leaked: "no" }],
          info: { count: 1 },
        }),
      };
    });

    const server = await buildServer();
    const result: any = await (server.getTools().invokeEndpoint as any).handler(
      { method: "GET", path: "/api/v1/projects/basic" }, {} as any,
    );
    const payload = JSON.parse(result.content[0].text);

    expect(payload.ok).toBe(true);
    expect(calls[0].headers["Api-Token"]).toBe("ing_Xx:SECRET");
    expect(calls[0].headers["request-source"]).toBe("ai-chatbot");
    expect(calls[0].url.startsWith("https://tm.example/api/v1/projects/basic")).toBe(true);
    // ONE request, and the body exactly as the product sent it
    expect(calls).toHaveLength(1);
    expect(payload.http_response.status).toBe(200);
    expect(payload.http_response.body.projects[0])
      .toEqual({ id: 1, name: "P", description: "d", leaked: "no" });
  });

  it("refuses a destructive endpoint without calling the product", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const server = await buildServer();
    const result: any = await (server.getTools().invokeEndpoint as any).handler(
      {
        method: "POST",
        path: "/api/v1/projects/{project_id}/test-plans/{test_plan_id}/delete",
        path_params: { project_id: 1, test_plan_id: 2 },
        user_permission: "granted",
        change_summary: "delete it",
      },
      {} as any,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/destructive/);
    expect(fetchSpy).not.toHaveBeenCalled();     // refused before any egress
  });

  it("refuses a write until the user has confirmed, and validates params first", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const server = await buildServer();
    const invokeEndpoint = server.getTools().invokeEndpoint as any;

    const noConsent: any = await invokeEndpoint.handler(
      { method: "POST", path: "/api/v1/projects/{project_id}/folders",
        path_params: { project_id: 1 }, body: { name: "New" } }, {} as any,
    );
    expect(JSON.parse(noConsent.content[0].text).error).toMatch(/ask the user to confirm/);

    // A typo must surface as a parameter error, NOT as "go ask a human" about a call that
    // was never going to run.
    const typo: any = await invokeEndpoint.handler(
      { method: "POST", path: "/api/v1/projects/{project_id}/folders",
        path_params: { project_id: 1 }, body: { nmae: "New" } }, {} as any,
    );
    expect(JSON.parse(typo.content[0].text).error).toMatch(/unknown body: nmae/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
