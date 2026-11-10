import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { resolveClash } from "../../src/tools/capability-registry/policy.js";
import { ambiguousProducts } from "../../src/tools/capability-registry/search.js";
import { ProductIndex } from "../../src/tools/capability-registry/types.js";

const load = (name: string): ProductIndex =>
  JSON.parse(readFileSync(`capability/${name}.capability-index.json`, "utf8"))[
    name
  ];

const DEVICE = {
  applive: load("applive"),
  mobiledevicecontrol: load("mobiledevicecontrol"),
} as Record<string, ProductIndex>;

describe("a clash the products have already decided", () => {
  it("resolves App Live vs App Automate to App Automate", () => {
    const r = resolveClash(DEVICE, ["applive", "mobiledevicecontrol"]);
    expect(r?.product).toBe("mobiledevicecontrol");
    expect(r?.over).toEqual(["applive"]);
    // The caller has to be able to tell the user WHY, so the note must say something.
    expect(r?.note.length).toBeGreaterThan(20);
  });

  it("does not care which order the clash set arrives in", () => {
    expect(
      resolveClash(DEVICE, ["mobiledevicecontrol", "applive"])?.product,
    ).toBe("mobiledevicecontrol");
  });

  it("leaves a clash it only partly covers to the user", () => {
    // Test Management is in the set for its own reasons; App Automate's declaration says
    // nothing about it, so the question is still a real one.
    const products = { ...DEVICE, tm: load("tm") };
    expect(
      resolveClash(products, ["applive", "mobiledevicecontrol", "tm"]),
    ).toBeUndefined();
  });

  it("invents nothing when no product declares anything", () => {
    const products = { tm: load("tm"), tra: load("tra") };
    expect(resolveClash(products, ["tm", "tra"])).toBeUndefined();
  });

  it("resolves nothing on a mutual declaration rather than guessing", () => {
    const a = { ...load("applive"), routing_policy: { preferred_over: ["b"] } };
    const b = { ...load("applive"), routing_policy: { preferred_over: ["a"] } };
    expect(
      resolveClash({ a, b } as Record<string, ProductIndex>, ["a", "b"]),
    ).toBeUndefined();
  });

  it("needs a winner that actually won, not one that merely survived", () => {
    // `c` declares nothing; it must not inherit the set because `a` knocked `b` out.
    const a = { ...load("applive"), routing_policy: { preferred_over: ["b"] } };
    const b = load("applive");
    const c = load("applive");
    expect(
      resolveClash({ a, b, c } as Record<string, ProductIndex>, ["b", "c"]),
    ).toBeUndefined();
  });

  it("ignores a single-product set", () => {
    expect(resolveClash(DEVICE, ["mobiledevicecontrol"])).toBeUndefined();
  });
});

describe("the requests the QA pass found", () => {
  // A new session the user did not attribute to a product: the published rule sends it to
  // App Automate, and every tester saw the server ask instead.
  for (const prompt of [
    "Upload apps/WikipediaSample.apk and give me its app ID.",
    "Open BStackSampleApp on an iPhone 15 and check that it opens to the UI Elements screen.",
  ])
    it(`routes without asking: ${prompt.slice(0, 40)}`, () => {
      const clash = ambiguousProducts(DEVICE, prompt);
      expect(clash.products.length).toBeGreaterThan(1);
      expect(resolveClash(DEVICE, clash.products)?.product).toBe(
        "mobiledevicecontrol",
      );
    });

  it("a request naming App Live never reaches the policy", () => {
    // R2: the user's own words settle it, and the gate checks that before any clash.
    const clash = ambiguousProducts(
      DEVICE,
      "Use App Live to open WikipediaSample on a Samsung Galaxy S23.",
    );
    expect(clash.settled).toBe("applive");
    expect(clash.products).toEqual([]);
  });

  it("stops Test Management winning a device request on one everyday word", () => {
    // `search` came from the literal UI string "Search Wikipedia box"; it used to be the
    // only word tm shared, and the intersection rule handed it the whole request.
    const products = { ...DEVICE, tm: load("tm"), tra: load("tra") };
    const verdict = ambiguousProducts(
      products,
      "Open WikipediaSample on a Samsung Galaxy S23 and check that it opens to the " +
        "Explore screen with a Search Wikipedia box. Give me a screenshot, then end the session.",
    );
    expect(verdict.settled).not.toBe("tm");
  });
});
