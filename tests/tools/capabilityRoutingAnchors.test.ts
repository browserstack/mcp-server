import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { productAnchors, ambiguousProducts } from "../../src/tools/capability-registry/search.js";
import { readFileSync } from "node:fs";

const load = (p: string) => { const j = JSON.parse(readFileSync(`capability/${p}.capability-index.json`, "utf8")); return j[p]; };
const products = { tm: load("tm"), tra: load("tra") } as any;

describe("productAnchors", () => {
  const cases: [string, string[]][] = [
    ["What did the last report say?", []],
    ["Did this build pass its quality gate?", ["tra"]],
    ["What test plans are active right now?", ["tm"]],
    ["Show me all datasets in the project", ["tm"]],
    ["the test management one", ["tm"]],
    ["test observability please", ["tra"]],
    // `flaky` is TRA's word. Neither index models it as an entity, so until products
    // could claim their own vocabulary it anchored nothing at all.
    ["Which tests are flaky?", ["tra"]],
    ["Show me the tags on the Automate builds", ["tm", "tra"]],
    ["I mean the dashboards", ["tra"]],
  ];
  for (const [text, want] of cases)
    it(`${JSON.stringify(text)} -> ${want.join(",") || "none"}`, () =>
      expect(productAnchors(products, text).products).toEqual(want));
});

describe("ambiguity still fires on the shared nouns", () => {
  for (const q of ["What did the last report say?", "Show me the runs", "which project"])
    it(q, () => expect(ambiguousProducts(products, q).products.length).toBeGreaterThan(1));
});

describe("searchCapability withholds the product names", () => {
  // THE NAMES WERE THE SHORTCUT. An enum publishes them in the schema, which clients show
  // the model before it calls anything — so a model that never called listProducts still
  // knew `tm` and `tra` existed and picked one. On the requests that routed silently,
  // listProducts was never called at all: there was nothing left to learn from it.
  it("declares product as a free string, not an enum", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/tools/capability-registry/register.ts",
      "utf8",
    );
    const search = src.slice(src.indexOf("tools.searchCapability = server.tool"));
    const arg = search.slice(0, search.indexOf("resume_token:"));
    expect(arg).toMatch(/product: z\s*\.string\(\)/);
    expect(arg).not.toMatch(/product: productArg\(\)/);
  });

  it("names listProducts as where a product name comes from", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/tools/capability-registry/register.ts",
      "utf8",
    );
    // Slice WITHIN searchCapability: `resume_token` is named in listProducts too, and
    // from the top of the file that match comes first.
    const start = src.indexOf("tools.searchCapability = server.tool");
    const search = src.slice(start, src.indexOf("resume_token:", start));
    expect(search).toMatch(/CALL listProducts FIRST/);
    expect(search).toMatch(/exactly as listProducts spells it/);
  });
});

describe("the user_words gate (CAPABILITY_ROUTING_GATE=user_words)", () => {
  const FIXTURE = fileURLToPath(
    new URL("../fixtures/registry-index.json", import.meta.url),
  );
  beforeEach(() => {
    process.env.CAPABILITY_ROUTING_GATE = "user_words";
    process.env.CAPABILITY_REGISTRY_INDEX = FIXTURE;
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm.example";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.CAPABILITY_ROUTING_GATE;
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
  });

  it("judges the user's words, not the agent's rewrite of them", async () => {
    const { ambiguousProducts } = await import(
      "../../src/tools/capability-registry/search.js"
    );
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/tools/capability-registry/register.ts",
      "utf8",
    );
    // The paraphrase is what used to be judged, and it is the caller's to choose.
    expect(src).toMatch(/const subject = user_words\?\.trim\(\) \? user_words : query;/);
    expect(src).toMatch(/ambiguousProducts\(registry\.index\.products, subject\)/);
    expect(ambiguousProducts).toBeTypeOf("function");
  });

  it("keeps a raised clash open until a product is actually named", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/tools/capability-registry/register.ts",
      "utf8",
    );
    // Minted on refusal, required back on the retry, and spent on use — a reworded
    // query cannot walk around a token the way it could walk around a remembered word.
    expect(src).toMatch(/const token = mintClashToken\(\)/);
    expect(src).toMatch(/openClashes\.has\(resume_token\)/);
    expect(src).toMatch(/openClashes\.delete\(resume_token!\)/);
    expect(src).toMatch(/reopened = adjudicate && !settled && openClashes\.size > 0/);
  });
});

