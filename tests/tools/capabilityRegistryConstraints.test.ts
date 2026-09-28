import { describe, expect, it, vi } from "vitest";

import { bind } from "../../src/tools/capability-registry/bind.js";
import {
  Capability,
  WireParam,
} from "../../src/tools/capability-registry/types.js";

/** A capability declaring one body parameter, so each constraint is tested in isolation. */
function withBody(param: WireParam): Capability {
  return {
    name: "c",
    method: "POST",
    path: "/api/v1/things",
    mode: "write",
    entity: "thing",
    body: [param],
  } as Capability;
}

const call = (capability: Capability, body: Record<string, unknown>) =>
  bind(capability, { body });

describe("numeric constraints", () => {
  const param: WireParam = {
    name: "count",
    type: "integer",
    minimum: 1,
    maximum: 100,
  };

  it("names the field, the constraint and the bound", () => {
    expect(() => call(withBody(param), { count: 0 })).toThrow(
      "'count' must be at least 1",
    );
    expect(() => call(withBody(param), { count: 101 })).toThrow(
      "'count' must be at most 100",
    );
  });

  it("accepts the boundaries themselves", () => {
    expect(() => call(withBody(param), { count: 1 })).not.toThrow();
    expect(() => call(withBody(param), { count: 100 })).not.toThrow();
  });

  it("checks multipleOf without tripping over binary floating point", () => {
    // 0.3 % 0.1 is 0.09999999999999998 in IEEE 754; a naive modulo rejects a valid value.
    const step: WireParam = { name: "step", type: "number", multipleOf: 0.1 };
    expect(() => call(withBody(step), { step: 0.3 })).not.toThrow();
    expect(() => call(withBody(step), { step: 0.25 })).toThrow(
      "'step' must be a multiple of 0.1",
    );
  });
});

describe("string constraints", () => {
  it("enforces length with the bound in the message", () => {
    const param: WireParam = {
      name: "title",
      type: "string",
      minLength: 2,
      maxLength: 5,
    };
    expect(() => call(withBody(param), { title: "a" })).toThrow(
      "'title' must be at least 2 character(s)",
    );
    expect(() => call(withBody(param), { title: "abcdef" })).toThrow(
      "'title' must be at most 5 character(s)",
    );
    expect(() => call(withBody(param), { title: "abc" })).not.toThrow();
  });

  it("enforces a pattern, including the Unicode classes tm actually uses", () => {
    // tm's spec carries ^[\p{L}][\p{L}\p{N}_]*$ — a syntax error without the `u` flag.
    const param: WireParam = {
      name: "key",
      type: "string",
      pattern: "^[\\p{L}][\\p{L}\\p{N}_]*$",
    };
    expect(() => call(withBody(param), { key: "naïve_1" })).not.toThrow();
    expect(() => call(withBody(param), { key: "1bad" })).toThrow(
      "'key' must match",
    );
  });

  it("skips a pattern this engine cannot compile rather than refusing the call", () => {
    // The index is generated from someone else's spec. A regex dialect we cannot parse is
    // our problem, and must not stop a working endpoint from being invoked.
    const param: WireParam = {
      name: "key",
      type: "string",
      pattern: "([unclosed",
    };
    expect(() => call(withBody(param), { key: "anything" })).not.toThrow();
  });

  it("enforces the formats where wrong is unambiguous", () => {
    const date: WireParam = { name: "on", type: "string", format: "date" };
    expect(() => call(withBody(date), { on: "2026-01-31" })).not.toThrow();
    expect(() => call(withBody(date), { on: "31-01-2026" })).toThrow(
      "'on' must be a date (YYYY-MM-DD)",
    );
    // Shaped like a date but not one — must fail rather than be silently rolled over.
    expect(() => call(withBody(date), { on: "2026-02-31" })).toThrow(
      "'on' must be",
    );

    const uuid: WireParam = { name: "id", type: "string", format: "uuid" };
    expect(() =>
      call(withBody(uuid), { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }),
    ).not.toThrow();
    expect(() => call(withBody(uuid), { id: "not-a-uuid" })).toThrow(
      "'id' must be a UUID",
    );

    const when: WireParam = { name: "at", type: "string", format: "date-time" };
    expect(() =>
      call(withBody(when), { at: "2026-01-31T09:30:00Z" }),
    ).not.toThrow();
    expect(() =>
      call(withBody(when), { at: "2026-01-31T09:30:00+05:30" }),
    ).not.toThrow();
    expect(() => call(withBody(when), { at: "yesterday" })).toThrow(
      "'at' must be",
    );
  });

  it("publishes but does not enforce formats whose validators reject valid input", () => {
    // Every compact email/uri regex refuses addresses and URLs that servers accept, and a
    // false rejection cannot be worked around by the caller.
    for (const format of ["email", "uri", "int64", "binary"]) {
      const param: WireParam = { name: "v", type: "string", format };
      expect(
        () => call(withBody(param), { v: "anything at all" }),
        format,
      ).not.toThrow();
    }
  });
});

