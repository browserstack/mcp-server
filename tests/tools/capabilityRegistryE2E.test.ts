import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);
/** The stored layout: `capability/<product>.capability-index.json`, one file per product. */
const FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/capability/", import.meta.url),
);
/**
 * A TWO-PRODUCT directory, composed at run time.
 *
 * One product cannot exercise anything about telling two apart: with a single index loaded
 * there is no ambiguity to detect and the gate is correct to stay silent. Only tm ships, so
 * the second is a SYNTHETIC fixture — a made-up widget catalogue with dummy capabilities,
 * never published (see that directory's README). The shipped tm index is used as-is so
 * these tests still track what actually ships, rather than a stale copy of it.
 *
 * Composed rather than committed: a second copy of the tm index is ~2MB of duplicate that
 * would drift from the real one the first time it changed.
 */
const SHIPPED_DIR = mkdtempSync(join(tmpdir(), "cap-registry-multi-"));
for (const [from, name] of [
  [new URL("../../capability/tm.capability-index.json", import.meta.url), "tm.capability-index.json"],
  [
    new URL("../fixtures/capability-multi/secondproduct.capability-index.json", import.meta.url),
    "secondproduct.capability-index.json",
  ],
] as const) {
  copyFileSync(fileURLToPath(from), join(SHIPPED_DIR, name));
}

const CONFIG = {
  "browserstack-username": "ing_Xx",
  "browserstack-access-key": "SECRET",
} as any;

async function buildServer() {
  // Imported lazily so the env below is in place before config.ts resolves the artifact.
  const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
  return new BrowserStackMcpServer(CONFIG);
}

