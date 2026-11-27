import { describe, expect, it } from "vitest";

import {
  PROFILES,
  ROUTING_EVAL_FILE,
  loadRegistry,
  readJson,
  route,
  routingMismatch,
  shippedIndexFiles,
  type RoutingFixture,
} from "../../scripts/lib/index-eval.js";

/**
 * L2 check 3 (Right product): does a user question go to the right product?
 *
 * Runs `ambiguousProducts` (the code step behind `listProducts(query)`) on the SHIPPED
 * indexes, in the local and remote profiles. Cases: tests/fixtures/product-routing-eval.json.
 *
 * A case with `known` records a route that is wrong today. It does not block. It fails when
 * the route becomes right, so the `known` field is removed in the same change.
 */
const FIXTURE = readJson<RoutingFixture>(ROUTING_EVAL_FILE);
const PRODUCTS = Object.keys(shippedIndexFiles());

describe("product-routing fixture", () => {
  it("names only shipped products", () => {
    const named = new Set<string>();
    for (const c of FIXTURE.cases) {
      if ("settled" in c.expect) named.add(c.expect.settled);
      if ("clash" in c.expect) c.expect.clash.forEach((p) => named.add(p));
    }
    expect([...named].filter((p) => !PRODUCTS.includes(p))).toEqual([]);
  });

  it("has no duplicate questions", () => {
    const qs = FIXTURE.cases.map((c) => c.q.toLowerCase());
    expect(qs.filter((q, i) => qs.indexOf(q) !== i)).toEqual([]);
  });

  it("has a settled case for every shipped product", () => {
    const settled = new Set(
      FIXTURE.cases
        .filter((c) => !c.known && "settled" in c.expect)
        .map((c) => ("settled" in c.expect ? c.expect.settled : "")),
    );
    expect(PRODUCTS.filter((p) => !settled.has(p))).toEqual([]);
  });
});

describe.each(PROFILES)("product routing, %s profile", (profile) => {
  const products = loadRegistry(profile).index.products;

  it.each(FIXTURE.cases.map((c) => [c.q, c] as const))("%s", (_q, c) => {
    const got = route(products, c.q);
    const mismatch = routingMismatch(got, c.expect);
    if (c.known) {
      expect(
        mismatch,
        `routes right now (was: ${c.known}). Remove "known" from this case.`,
      ).toBeDefined();
      return;
    }
    expect(mismatch, `because: ${(got.because ?? got.terms).join(", ")}`).toBe(
      undefined,
    );
  });
});
