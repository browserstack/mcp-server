import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bind,
  normalise,
  withoutFixed,
} from "../../src/tools/capability-registry/bind.js";

// A name that resolves to exactly one declared parameter is that parameter.
//
// About 80 customer invocations in a fortnight were refused over the name alone:
// `sessionId` for `session_id`, `elementId` for `element_id`, a path parameter sent in
// the body, `selector` and `strategy` for WebDriver's `value` and `using`. The refusal
// quoted the right name back, so the retry was the same call with one word changed.
// bind now makes that change itself, and still refuses what is genuinely unknown.

const NAVIGATE = {
  name: "navigate_to",
  method: "POST",
  path: "/wd/hub/session/{session_id}/url",
  mode: "write",
  entity: "page",
  intent: "Open a URL.",
  path_params: [{ name: "session_id", type: "string", required: true }],
  body: [{ name: "url", type: "string", required: true }],
} as const;

const ATTRIBUTE = {
  name: "get_element_attribute",
  method: "GET",
  path: "/wd/hub/session/{session_id}/element/{element_id}/attribute/{name}",
  mode: "read",
  entity: "page",
  intent: "Read an attribute.",
  path_params: [
    { name: "session_id", type: "string", required: true },
    { name: "element_id", type: "string", required: true },
    { name: "name", type: "string", required: true, aliases: ["attribute"] },
  ],
} as const;

const FIND = {
  name: "find_element",
  method: "POST",
  path: "/wd/hub/session/{session_id}/element",
  mode: "read",
  entity: "page",
  intent: "Find an element.",
  path_params: [{ name: "session_id", type: "string", required: true }],
  body: [
    {
      name: "using",
      type: "string",
      required: true,
      values: ["id", "xpath"],
      aliases: ["strategy"],
    },
    { name: "value", type: "string", required: true, aliases: ["selector"] },
  ],
} as const;

const KEYED = {
  name: "set_fields",
  method: "POST",
  path: "/fields",
  mode: "write",
  entity: "page",
  intent: "Set custom fields by id.",
  body: [{ name: "{field_id}", type: "any" }],
} as const;

const cap = (c: unknown) => c as never;

describe("spelling", () => {
  it("folds camelCase to the declared snake_case", () => {
    const out = bind(cap(NAVIGATE), {
      path_params: { sessionId: "s1" },
      body: { url: "https://example.com" },
    });
    expect(out.path).toBe("/wd/hub/session/s1/url");
  });

  it("folds kebab-case and odd capitalisation too", () => {
    expect(
      normalise(cap(NAVIGATE), { path_params: { "session-id": "s1" } }),
    ).toEqual({ path_params: { session_id: "s1" } });
    expect(
      normalise(cap(NAVIGATE), { path_params: { Session_ID: "s1" } }),
    ).toEqual({ path_params: { session_id: "s1" } });
  });
});

describe("placement", () => {
  it("moves a path parameter sent in the body", () => {
    const out = bind(cap(NAVIGATE), {
      body: { session_id: "s1", url: "https://example.com" },
    });
    expect(out.path).toBe("/wd/hub/session/s1/url");
    expect(out.body).toEqual({ url: "https://example.com" });
  });

  it("moves and folds in one step", () => {
    const out = bind(cap(NAVIGATE), {
      body: { sessionId: "s1", url: "https://example.com" },
    });
    expect(out.path).toBe("/wd/hub/session/s1/url");
    expect(out.body).toEqual({ url: "https://example.com" });
  });

  it("moves a path parameter sent as a query", () => {
    const out = bind(cap(ATTRIBUTE), {
      path_params: { session_id: "s1", element_id: "e1" },
      query: { name: "href" },
    });
    expect(out.path).toBe("/wd/hub/session/s1/element/e1/attribute/href");
    expect(out.query).toEqual({});
  });
});

