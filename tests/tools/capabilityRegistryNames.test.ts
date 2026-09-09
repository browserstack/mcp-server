import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

import {
  CapabilityRegistry,
  IndexError,
  InvocationError,
} from "../../src/tools/capability-registry/index-loader.js";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
const CONFIG = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as any;

/** A two-product index, one of which publishes no names — loadtesting's situation today. */
function registryWith(products: Record<string, unknown>): CapabilityRegistry {
  return new CapabilityRegistry({
    schema_version: 1,
    build_id: "test",
    products,
  } as any);
}

const NAMED = {
  summary: "named product",
  capabilities: [
    {
      name: "list_projects_v1",
      method: "GET",
      path: "/api/v1/projects",
      mode: "read",
      entity: "project",
    },
    {
      name: "create_project_v1",
      method: "POST",
      path: "/api/v1/projects",
      mode: "write",
      entity: "project",
    },
  ],
};

const UNNAMED = {
  summary: "product that publishes no names",
  capabilities: [
    {
      method: "GET",
      path: "/api/v1/load-tests",
      mode: "read",
      entity: "load_test",
    },
  ],
};

describe("looking a capability up by its published name", () => {
  it("resolves the name to the right capability", () => {
    const r = registryWith({ tm: NAMED });
    const { product, capability } = r.byNameLookup("create_project_v1");
    expect(product).toBe("tm");
    // Two capabilities share the path and differ only by method, so a name that resolves to
    // the wrong one would still look plausible — assert the method.
    expect(capability.method).toBe("POST");
  });

  it("reports an unknown name as unknown_capability, not a generic failure", () => {
    const r = registryWith({ tm: NAMED });
    expect(() => r.byNameLookup("no_such_thing")).toThrow(InvocationError);
    expect(() => r.byNameLookup("no_such_thing")).toThrow(/unknown_capability/);
  });

  it("tells the caller when a product simply does not name its capabilities", () => {
    // Otherwise "unknown_capability" reads as "you got the name wrong" when the real answer
    // is "this product has no names — call it by method and path".
    const r = registryWith({ loadtesting: UNNAMED });
    expect(() => r.byNameLookup("list_load_tests")).toThrow(
      /loadtesting publishes no capability names yet/,
    );
  });

  it("refuses an ambiguous name rather than picking by load order", () => {
    const other = {
      summary: "another product",
      capabilities: [
        {
          name: "list_projects_v1",
          method: "GET",
          path: "/other/projects",
          mode: "read",
          entity: "project",
        },
      ],
    };
    const r = registryWith({ tm: NAMED, other });
    expect(() => r.byNameLookup("list_projects_v1")).toThrow(
      /exists in several products \(other, tm\); pass product/,
    );
    // ...and resolves once the caller says which one.
    expect(r.byNameLookup("list_projects_v1", "other").capability.path).toBe(
      "/other/projects",
    );
  });

  it("refuses to load an index whose names collide", () => {
    // A duplicate makes one capability permanently unreachable, and which one survives would
    // depend on array order. Loading and silently dropping an endpoint is the worse outcome.
    const clashing = {
      summary: "bad",
      capabilities: [
        { name: "dup", method: "GET", path: "/a", mode: "read", entity: "e" },
        { name: "dup", method: "POST", path: "/b", mode: "write", entity: "e" },
      ],
    };
    expect(() => registryWith({ tm: clashing })).toThrow(IndexError);
    expect(() => registryWith({ tm: clashing })).toThrow(
      /name 'dup' is used by both GET \/a and POST \/b/,
    );
  });

  it("still finds unnamed capabilities by endpoint", () => {
    const r = registryWith({ loadtesting: UNNAMED });
    expect(r.byEndpointLookup("GET", "/api/v1/load-tests").product).toBe(
      "loadtesting",
    );
  });
});

describe("entity key_facts — the entity-wide half of guidance", () => {
  // What a caller gets wrong is often true of the ENTITY, not one call, so the build
  // publishes the entity's key_facts and describeEntity hands them straight back. The
  // filtering happens at build time; this side must not drop or reshape them.
  const WITH_FACTS = {
    summary: "p",
    capabilities: [
      {
        name: "get_test_run_v1",
        method: "GET",
        path: "/api/v1/runs/{id}",
        mode: "read",
        entity: "test_run",
      },
    ],
    entities: {
      test_run: {
        entity: "test_run",
        title: "Test run",
        aliases: ["run"],
        key_facts: [
          "A run's id field is the display string — take uuid when carrying it into another call.",
        ],
        capabilities: ["get_test_run_v1"],
      },
      // An entity whose facts were ALL withheld at build time carries no key_facts at all.
      // Absent must read as "none passed the gate", never as an error.
      result: { entity: "result", title: "Result", capabilities: [] },
    },
  };

  it("carries key_facts through the loader onto the entity record", () => {
    const r = registryWith({ tm: WITH_FACTS });
    const doc = r.index.products.tm.entities.test_run;
    expect(doc.key_facts).toHaveLength(1);
    expect(doc.key_facts?.[0]).toContain("take uuid");
  });

  it("treats an entity with no key_facts as ordinary, not broken", () => {
    const r = registryWith({ tm: WITH_FACTS });
    expect(r.index.products.tm.entities.result.key_facts).toBeUndefined();
  });

  it("does not duplicate an entity-wide fact onto the capability", () => {
    // The whole reason key_facts exist as a separate field: saying it once on the entity
    // instead of on each of the ~20 capabilities that touch it. A capability picking the
    // fact up would reintroduce the duplication and dilute search scoring.
    const r = registryWith({ tm: WITH_FACTS });
    const capability = r.byNameLookup("get_test_run_v1").capability;
    expect(capability.guidance).toBeUndefined();
  });
});