describe("array constraints", () => {
  const param: WireParam = {
    name: "ids",
    type: "array",
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
  };

  it("enforces bounds and uniqueness", () => {
    expect(() => call(withBody(param), { ids: [] })).toThrow(
      "'ids' must have at least 1 item(s)",
    );
    expect(() => call(withBody(param), { ids: [1, 2, 3, 4] })).toThrow(
      "'ids' must have at most 3 item(s)",
    );
    expect(() => call(withBody(param), { ids: [1, 1] })).toThrow(
      "'ids' must not contain duplicate items",
    );
    expect(() => call(withBody(param), { ids: [1, 2] })).not.toThrow();
  });

  it("compares items by value, so duplicate objects are caught", () => {
    const objects: WireParam = {
      name: "rows",
      type: "array",
      uniqueItems: true,
    };
    expect(() =>
      call(withBody(objects), { rows: [{ a: 1 }, { a: 1 }] }),
    ).toThrow("duplicate");
  });
});

describe("one level into fields", () => {
  const param: WireParam = {
    name: "test_case",
    type: "object",
    fields: [
      { name: "priority", type: "string", values: ["low", "high"] },
      { name: "weight", type: "integer", minimum: 1 },
      { name: "title", type: "string", required: true },
    ],
  };

  it("qualifies the message with the parent, so the caller can find the field", () => {
    expect(() =>
      call(withBody(param), { test_case: { title: "t", weight: 0 } }),
    ).toThrow("'test_case.weight' must be at least 1");
    expect(() =>
      call(withBody(param), { test_case: { title: "t", priority: "urgent" } }),
    ).toThrow("'test_case.priority' must be one of: low, high");
  });

  it("enforces a required nested field", () => {
    expect(() => call(withBody(param), { test_case: { weight: 2 } })).toThrow(
      "missing required parameter(s): test_case.title",
    );
  });

  it("leaves undeclared nested keys alone", () => {
    // `fields` is a projection of the shape, not a closed contract — unlike the top level,
    // where the full parameter list is known and an unknown name is an error.
    expect(() =>
      call(withBody(param), {
        test_case: { title: "t", nobody_declared_this: 1 },
      }),
    ).not.toThrow();
  });

  it("checks every item of an array of objects", () => {
    const rows: WireParam = {
      name: "rows",
      type: "array",
      fields: [{ name: "n", type: "integer", maximum: 10 }],
    };
    expect(() => call(withBody(rows), { rows: [{ n: 1 }, { n: 99 }] })).toThrow(
      "'rows.n' must be at most 10",
    );
  });
});