describe("aliases", () => {
  it("takes selector and strategy as value and using", () => {
    const out = bind(cap(FIND), {
      path_params: { session_id: "s1" },
      body: { strategy: "xpath", selector: "//button" },
    });
    expect(out.body).toEqual({ using: "xpath", value: "//button" });
  });

  it("takes attribute for the attribute's name, from the body", () => {
    const out = bind(cap(ATTRIBUTE), {
      path_params: { session_id: "s1", element_id: "e1" },
      body: { attribute: "href" },
    });
    expect(out.path).toBe("/wd/hub/session/s1/element/e1/attribute/href");
    expect(out.body).toBeUndefined();
  });

  it("are withheld from the contract", () => {
    const body = withoutFixed(cap(FIND)).body!;
    expect(body.map((p) => p.name)).toEqual(["using", "value"]);
    for (const p of body)
      expect((p as { aliases?: unknown }).aliases).toBeUndefined();
  });
});

describe("what stays refused", () => {
  it("a name that resolves to nothing", () => {
    expect(() =>
      bind(cap(NAVIGATE), {
        path_params: { session_id: "s1" },
        body: { url: "https://example.com", wait: true },
      }),
    ).toThrow(/unknown body: wait\. accepted: url/);
  });

  it("the same parameter sent twice under two spellings", () => {
    // Folding would make one value silently win; the refusal names the stray.
    expect(() =>
      bind(cap(NAVIGATE), {
        path_params: { session_id: "s1", sessionId: "s2" },
        body: { url: "https://example.com" },
      }),
    ).toThrow(/unknown path_params: sessionId/);
  });

  it("keys of a map-valued body, which are not misspellings", () => {
    const out = bind(cap(KEYED), { body: { fieldId: 1, "x-y": 2 } });
    expect(out.body).toEqual({ fieldId: 1, "x-y": 2 });
  });
});

describe("the shipped indexes", () => {
  const load = (product: string) =>
    JSON.parse(
      readFileSync(
        resolve(__dirname, `../../capability/${product}.capability-index.json`),
        "utf8",
      ),
    )[product];
  const find = (product: string, name: string) =>
    load(product).capabilities.find((c: { name: string }) => c.name === name);

  it("bind the refused calls from the report as they were sent", () => {
    for (const product of ["devicecontrol", "mobiledevicecontrol"]) {
      // "unknown body: selector, strategy. accepted: using, value"
      const strategy =
        product === "devicecontrol" ? "css selector" : "accessibility id";
      const found = bind(find(product, "find_element"), {
        path_params: { session_id: "s1" },
        body: { strategy, selector: "login" },
      });
      expect(found.body, product).toEqual({ using: strategy, value: "login" });
      // "unknown body: attribute. accepted: none" / "unknown query: name. accepted: none"
      for (const sent of [
        { body: { attribute: "href" } },
        { body: { name: "href" } },
        { query: { name: "href" } },
      ]) {
        const read = bind(find(product, "get_element_attribute"), {
          path_params: { session_id: "s1", element_id: "e1" },
          ...sent,
        });
        expect(read.path, `${product} ${JSON.stringify(sent)}`).toBe(
          "/wd/hub/session/s1/element/e1/attribute/href",
        );
      }
      // "unknown path_params: sessionId. accepted: session_id"
      const shot = bind(find(product, "take_screenshot"), {
        path_params: { sessionId: "s1" },
      });
      expect(shot.path, product).toBe("/wd/hub/session/s1/screenshot");
      // "unknown body: session_id. accepted: none"
      const shot2 = bind(find(product, "take_screenshot"), {
        body: { session_id: "s1" },
      });
      expect(shot2.path, product).toBe("/wd/hub/session/s1/screenshot");
      // "unknown body: elementId. accepted: none"
      const text = bind(find(product, "get_element_text"), {
        path_params: { session_id: "s1" },
        body: { elementId: "e1" },
      });
      expect(text.path, product).toBe("/wd/hub/session/s1/element/e1/text");
    }
  });
});
