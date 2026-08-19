import { describe, expect, it } from "vitest";

import { bind, coerce } from "../../src/tools/capability-registry/bind.js";
import {
  discoveredFields, isEnvelopeField, itemsOf, projectRow, totalOf,
} from "../../src/tools/capability-registry/envelope.js";
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

describe("finding rows in a response", () => {
  it("finds rows by shape, whatever the envelope calls them", () => {
    // tm uses 30 distinct row-key names; a hardcoded list missed 24 of them.
    expect(itemsOf({ success: true, path_folders: [{ id: 1 }] })).toEqual([{ id: 1 }]);
  });

  it("treats a single wrapped record as one row", () => {
    // Without this every stats/summary/detail read came back ok:true, count:0, items:[].
    expect(itemsOf({ success: true, project: { id: 4 } })).toEqual([{ id: 4 }]);
    expect(itemsOf({ id: 9, name: "flat" })).toEqual([{ id: 9, name: "flat" }]);
  });

  it("keeps an empty array distinguishable from a shape with no rows", () => {
    expect(itemsOf({ success: true, test_cases: [] })).toEqual([]);
  });

  it("reads the total out of the envelope", () => {
    expect(totalOf({ info: { count: 880 } })).toBe(880);
  });

  it("knows an envelope field from a row field", () => {
    for (const name of ["total_pages", "has_more", "is_empty", "count", "success"]) {
      expect(isEnvelopeField(name)).toBe(true);
    }
    expect(isEnvelopeField("identifier")).toBe(false);
  });
});

describe("projection", () => {
  it("keeps only declared fields", () => {
    expect(projectRow({ id: 1, secret_note: "x" }, ["id"], false)).toEqual({ id: 1 });
  });

  it("emits nothing when nothing is declared and discovery is off", () => {
    expect(projectRow({ id: 1 }, [], false)).toEqual({});
  });

  it("discovers scalars but never expands an object or a sensitive name", () => {
    // `assignee` expands to email/full_name/browserstack_user_id; field_values carry
    // signed URLs. Both are objects, so neither can travel this path.
    expect(discoveredFields({
      id: 7, identifier: "TP-3", assignee: { email: "a@b.c" }, tags: ["x"],
      api_token: "t", user_email: "a@b.c", user_id: 4,
    })).toEqual({ id: 7, identifier: "TP-3" });
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

describe("invoke", () => {
  const credentials = { username: "u", accessKey: "k" };

  it("pages to completion at the declared ceiling and projects the rows", async () => {
    const seen: { query: Record<string, unknown>; headers: Record<string, string> }[] = [];
    const transport = async (
      _m: string, _u: string, headers: Record<string, string>, query: Record<string, unknown>,
    ) => {
      seen.push({ query, headers });
      const page = Number(query.p || 1);
      const start = (page - 1) * 300;
      const rows = Array.from({ length: Math.max(0, Math.min(300, 880 - start)) }, (_v, i) => ({
        id: start + i, identifier: `TC-${start + i}`, title: "t", leaked: "no",
      }));
      return { status: 200, body: { test_cases: rows, info: { count: 880 } } };
    };
    const result = await invoke(
      LIST_CASES, { path_params: { project_id: 1, folder_id: 2 } },
      "https://tm.example", credentials, transport,
    );
    expect(result.ok).toBe(true);
    expect(result.count).toBe(880);
    expect(result.requests_made).toBe(3);            // not 30 at the product's default
    expect(seen[0].query.count).toBe(300);
    expect(seen[0].headers["Api-Token"]).toBe("u:k");
    expect(Object.keys(result.items[0])).toEqual(["id", "identifier", "title"]);
  });

  it("reports drift rather than an empty answer", async () => {
    const transport = async () => ({ status: 200, body: { rows: [{ unrelated: 1 }] } });
    const result = await invoke(
      LIST_CASES, { path_params: { project_id: 1, folder_id: 2 } },
      "https://tm.example", credentials, transport,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/capability_returns_drift/);
  });

  it("surfaces a non-2xx as a failed call, not as empty rows", async () => {
    const transport = async () => ({ status: 401, body: { error: "Unauthorized" } });
    const result = await invoke(
      LIST_CASES, { path_params: { project_id: 1, folder_id: 2 } },
      "https://tm.example", credentials, transport,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });
});