describe("a lone decisive word settles, and says so", () => {
  // SILENCE IS NOT AN ANSWER. When one product's own vocabulary settles the request, the
  // caller used to learn only that nothing needed asking — and then searched the other
  // product, which is the same wrong turn arrived at quietly.
  it("names the product its words point at, and the words", () => {
    const verdict = ambiguousProducts(products, "Show me all datasets in the project");
    expect(verdict.products).toEqual([]);
    expect(verdict.settled).toBe("tm");
    expect(verdict.because).toContain("dataset");
  });

  it("leaves `settled` unset when the words genuinely clash", () => {
    expect(ambiguousProducts(products, "Delete the failed results from this run.").settled)
      .toBeUndefined();
  });
});

describe("a summary claims the words its product really uses", () => {
  // Both products record the RESULT of a run; only one modelled the word as an entity, so
  // "delete the failed results from this run" read as settled and routed without asking.
  for (const q of [
    "Delete the failed results from this run.",
    "Export the 'Sprint 14 Regression' run with results.",
  ])
    it(q, () => {
      const verdict = ambiguousProducts(products, q);
      expect(verdict.products).toEqual(["tm", "tra"]);
      expect(verdict.terms).toContain("result");
    });

  it("still lets a word only one product uses decide", () =>
    expect(ambiguousProducts(products, "Show me all datasets in the project").products)
      .toEqual([]));
});

describe("a request with no product vocabulary at all", () => {
  // THE LEAST SETTLED CASE, REPORTED AS THE CALMEST. No word in these belongs to any
  // product, so the shared-term check found nothing to object to and said so — the same
  // verdict it gives a request that genuinely answers itself.
  for (const q of [
    "Can we ship this?",
    "What should we fix first?",
    "Show me the failed tests.",
    "Give me something I can paste into the standup.",
  ])
    it(q, () => {
      const verdict = ambiguousProducts(products, q);
      expect(verdict.unknown).toBe(true);
      expect(verdict.settled).toBeUndefined();
    });

  it("is not claimed for a request whose words DO name something", () =>
    expect(ambiguousProducts(products, "What did the last report say?").unknown)
      .toBeUndefined());
});

describe("routing_terms let a product claim its own words", () => {
  it("gives tra the flakiness vocabulary no index models as an entity", () => {
    expect(ambiguousProducts(products, "Which tests are flaky?").unknown).toBeUndefined();
    expect(productAnchors(products, "Which tests are flaky?").products).toEqual(["tra"]);
  });

  it("stops an organisational word both products use from settling it", () => {
    // `workspace` was tm's alone and decided three prompts on its own; both products
    // have one, so it decides nothing now.
    const verdict = ambiguousProducts(products, "Show me all the projects in our workspace.");
    expect(verdict.settled).toBeUndefined();
    expect(verdict.products).toEqual(["tm", "tra"]);
  });
});

describe("a clash announced by listProducts binds the next search", () => {
  // IT USED TO BE ADVICE. The agent read the clash, searched one product, searched the
  // other, and put the question to the user afterwards — by which point it had already
  // answered it twice. The gate downstream never fired because it judges the caller's
  // paraphrase when no user words are quoted, and a paraphrase carries none of the shared
  // words that caused the clash.
  it("mints a token on the clash and on a blank request", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/tools/capability-registry/register.ts", "utf8");
    const listing = src.slice(
      src.indexOf("tools.listProducts = server.tool("),
      src.indexOf("tools.searchCapability = server.tool("),
    );
    expect(listing).toMatch(/ambiguity\.products\.length > 1 \|\| ambiguity\.unknown/);
    expect(listing).toMatch(/\? mintClashToken\(\)/);
    expect(listing).toMatch(/resume_token: listingToken/);
    expect(listing).toMatch(/Searching before you ask will be refused/);
  });
});
