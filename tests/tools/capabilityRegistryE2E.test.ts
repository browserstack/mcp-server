import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("../fixtures/registry-index.json", import.meta.url));

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
    expect(payload.build_id).toMatch(/caps/);
    expect(payload.capabilities.length).toBeGreaterThan(0);
    expect(payload.capabilities[0].path.startsWith("/api/")).toBe(true);
  });

  it("invokes a real endpoint: forwards Api-Token, pages, and projects the rows", async () => {
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
    // the page-size ceiling the operation declares, not the product's default
    expect(calls[0].url).toContain("count=300");
    // projected to the declared returns: the extra field never reaches the caller
    expect(payload.items[0].leaked).toBeUndefined();
    expect(payload.items[0].id).toBe(1);
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
