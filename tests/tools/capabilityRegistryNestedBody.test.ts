import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bind,
  bodyKey,
  replacedFixed,
  withoutFixed,
} from "../../src/tools/capability-registry/bind.js";
import { Capability, WireParam } from "../../src/tools/capability-registry/types.js";

/**
 * The body is the JSON the API takes, and each value is matched to the field declared at
 * its position. One name declared at two depths is two fields.
 */

const MOVE: Capability = {
  name: "move_things",
  method: "POST",
  path: "/api/v1/projects/{project_id}/things/move",
  mode: "write",
  entity: "thing",
  intent: "x",
  path_params: [{ name: "project_id", type: "integer", required: true }],
  body: [
    { name: "q", type: "object" },
    { name: "folder_id", type: "integer" },
    { name: "ids", type: "array", json_path: "/thing/ids" },
    { name: "select_all", type: "boolean", json_path: "/thing/select_all" },
    {
      name: "destination_folder_id",
      type: "integer",
      json_path: "/thing/destination_folder_id",
    },
    { name: "folder_id", type: "integer", json_path: "/thing/folder_id" },
  ],
} as Capability;

const move = (body: Record<string, unknown>) =>
  bind(MOVE, { path_params: { project_id: 1 }, body }).body;

describe("one name at two depths", () => {
  it("places each value at the position it was sent at", () => {
    expect(
      move({ folder_id: 11, thing: { select_all: true, folder_id: 22 } }),
    ).toEqual({ folder_id: 11, thing: { select_all: true, folder_id: 22 } });
  });

  it("binds a top-level name to the top-level field", () => {
    expect(
      move({ folder_id: 11, select_all: true, destination_folder_id: 22 }),
    ).toEqual({
      folder_id: 11,
      thing: { select_all: true, destination_folder_id: 22 },
    });
  });

  it("accepts the dotted name as well as the nesting", () => {
    expect(move({ "thing.folder_id": 22 })).toEqual({
      thing: { folder_id: 22 },
    });
  });
});

describe("walking the body", () => {
  it("takes an object-typed field whole", () => {
    expect(move({ q: { folder_id: 5, status: "x" } })).toEqual({
      q: { folder_id: 5, status: "x" },
    });
  });

  it("refuses a nested key no field is declared at, naming its position", () => {
    expect(() => move({ thing: { selct_all: true } })).toThrow(
      /unknown body: thing\.selct_all\. accepted: .*thing\.select_all/,
    );
  });

  it("still folds spelling variants of a wrapped field", () => {
    expect(move({ selectAll: true })).toEqual({ thing: { select_all: true } });
  });

  it("labels a bad value with the position", () => {
    expect(() => move({ thing: { destination_folder_id: "x" } })).toThrow(
      "'thing.destination_folder_id' must be a number",
    );
  });

  it("reports a missing required wrapped field by its position", () => {
    const required = {
      ...MOVE,
      body: [{ name: "ids", type: "array", required: true, json_path: "/thing/ids" }],
    } as Capability;
    expect(() =>
      bind(required, { path_params: { project_id: 1 }, body: {} }),
    ).toThrow("missing required parameter(s): thing.ids");
  });
});

describe("a bare name two wrapped fields share", () => {
  const SEARCH = {
    ...MOVE,
    body: [
      { name: "custom_fields", type: "array", json_path: "/q/custom_fields" },
      { name: "custom_fields", type: "array", json_path: "/required/custom_fields" },
    ],
  } as Capability;

  it("is refused rather than given to one of them", () => {
    expect(() =>
      bind(SEARCH, { path_params: { project_id: 1 }, body: { custom_fields: [1] } }),
    ).toThrow(/unknown body: custom_fields\. accepted: q\.custom_fields, required\.custom_fields/);
  });

  it("binds each when sent at its position", () => {
    expect(
      bind(SEARCH, {
        path_params: { project_id: 1 },
        body: { q: { custom_fields: [1] }, required: { custom_fields: [2] } },
      }).body,
    ).toEqual({ q: { custom_fields: [1] }, required: { custom_fields: [2] } });
  });
});

describe("the published contract", () => {
  it("names a wrapped field by its position and drops the pointer", () => {
    const body = withoutFixed(MOVE).body as WireParam[];
    expect(body.map((param) => param.name)).toEqual([
      "q",
      "folder_id",
      "thing.ids",
      "thing.select_all",
      "thing.destination_folder_id",
      "thing.folder_id",
    ]);
    expect(body.some((param) => "json_path" in param)).toBe(false);
  });

  it("keeps plain names on a body that renames any field", () => {
    const renamed: WireParam = {
      name: "browser_name",
      type: "string",
      json_path: "/capabilities/alwaysMatch/browserName",
    };
    const sibling: WireParam = {
      name: "os",
      type: "string",
      json_path: "/capabilities/alwaysMatch/bstack:options/os",
    };
    expect(bodyKey(renamed, [renamed, sibling])).toBe("browser_name");
    expect(bodyKey(sibling, [renamed, sibling])).toBe("os");
  });

  it("reports a replaced fixed value by its position", () => {
    const fixed = {
      ...MOVE,
      body: [
        {
          name: "kind",
          type: "string",
          required: true,
          values: ["move"],
          json_path: "/thing/kind",
        },
      ],
    } as Capability;
    expect(
      replacedFixed(fixed, {
        path_params: { project_id: 1 },
        body: { thing: { kind: "copy" } },
      }),
    ).toEqual(["thing.kind"]);
  });
});

describe("the shipped indexes", () => {
  const load = (product: string) => {
    const raw = JSON.parse(
      readFileSync(`capability/${product}.capability-index.json`, "utf8"),
    );
    return raw[product] ?? raw.products[product];
  };
  const find = (product: string, name: string) =>
    load(product).capabilities.find((c: Capability) => c.name === name) as Capability;

  it("tm bulk move: a top-level folder_id is the source scope", () => {
    const bound = bind(find("tm", "bulk_move_test_cases"), {
      path_params: { project_id: 1 },
      body: { folder_id: 11, select_all: true, destination_folder_id: 22 },
    });
    expect(bound.body).toEqual({
      folder_id: 11,
      test_case: { select_all: true, destination_folder_id: 22 },
    });
  });

  it("tm bulk move: the nested body binds as sent", () => {
    const body = {
      folder_id: 11,
      test_case: { select_all: true, destination_folder_id: 22 },
    };
    expect(
      bind(find("tm", "bulk_move_test_cases"), {
        path_params: { project_id: 1 },
        body,
      }).body,
    ).toEqual(body);
  });

  it("devicecontrol create_session: the W3C body binds to the readable fields", () => {
    const bound = bind(find("devicecontrol", "create_session"), {
      body: {
        capabilities: {
          alwaysMatch: {
            browserName: "chrome",
            "bstack:options": { os: "Windows", osVersion: "11" },
          },
        },
      },
    });
    expect((bound.body as any).capabilities.alwaysMatch).toMatchObject({
      browserName: "chrome",
      "bstack:options": { os: "Windows", osVersion: "11" },
    });
  });
});
