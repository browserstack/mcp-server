import { describe, expect, it } from "vitest";

import { bind, coerce } from "../../src/tools/capability-registry/bind.js";
import { authHeaders } from "../../src/tools/capability-registry/egress.js";
import {
  CapabilityRegistry, InvocationError, IndexError,
} from "../../src/tools/capability-registry/index-loader.js";
import { invoke } from "../../src/tools/capability-registry/resolve.js";
import { isCollection, searchCapabilities, terms } from "../../src/tools/capability-registry/search.js";
import { Capability, RegistryIndex } from "../../src/tools/capability-registry/types.js";

const LIST_CASES: Capability = {
  method: "GET", path: "/api/v1/projects/{project_id}/folder/{folder_id}/test-cases",
  mode: "read", entity: "test_case", paginated: true, max_items: 300,
  intent: "List the test cases in one folder",
  path_params: [
    { name: "project_id", type: "integer", required: true },
    { name: "folder_id", type: "integer", required: true },
  ],
  query: [{ name: "p", type: "integer" }, { name: "count", type: "integer" }],
  returns: ["id", "identifier", "title"],
};

const CREATE_FOLDER: Capability = {
  method: "POST", path: "/api/v1/projects/{project_id}/folders",
  mode: "write", entity: "folder",
  path_params: [{ name: "project_id", type: "integer", required: true }],
  // the nesting the product really wants, which a reader of the flat spec would miss
  body: [
    { name: "name", type: "string", required: true, json_path: "/folder/name" },
    { name: "notes", type: "string", json_path: "/folder/notes" },
  ],
  returns: ["id", "name"],
};

const DELETE_PLAN: Capability = {
  method: "POST", path: "/api/v1/projects/{project_id}/test-plans/{test_plan_id}/delete",
  mode: "destructive", entity: "test_plan",
  path_params: [
    { name: "project_id", type: "integer", required: true },
    { name: "test_plan_id", type: "integer", required: true },
  ],
};

const BULK_MOVE: Capability = {
  method: "POST", path: "/api/v1/projects/{project_id}/test-cases/bulk-move",
  mode: "write", entity: "test_case",
  path_params: [{ name: "project_id", type: "integer", required: true }],
  // the collision that makes a flat argument map ambiguous
  body: [{ name: "folder_id", type: "integer" }],
};

const INDEX: RegistryIndex = {
  schema_version: 1, build_id: "abc123-173caps",
  products: {
    tm: {
      summary: "Test Management",
      capabilities: [LIST_CASES, CREATE_FOLDER, DELETE_PLAN, BULK_MOVE],
      entities: { test_case: { aliases: ["tc", "case"] }, folder: {}, test_plan: {} },
    },
  },
};

describe("index loader", () => {
  it("refuses an index whose schema it does not understand", () => {
    // Guessing at a shape the generator announced is exactly where silently wrong tool
    // output comes from.
    expect(() => new CapabilityRegistry({ ...INDEX, schema_version: 99 }))
      .toThrow(IndexError);
  });

  it("finds a capability by endpoint, and says so when it cannot", () => {
    const registry = new CapabilityRegistry(INDEX);
    expect(registry.byEndpointLookup("get", LIST_CASES.path).capability).toBe(LIST_CASES);
    expect(() => registry.byEndpointLookup("GET", "/api/v1/nope"))
      .toThrow(/unknown_endpoint/);
  });
});

describe("binding", () => {
  it("substitutes path params and keeps query separate", () => {
    const bound = bind(LIST_CASES, { path_params: { project_id: 2, folder_id: 7 } });
    expect(bound.path).toBe("/api/v1/projects/2/folder/7/test-cases");
    expect(bound.body).toBeUndefined();
  });

  it("builds the nested body the product expects, not the flat one", () => {
    const bound = bind(CREATE_FOLDER, {
      path_params: { project_id: 2 }, body: { name: "New", notes: "d" },
    });
    expect(bound.body).toEqual({ folder: { name: "New", notes: "d" } });
  });

  it("keeps a name declared in two places unambiguous", () => {
    // `folder_id` is a body field here while `project_id` is a path one; grouping is what
    // makes that expressible at all.
    const bound = bind(BULK_MOVE, { path_params: { project_id: 2 }, body: { folder_id: 9 } });
    expect(bound.path).toBe("/api/v1/projects/2/test-cases/bulk-move");
    expect(bound.body).toEqual({ folder_id: 9 });
  });

  it("refuses an unknown argument instead of dropping it", () => {
    // Silently ignoring a misspelled filter returns a larger result set that looks correct.
    expect(() => bind(LIST_CASES, { path_params: { project_id: 1, folder_id: 1 }, query: { pp: 1 } }))
      .toThrow(/unknown query: pp/);
  });

  it("enforces required body fields, not just path ones", () => {
    expect(() => bind(CREATE_FOLDER, { path_params: { project_id: 2 }, body: {} }))
      .toThrow(/missing required parameter\(s\): name/);
  });

  it("stops a traversal attempt at the declared type", () => {
    expect(() => bind(LIST_CASES, { path_params: { project_id: "../../admin-v2", folder_id: 1 } }))
      .toThrow(/must be a number/);
  });

  it("encodes a string path value so it cannot rewrite the route", () => {
    const capability: Capability = {
      ...LIST_CASES, path: "/api/v1/x/{slug}",
      path_params: [{ name: "slug", type: "string", required: true }], query: [],
    };
    expect(bind(capability, { path_params: { slug: "a/b" } }).path).toBe("/api/v1/x/a%2Fb");
  });

  it("checks enums", () => {
    expect(() => coerce("nope", { name: "s", type: "string", values: ["low", "high"] }))
      .toThrow(/must be one of: low, high/);
  });
});