/** The product's own authored summary, read from the fixture rather than hardcoded. */
function registryFixtureSummary(): string {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
  return (raw.products ? raw.products.tm : raw.tm).summary as string;
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
    for (const name of [
      "listProducts",
      "describeEntity",
      "searchCapability",
      "describeCapability",
      "invokeCapability",
    ]) {
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
      {},
      {} as any,
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.products.map((p: any) => p.name)).toEqual(["tm"]);
    // NO provenance, here or on any other tool. `build_id` and `version` exist for our
    // logs and for cache busting, and capability resolution must never depend on them —
    // which is exactly why no caller has anything to do with them. The startup log
    // records what loaded, and that is where a question about a stale index is answered.
    expect(payload.build_id).toBeUndefined();
    expect(payload.products[0].build_id).toBeUndefined();
    expect(payload.products[0].version).toBeUndefined();
  });

  it("names the loaded products in the schema, and nowhere else", async () => {
    const server = await buildServer();
    const tools: any = server.getTools();

    // The accepted values travel in the SCHEMA, so a client validates them and the model
    // sees them without spending a listProducts call.
    const shape =
      tools.describeEntity.inputSchema?.shape ??
      tools.describeEntity._def?.shape;
    const entries = shape.product._def?.entries ?? shape.product._def?.values;
    expect(Object.values(entries)).toEqual(["tm"]);

    // NO authored SUMMARY in any description. listProducts used to restate each product's
    // trimmed summary in its own — duplicating, as static context on every request, the
    // exact thing the tool returns when called, in prose that goes stale with the
    // artifact. Product NAMES are fine and still appear; it is the unbounded authored
    // prose that does not.
    const summary = registryFixtureSummary();
    for (const tool of [
      "listProducts",
      "searchCapability",
      "describeCapability",
    ]) {
      for (const phrase of ["SSO/OAuth", summary.slice(0, 40)]) {
        expect(tools[tool].description, `${tool} / ${phrase}`).not.toContain(
          phrase,
        );
      }
    }
    // It reaches the caller where it belongs: in the response.
    const listed = JSON.parse(
      (await tools.listProducts.handler({}, {} as any)).content[0].text,
    );
    expect(listed.products[0].summary).toContain("Test Management");
  });

  it("carries each entity's one-line meaning on the routing call", async () => {
    const server = await buildServer();
    const listed = JSON.parse(
      (
        await (server.getTools().listProducts as any).handler({}, {} as any)
      ).content[0].text,
    );
    const byName = Object.fromEntries(
      listed.products[0].entities.map((e: any) => [e.entity, e]),
    );
    // Name and meaning, and nothing else. The aliases answer "what else is this
    // called" — the question a FAILED search raises, not the one routing asks — so they
    // travel in searchCapability's weak-match block instead of costing ~2.5KB of
    // speculative context on every routing call.
    expect(Object.keys(byName.test_run)).toEqual(["entity", "description"]);
    expect(byName.version.description).toMatch(/snapshot of a test case/);
    expect(byName.version.aliases).toBeUndefined();

    // describeEntity carries it too — same field, so an agent that went deep on one
    // entity is not reading a different vocabulary from the one that routed it there.
    const deep = JSON.parse(
      (
        await (server.getTools().describeEntity as any).handler(
          { product: "tm", entity: "version" },
          {} as any,
        )
      ).content[0].text,
    );
    expect(deep.description).toBe(byName.version.description);
  });

  it("will not search without being told which product", async () => {
    // The point is the tool that is NOT being called. listProducts carries the routing
    // data — each product's purpose, its entities, and what every entity means — but
    // nothing obliged an agent to read it while a search worked without naming a
    // product. An optional step in front of a working one is a step that does not
    // happen, so the ordering is made structural rather than advisory.
    const server = await buildServer();
    const tools: any = server.getTools();
    const shape =
      tools.searchCapability.inputSchema?.shape ??
      tools.searchCapability._def?.shape;

    expect(shape.product.isOptional()).toBe(false);
    // Everything else stays optional: requiring more than the routing decision would
    // make the common case worse without settling anything.
    for (const arg of ["entity", "mode", "limit"]) {
      expect(shape[arg].isOptional(), arg).toBe(true);
    }

    // describeCapability and invokeCapability resolve by NAME, which is already unique
    // per product, so neither needs it — the constraint belongs where the ambiguity is.
    for (const tool of ["describeCapability", "invokeCapability"]) {
      const s = tools[tool].inputSchema?.shape ?? tools[tool]._def?.shape;
      expect(s.product.isOptional(), tool).toBe(true);
    }
  });

  it("refuses a query only the user can settle, and says what to ask", async () => {
    // Requiring `product` made every CALL unambiguous and did nothing about an agent
    // making two of them. "list all projects" was answered by searching tm, then Load
    // Testing, then merging — a question about which product the user meant, answered by
    // guessing both. Prose asking the agent to check is a suggestion it can decline, and
    // declining is cheaper than interrupting someone; a refusal is not.
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    process.env.CAPABILITY_REGISTRY_INDEX_DIR = SHIPPED_DIR;
    const server = await buildServer();
    const search = server.getTools().searchCapability as any;
    const run = async (args: Record<string, unknown>) => {
      const r = await search.handler(
        { product: "tm", product_choice: "not_asked", ...args },
        {} as any,
      );
      return { blocked: r.isError === true, body: JSON.parse(r.content[0].text) };
    };

    const refused = await run({ query: "list all projects" });
    expect(refused.blocked).toBe(true);
    // The refusal has to be actionable: which products, and on which word.
    expect(refused.body.error).toContain("secondproduct or tm");
    expect(refused.body.error).toContain("'project'");
    expect(refused.body.error).toMatch(/to the USER/);
    // And it must name the failure mode it exists to stop.
    expect(refused.body.error).toMatch(/search each product in turn and merge/);

    // A word only one product claims settles the query, so there is nothing to ask.
    for (const query of [
      "list the test cases in a folder", // `folder` is shared, `test case` is not
      "check my quota",
      "bulk delete test cases",
    ]) {
      expect((await run({ query })).blocked, query).toBe(false);
    }

    // Two ways out, both explicit: the user answered, or the caller was already specific.
    expect(
      (await run({ query: "list all projects", product_choice: "user_confirmed" }))
        .blocked,
    ).toBe(false);
    expect(
      (await run({ query: "list all projects", entity: "project" })).blocked,
    ).toBe(false);
  });

  it("hands over what it takes to ask the question, not an instruction to go look", async () => {
    // Telling the agent to call listProducts costs a round trip and still leaves it
    // composing a question out of nothing — so it guesses instead, which is the whole
    // behaviour being stopped. What makes the choice answerable is what each product
    // calls the shared word and what it means THERE.
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    process.env.CAPABILITY_REGISTRY_INDEX_DIR = SHIPPED_DIR;
    const server = await buildServer();
    const r: any = await (server.getTools().searchCapability as any).handler(
      { query: "list all projects", product: "tm", product_choice: "not_asked" },
      {} as any,
    );
    const { clarify } = JSON.parse(r.content[0].text);

    expect(clarify.shared).toEqual(["project"]);
    expect(clarify.question).toMatch(/Which product/);
    expect(clarify.options.map((o: any) => o.product).sort()).toEqual([
      "secondproduct",
      "tm",
    ]);

    // Each option says what the product is, and which of ITS entities owns the shared
    // word — the two things a user needs to answer without being shown a schema.
    const tm = clarify.options.find((o: any) => o.product === "tm");
    expect(tm.summary).toMatch(/Test Management/);
    expect(tm.shared_terms[0]).toMatchObject({ term: "project", entity: "project" });
    expect(tm.shared_terms[0].means).toMatch(/top-level container/);

    // The second product ships no entity descriptions, so its sense of `project` has no
    // `means`. Absent rather than invented: the question is still askable, just thinner on
    // one side, and that is a data gap for that product to close.
    const second = clarify.options.find(
      (o: any) => o.product === "secondproduct",
    );
    expect(second.summary).toMatch(/widget catalogue/);
    expect(second.shared_terms[0].entity).toBe("project");
    expect(second.shared_terms[0].means).toBeUndefined();
  });

  it("folds plurals on both sides, or the gate misses the case it was built for", async () => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    process.env.CAPABILITY_REGISTRY_INDEX_DIR = SHIPPED_DIR;
    const server = await buildServer();
    const search = server.getTools().searchCapability as any;
    const blocked = async (query: string) =>
      (
        await search.handler(
          { query, product: "tm", product_choice: "not_asked" },
          {} as any,
        )
      ).isError === true;

    // QUERY side: the entry is `project`, the user says "projects". Exact containment
    // missed this — and it is the query that was actually reported.
    expect(await blocked("list all projects")).toBe(true);
    expect(await blocked("list all runs")).toBe(true);

    // VOCABULARY side: tm lists BOTH `report` and `reports` as aliases. Folding only the
    // query made `reports` look tm-exclusive, so a shared word read as settled.
    expect(await blocked("show me the report")).toBe(true);
    expect(await blocked("show me the reports")).toBe(true);
  });

  it("registers nothing, and does not throw, when the artifact is missing", async () => {
    process.env.CAPABILITY_REGISTRY_INDEX = "/nonexistent/index.json";
    const server = await buildServer();
    // A packaging problem must not take every other product's tools down with it.
    expect(server.getTools().invokeCapability).toBeUndefined();
    expect(Object.keys(server.getTools()).length).toBeGreaterThan(5);
  });

  it("honours the kill switch", async () => {
    process.env.CAPABILITY_REGISTRY_DISABLED = "true";
    const server = await buildServer();
    expect(server.getTools().searchCapability).toBeUndefined();
  });

  it("searches the real index through the registered tool", async () => {
    const server = await buildServer();
    const result: any = await (
      server.getTools().searchCapability as any
    ).handler(
      { query: "list the test cases in a folder", product: "tm" },
      {} as any,
    );
    const payload = JSON.parse(result.content[0].text);
    // No provenance on a search either: it was the WHOLE registry's build id, so a
    // search scoped to tm still announced Load Testing's build — metadata about a
    // product the caller did not ask about and could not act on.
    expect(payload.build_id).toBeUndefined();
    expect(payload.capabilities.length).toBeGreaterThan(0);
    // Addressed by NAME, never by route — the shortlist publishes no path at all now
    // that every capability in every shipped product carries a name.
    expect(payload.capabilities[0].name).toBeTruthy();
    expect(payload.capabilities[0].path).toBeUndefined();
  });

  it("hands back response shapes with nothing left to dereference", async () => {
    // Moved from searchCapability to describeCapability when search became a shortlist:
    // response shapes are 53% of a full record and are needed for the ONE capability the
    // caller picks, not for all eight it was offered.
    const server = await buildServer();
    const shortlist: any = await (
      server.getTools().searchCapability as any
    ).handler(
      { query: "create a folder in a project", product: "tm" },
      {} as any,
    );
    const picked = JSON.parse(shortlist.content[0].text).capabilities[0];

    const result: any = await (
      server.getTools().describeCapability as any
    ).handler({ name: picked.name }, {} as any);
    const payload = JSON.parse(result.content[0].text);

    // Which product owns it — needed to disambiguate, and to know whose tables were read.
    expect(payload.product).toBe("tm");
    // The 2xx shape, expanded: no `{"$response": …}` or `{"$schema": …}` reaches the caller.
    expect(Object.keys(payload.responses)).toContain("200");
    expect(JSON.stringify(payload)).not.toContain('"$schema"');
    expect(JSON.stringify(payload)).not.toContain('"$response"');
    expect(payload.responses["200"].schema).toBeDefined();
  });

  it("returns the success shape by default and the error shapes only on request", async () => {
    const server = await buildServer();
    const describe = server.getTools().describeCapability as any;
    const run = async (args: Record<string, unknown>) =>
      JSON.parse(
        (
          await describe.handler(
            { name: "create_root_folder", ...args },
            {} as any,
          )
        ).content[0].text,
      );

    const dflt = await run({});
    const all = await run({ include_responses: "all" });
    const none = await run({ include_responses: "none" });

    expect(Object.keys(dflt.responses)).toEqual(["200"]);
    expect(Object.keys(all.responses)).toContain("404");
    expect(none.responses).toBeUndefined();

    // The error shapes are near-identical across endpoints, so carrying them by default
    // would multiply the payload several times over to repeat boilerplate.
    expect(JSON.stringify(all).length).toBeGreaterThan(
      JSON.stringify(dflt).length * 1.5,
    );
    expect(JSON.stringify(none).length).toBeLessThan(
      JSON.stringify(dflt).length,
    );
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
        // The transport reads text and parses it itself, so a faithful double needs both.
        text: async () =>
          JSON.stringify({
            projects: [{ id: 1, name: "P", description: "d", leaked: "no" }],
            info: { count: 1 },
          }),
      };
    });

    const server = await buildServer();
    const result: any = await (
      server.getTools().invokeCapability as any
    ).handler({ method: "GET", path: "/api/v1/projects/basic" }, {} as any);
    const payload = JSON.parse(result.content[0].text);

    expect(payload.ok).toBe(true);
    expect(calls[0].headers["Api-Token"]).toBe("ing_Xx:SECRET");
    expect(calls[0].headers["request-source"]).toBe("ai-chatbot");
    expect(
      calls[0].url.startsWith("https://tm.example/api/v1/projects/basic"),
    ).toBe(true);
    // ONE request, and the body exactly as the product sent it
    expect(calls).toHaveLength(1);
    expect(payload.http_response.status).toBe(200);
    expect(payload.http_response.body.projects[0]).toEqual({
      id: 1,
      name: "P",
      description: "d",
      leaked: "no",
    });
  });

  it("refuses a destructive endpoint without calling the product", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const server = await buildServer();
    const result: any = await (
      server.getTools().invokeCapability as any
    ).handler(
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
    expect(fetchSpy).not.toHaveBeenCalled(); // refused before any egress
  });

  it("refuses a write until the user has confirmed, and validates params first", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const server = await buildServer();
    const invokeCapability = server.getTools().invokeCapability as any;

    const noConsent: any = await invokeCapability.handler(
      {
        method: "POST",
        path: "/api/v1/projects/{project_id}/folders",
        path_params: { project_id: 1 },
        body: { name: "New" },
      },
      {} as any,
    );
    expect(JSON.parse(noConsent.content[0].text).error).toMatch(
      /ask the user to confirm/,
    );

    // A typo must surface as a parameter error, NOT as "go ask a human" about a call that
    // was never going to run.
    const typo: any = await invokeCapability.handler(
      {
        method: "POST",
        path: "/api/v1/projects/{project_id}/folders",
        path_params: { project_id: 1 },
        body: { nmae: "New" },
      },
      {} as any,
    );
    expect(JSON.parse(typo.content[0].text).error).toMatch(
      /unknown body: nmae/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