describe("compatibility with an index that declares no constraints", () => {
  it("checks nothing that is not declared", () => {
    const bare: WireParam = { name: "anything", type: "string" };
    for (const value of ["", "x".repeat(10_000), "2026-99-99", "!@#$"]) {
      expect(() => call(withBody(bare), { anything: value })).not.toThrow();
    }
  });

  it("does not inject a default onto the wire", () => {
    // Publishing the default is what stops the redundant send. Filling it in would put a
    // value the caller never chose on the request, and pin a server-side default that is
    // free to change.
    const withDefault = withBody({ name: "page", type: "integer", default: 1 });
    expect(bind(withDefault, { body: {} }).body).toBeUndefined();
    expect(bind(withDefault, { body: { page: 5 } }).body).toEqual({ page: 5 });
  });
});

describe("nothing reaches egress when a constraint fails", () => {
  it("refuses before the request is built", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { invoke } =
      await import("../../src/tools/capability-registry/resolve.js");
    const capability = withBody({ name: "count", type: "integer", maximum: 5 });

    await expect(
      invoke(
        capability,
        { body: { count: 500 } },
        "https://tm.example",
        { username: "u", accessKey: "k" },
        fetchSpy as never,
      ),
    ).rejects.toThrow("'count' must be at most 5");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

/**
 * A capability shaped like the real string-id routes: a path parameter with no pattern,
 * no enum and no format — which is what eleven enabled tm capabilities actually declare.
 */
function withPathParam(param: WireParam): Capability {
  return {
    name: "c",
    method: "PATCH",
    path: "/api/v2/projects/{project_id}/test-cases/{test_case_id}",
    mode: "write",
    entity: "test_case",
    path_params: [{ name: "project_id", type: "string" }, param],
  } as Capability;
}

describe("a path value cannot retarget the request", () => {
  const param: WireParam = { name: "test_case_id", type: "string" };
  const bindPath = (id: unknown) =>
    bind(withPathParam(param), {
      path_params: { project_id: "PR-1", test_case_id: id },
    });

  // `encodeURIComponent` leaves dots alone and `new URL()` resolves them, so `..` walked
  // up a segment and PATCH landed on the PROJECT while the human had approved editing one
  // test case — with the approval already given. Empty and `.` collapse the segment the
  // same way. None of these fail the type check: the parameter is a bare `string`.
  it.each([["..", "traversal"], [".", "current segment"], ["", "empty"], ["  ..  ", "padded traversal"]])(
    "refuses %j (%s)",
    (id) => {
      expect(() => bindPath(id)).toThrow(/not a usable path value/);
    },
  );

  it("still binds an ordinary identifier", () => {
    const bound = bind(withPathParam(param), {
      path_params: { project_id: "PR-1", test_case_id: "TC-1" },
    }) as any;
    expect(bound.path).toBe("/api/v2/projects/PR-1/test-cases/TC-1");
  });

  // A dot inside a real value is not the problem — only a segment that IS a dot run.
  it("leaves a dot inside an identifier alone", () => {
    const bound = bind(withPathParam(param), {
      path_params: { project_id: "PR-1", test_case_id: "v1.2.3" },
    }) as any;
    expect(bound.path).toBe("/api/v2/projects/PR-1/test-cases/v1.2.3");
  });
});

describe("a numeric parameter is not coerced into a different value", () => {
  const numeric: WireParam = { name: "count", type: "integer" };

  // Number("") and Number(" ") are both 0, so a blank id became id 0 and the call went to
  // whatever that resolved to.
  it.each(["", "   "])("refuses blank %j rather than reading it as 0", (v) => {
    expect(() => call(withBody(numeric), { count: v })).toThrow(/was empty/);
  });

  // Math.trunc turned "1.9" into 1 silently. An id is either exact or it is the wrong id.
  it("refuses a non-integer rather than truncating it", () => {
    expect(() => call(withBody(numeric), { count: "1.9" })).toThrow(
      /whole number/,
    );
  });

  it("still accepts an integer given as a string", () => {
    expect(call(withBody(numeric), { count: "42" })).toMatchObject({
      body: { count: 42 },
    });
  });
});