describe("invokeCapability", () => {
  beforeEach(() => {
    process.env.CAPABILITY_REGISTRY_INDEX = FIXTURE;
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm.example";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    vi.unstubAllGlobals();
  });

  async function toolsWithFetch(calls: string[]) {
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ projects: [], info: { count: 0 } }),
      };
    });
    const { BrowserStackMcpServer } =
      await import("../../src/server-factory.js");
    return new BrowserStackMcpServer(CONFIG).getTools() as any;
  }

  it("is the registered tool name — invokeEndpoint is gone", async () => {
    const tools = await toolsWithFetch([]);
    expect(tools.invokeCapability).toBeDefined();
    expect(tools.invokeEndpoint).toBeUndefined();
  });

  it("invokes a read capability by name", async () => {
    const calls: string[] = [];
    const tools = await toolsWithFetch(calls);
    const result: any = await tools.invokeCapability.handler(
      { name: "get_projects_basic_v1" },
      {} as any,
    );
    expect(JSON.parse(result.content[0].text).ok).toBe(true);
    expect(calls[0]).toContain("/api/v1/projects/basic");
  });

  it("prefers the name when a stale path is sent alongside it", async () => {
    // The whole point of a handle: a route can move, and a caller holding the name should
    // still reach the operation rather than being told the path is unknown.
    const calls: string[] = [];
    const tools = await toolsWithFetch(calls);
    const result: any = await tools.invokeCapability.handler(
      {
        name: "get_projects_basic_v1",
        method: "GET",
        path: "/api/v1/moved-away",
      },
      {} as any,
    );
    expect(JSON.parse(result.content[0].text).ok).toBe(true);
    expect(calls[0]).toContain("/api/v1/projects/basic");
  });

  it("still accepts method and path, for products that publish no names", async () => {
    const calls: string[] = [];
    const tools = await toolsWithFetch(calls);
    const result: any = await tools.invokeCapability.handler(
      { method: "GET", path: "/api/v1/projects/basic" },
      {} as any,
    );
    expect(JSON.parse(result.content[0].text).ok).toBe(true);
    expect(calls[0]).toContain("/api/v1/projects/basic");
  });

  it("asks for a handle when given neither", async () => {
    const tools = await toolsWithFetch([]);
    const result: any = await tools.invokeCapability.handler({}, {} as any);
    expect(result.content[0].text).toMatch(/pass `name`/);
  });

  it("names the capability when refusing a destructive one", async () => {
    const tools = await toolsWithFetch([]);
    const { BrowserStackMcpServer } =
      await import("../../src/server-factory.js");
    const registry: any = new BrowserStackMcpServer(CONFIG);
    void registry;
    // Pick a real destructive capability out of the shipped fixture rather than hardcoding
    // one, so the test survives the next export.
    const index = JSON.parse(
      (await import("node:fs")).readFileSync(FIXTURE, "utf8"),
    );
    const product = index.products ? index.products.tm : index.tm;
    const destructive = product.capabilities.find(
      (c: any) => c.mode === "destructive" && c.name,
    );
    expect(destructive).toBeDefined();
    const result: any = await tools.invokeCapability.handler(
      { name: destructive.name },
      {} as any,
    );
    expect(result.content[0].text).toContain(destructive.name);
    expect(result.content[0].text).toMatch(/destructive/);
  });

  it("requires consent for a write, and records it, when called by name", async () => {
    const calls: string[] = [];
    const tools = await toolsWithFetch(calls);
    // Parameters are bound before consent is demanded, so these must be valid or the
    // capability fails validation instead of reaching the permission gate.
    const args = {
      name: "create_test_run_v1",
      path_params: { project_id: 1 },
      body: { run_state: "new_run", name: "R" },
    };
    const noConsent: any = await tools.invokeCapability.handler(
      args,
      {} as any,
    );
    expect(noConsent.content[0].text).toMatch(/permission|confirm|granted/i);
    expect(calls).toHaveLength(0);

    const granted: any = await tools.invokeCapability.handler(
      { ...args, user_permission: "granted", change_summary: "create a run" },
      {} as any,
    );
    expect(JSON.parse(granted.content[0].text).ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/v1/projects/1/test-runs");
  });
});
