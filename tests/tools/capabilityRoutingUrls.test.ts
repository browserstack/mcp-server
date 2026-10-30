import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ambiguousProducts } from "../../src/tools/capability-registry/search.js";

const load = (p: string) => {
  const j = JSON.parse(
    readFileSync(`capability/${p}.capability-index.json`, "utf8"),
  );
  return j[p];
};
const products = {
  tm: load("tm"),
  tra: load("tra"),
  loadtesting: load("loadtesting"),
  app_accessibility: load("app_accessibility"),
} as any;

// The reported cases, verbatim in shape: a dashboard link was read as a three-way clash
// because its PATH carries `build`, `project`, `session` and `dashboard` — nouns several
// products claim — while its HOST, the only part that names a product, belonged to no
// product's vocabulary at all.
describe("a BrowserStack dashboard link routes on its host, not its path", () => {
  const settles: [string, string][] = [
    ["https://test-reporting.browserstack.com/projects/42/builds/99", "tra"],
    ["https://observability.browserstack.com/projects/x/builds/y", "tra"],
    ["https://test-management.browserstack.com/projects/PR-20/folder/1", "tm"],
    [
      "https://app-accessibility.browserstack.com/builds/7",
      "app_accessibility",
    ],
    // Regional editions of the same dashboard route exactly as the parent does.
    ["https://test-management-eu.browserstack.com/projects/PR-20", "tm"],
    ["https://test-management-in.browserstack.com/projects/PR-20", "tm"],
    // The split between the dashboard host and the API host is ours, not the user's.
    ["https://api-observability.browserstack.com/api/v1/builds/9", "tra"],
    // Scheme-less, as people paste it.
    ["test-reporting.browserstack.com/projects/42/builds/99", "tra"],
  ];
  for (const [url, product] of settles)
    it(`${url} -> ${product}`, () =>
      expect(ambiguousProducts(products, url).settled).toBe(product));

  it("still routes on the host when the sentence around it is ambiguous", () => {
    const a = ambiguousProducts(
      products,
      "what failed in this build? https://test-reporting.browserstack.com/projects/42/builds/99",
    );
    expect(a.settled).toBe("tra");
    expect(a.products).toEqual([]);
  });
});

describe("a link to a product the registry does not carry is not a clash", () => {
  // Automate, App Automate and Live are served by the standalone tools. The registry has
  // nothing to offer for them, so there is no question to put to the user — and asking one
  // is what the feedback reported.
  for (const url of [
    "https://automate.browserstack.com/dashboard/v2/builds/8f3a2c1d/sessions/abc123",
    "https://app-automate.browserstack.com/dashboard/v2/builds/abc",
    "https://live.browserstack.com/dashboard",
    "show me the failure logs for https://automate.browserstack.com/dashboard/v2/builds/8f3/sessions/abc",
  ])
    it(url, () => {
      const a = ambiguousProducts(products, url);
      expect(a.products).toEqual([]);
      expect(a.settled).toBeUndefined();
      expect(a.unknown).toBeFalsy();
    });
});

describe("two products' links in one request is a real clash", () => {
  it("asks, rather than picking the first one", () => {
    const a = ambiguousProducts(
      products,
      "copy this case https://test-management.browserstack.com/projects/PR-20/folder/1 " +
        "into the run at https://test-reporting.browserstack.com/projects/42/builds/99",
    );
    expect(a.products).toEqual(["tm", "tra"]);
  });
});

describe("the word gate is untouched where no link is involved", () => {
  it("still clashes on a shared noun", () =>
    expect(
      ambiguousProducts(products, "What did the last report say?").products
        .length,
    ).toBeGreaterThan(1));

  it("still settles on a product's own word", () =>
    expect(ambiguousProducts(products, "which tests are flaky").settled).toBe(
      "tra",
    ));

  it("still reports a request with nothing to route on", () =>
    expect(ambiguousProducts(products, "can we ship this?").unknown).toBe(
      true,
    ));

  it("ignores a URL that is not ours, and reads the words around it", () => {
    const a = ambiguousProducts(
      products,
      "the spec is at https://example.com/builds/project/report — what did the last report say?",
    );
    expect(a.products.length).toBeGreaterThan(1);
  });
});