describe("search", () => {
  it("does not treat verbs as stopwords", () => {
    expect(terms("list the test cases")).toEqual(["list", "test", "cases"]);
  });

  it("prefers a collection for a plural query", () => {
    expect(isCollection(LIST_CASES)).toBe(true);
    expect(isCollection(DELETE_PLAN)).toBe(false);
  });

  it("matches through the aliases the harness authored", () => {
    const hits = searchCapabilities(INDEX.products, "tc");
    expect(hits.capabilities.map((c) => c.entity)).toContain("test_case");
  });

  it("ranks a write query onto the write endpoint", () => {
    const hits = searchCapabilities(INDEX.products, "create a folder");
    expect(hits.capabilities[0].path).toBe(CREATE_FOLDER.path);
  });

  it("lets a penalty reorder without excluding", () => {
    // A cardinality penalty used to take a valid score to zero, and 40 legitimate matches
    // vanished — the caller saw "no such capability".
    const hits = searchCapabilities(INDEX.products, "list test cases");
    expect(hits.total_matched).toBeGreaterThan(1);
  });
});

describe("auth", () => {
  it("forwards the caller's credentials as Api-Token", () => {
    // HTTP Basic is not usable on /api/v1; Api-Token is what the whole surface accepts.
    const headers = authHeaders({ username: "ing_Xx", accessKey: "SECRET" });
    expect(headers["Api-Token"]).toBe("ing_Xx:SECRET");
    expect(headers["request-source"]).toBe("ai-chatbot");
  });

  it("refuses rather than sending unauthenticated", () => {
    expect(() => authHeaders({ username: "u", accessKey: "" })).toThrow(InvocationError);
  });
});

describe("invoke — one request, response returned untouched", () => {
  const credentials = { username: "u", accessKey: "k" };

  it("makes exactly ONE request and hands back status and body", async () => {
    let calls = 0;
    const transport = async () => {
      calls += 1;
      return {
        status: 200,
        body: { test_cases: [{ id: 1, leaked: "kept" }], info: { count: 880, next: null } },
      };
    };
    const result = await invoke(
      LIST_CASES, { path_params: { project_id: 1, folder_id: 2 } },
      "https://tm.example", credentials, transport,
    );
    expect(calls).toBe(1);                       // paging is the caller's now
    expect(result.ok).toBe(true);
    expect(result.completed).toBe(true);         // the envelope says next: null
    // No extraction, no counting, no projection — the body as sent, `leaked` included.
    expect(result.http_response).toEqual({
      status: 200,
      body: { test_cases: [{ id: 1, leaked: "kept" }], info: { count: 880, next: null } },
    });
  });

  it("says the answer is incomplete when the envelope declares another page", async () => {
    const transport = async () => ({
      status: 200, body: { test_cases: [{ id: 1 }], info: { count: 880, next: 2 } },
    });
    const result = await invoke(
      LIST_CASES, { path_params: { project_id: 1, folder_id: 2 } },
      "https://tm.example", credentials, transport,
    );
    expect(result.ok).toBe(true);
    expect(result.completed).toBe(false);
  });

  it("mirrors a non-2xx and lets the product's own body explain it", async () => {
    const transport = async () => ({
      status: 422,
      body: { success: false, error: "Drill-down is only available for User Workload Reports" },
    });
    const result = await invoke(
      LIST_CASES, { path_params: { project_id: 1, folder_id: 2 } },
      "https://tm.example", credentials, transport,
    );
    expect(result.ok).toBe(false);
    expect(result.completed).toBe(false);
    expect(result.http_response.status).toBe(422);
    expect((result.http_response.body as Record<string, unknown>).error)
      .toMatch(/User Workload Reports/);
  });

  it("reports an unreachable product as status 0", async () => {
    const transport = async () => ({
      status: 0, body: null, error: "the product could not be reached",
    });
    const result = await invoke(
      LIST_CASES, { path_params: { project_id: 1, folder_id: 2 } },
      "https://tm.example", credentials, transport,
    );
    expect(result.ok).toBe(false);
    expect(result.http_response.status).toBe(0);
    expect(result.http_response.error).toMatch(/could not be reached/);
  });
});

