import { describe, expect, it } from "vitest";
import { narrowResponse } from "../../src/tools/capability-registry/narrow.js";
import { InvocationError } from "../../src/tools/capability-registry/index-loader.js";
import { Capability } from "../../src/tools/capability-registry/types.js";

// Narrowing exists for one shape of endpoint: one that returns everything and filters
// nothing. These tests pin the three rules that keep it from becoming a query language —
// opt-in, fields declared, and the narrowing reported — plus the cases where it must
// decline to touch the body at all.

const ROWS = [
  {
    os: "Windows",
    os_version: "11",
    browser: "chrome",
    browser_version: "131.0",
    device: null,
    real_mobile: null,
  },
  {
    os: "Windows",
    os_version: "11",
    browser: "chrome",
    browser_version: "130.0",
    device: null,
    real_mobile: null,
  },
  {
    os: "Windows",
    os_version: "10",
    browser: "firefox",
    browser_version: "133.0",
    device: null,
    real_mobile: null,
  },
  {
    os: "OS X",
    os_version: "Sequoia",
    browser: "safari",
    browser_version: "18.0",
    device: null,
    real_mobile: null,
  },
  {
    os: "ios",
    os_version: "26",
    browser: "chromium",
    browser_version: null,
    device: "iPhone 17",
    real_mobile: true,
  },
];

const FIELDS = [
  "os",
  "os_version",
  "browser",
  "browser_version",
  "device",
  "real_mobile",
];

const browsers = {
  name: "list_browsers",
  method: "GET",
  path: "/automate/browsers.json",
  mode: "read",
  entity: "browser",
  narrowable: { fields: FIELDS },
} as Capability;

const plain = {
  name: "list_things",
  method: "GET",
  path: "/things",
  mode: "read",
  entity: "thing",
} as Capability;

const rowsOf = (r: ReturnType<typeof narrowResponse>) =>
  r!.body as Record<string, unknown>[];

describe("a capability must opt in", () => {
  it("refuses `select` on one that did not", () => {
    expect(() =>
      narrowResponse(plain, ROWS, { where: { os: "Windows" } }),
    ).toThrow(InvocationError);
  });

  it("says where the ones that do are named", () => {
    expect(() => narrowResponse(plain, ROWS, { limit: 1 })).toThrow(
      /describeCapability.*narrowable/s,
    );
  });

  it("does nothing at all without a selection", () => {
    expect(narrowResponse(browsers, ROWS, undefined)).toBeUndefined();
    expect(narrowResponse(browsers, ROWS, {})).toBeUndefined();
  });
});

describe("only the declared fields", () => {
  for (const [label, selection] of [
    ["where", { where: { platform: "Windows" } }],
    ["distinct", { distinct: ["platform"] }],
    ["fields", { fields: ["platform"] }],
  ] as const)
    it(`refuses an undeclared field in ${label}, by name and with the set`, () => {
      // A caller that guesses learns the vocabulary instead of silently getting everything.
      expect(() => narrowResponse(browsers, ROWS, selection)).toThrow(
        /'platform'.*os, os_version, browser, browser_version, device, real_mobile/s,
      );
    });
});

describe("what it actually does", () => {
  it("filters on equality", () => {
    const out = narrowResponse(browsers, ROWS, {
      where: { browser: "chrome" },
    })!;
    expect(out.narrowing).toEqual({
      from: 5,
      to: 2,
      by: { where: { browser: "chrome" } },
    });
    expect(rowsOf(out).every((r) => r.browser === "chrome")).toBe(true);
  });

  it("matches a string case-insensitively, because the product's own column is not consistent", () => {
    // `Windows` and `OS X` are capitalised, `android` and `ios` are not, in one column.
    expect(
      narrowResponse(browsers, ROWS, { where: { os: "windows" } })!.narrowing
        .to,
    ).toBe(3);
    expect(
      narrowResponse(browsers, ROWS, { where: { os: "IOS" } })!.narrowing.to,
    ).toBe(1);
  });

  it("accepts several values for one field", () => {
    const out = narrowResponse(browsers, ROWS, {
      where: { browser: ["safari", "chromium"] },
    })!;
    expect(out.narrowing.to).toBe(2);
  });

  it("reads real_mobile written as a string, which is how it arrives from a model", () => {
    expect(
      narrowResponse(browsers, ROWS, { where: { real_mobile: "true" } })!
        .narrowing.to,
    ).toBe(1);
  });

  it("matches a null cell, so `which rows have no device` is askable", () => {
    expect(
      narrowResponse(browsers, ROWS, { where: { device: null } })!.narrowing.to,
    ).toBe(4);
  });

  it("returns distinct combinations and nothing else", () => {
    const out = narrowResponse(browsers, ROWS, {
      distinct: ["os", "browser"],
    })!;
    expect(rowsOf(out)).toEqual([
      { os: "Windows", browser: "chrome" },
      { os: "Windows", browser: "firefox" },
      { os: "OS X", browser: "safari" },
      { os: "ios", browser: "chromium" },
    ]);
  });

  it("projects fields without deduplicating", () => {
    const out = narrowResponse(browsers, ROWS, { fields: ["browser"] })!;
    expect(rowsOf(out)).toHaveLength(5);
    expect(rowsOf(out)[0]).toEqual({ browser: "chrome" });
  });

  it("caps with limit, last", () => {
    const out = narrowResponse(browsers, ROWS, {
      where: { os: "Windows" },
      limit: 2,
    })!;
    expect(out.narrowing).toMatchObject({ from: 5, to: 2 });
  });

  it("combines where and distinct, which is the shape that makes this worth having", () => {
    const out = narrowResponse(browsers, ROWS, {
      where: { os: "Windows", browser: "chrome" },
      distinct: ["browser_version"],
    })!;
    expect(rowsOf(out)).toEqual([
      { browser_version: "131.0" },
      { browser_version: "130.0" },
    ]);
  });
});

describe("the answer says it was narrowed", () => {
  it("reports the row count it started from and the selection used", () => {
    const by = { where: { os: "Windows" }, distinct: ["browser"] };
    const out = narrowResponse(browsers, ROWS, by)!;
    // A smaller answer that does not announce itself cannot be told apart from a product
    // that returned less than it has.
    expect(out.narrowing.from).toBe(5);
    expect(out.narrowing.to).toBe(2);
    expect(out.narrowing.by).toEqual(by);
  });
});

describe("bodies it declines to touch", () => {
  it("hands back a body that is not an array", () => {
    expect(
      narrowResponse(browsers, { message: "Unauthorized" }, { limit: 1 }),
    ).toBeUndefined();
  });

  it("finds an array nested under a declared path and keeps its siblings", () => {
    const nested = {
      ...browsers,
      narrowable: { fields: FIELDS, path: "data.rows" },
    } as Capability;
    const body = { info: { next: null }, data: { rows: ROWS, total: 5 } };
    const out = narrowResponse(nested, body, { where: { browser: "safari" } })!;
    expect(out.narrowing.to).toBe(1);
    const got = out.body as typeof body;
    expect(got.info).toEqual({ next: null });
    expect(got.data.total).toBe(5);
    expect(got.data.rows).toHaveLength(1);
    // and the original is untouched
    expect(body.data.rows).toHaveLength(5);
  });

  it("hands back a body whose declared path is not there", () => {
    const nested = {
      ...browsers,
      narrowable: { fields: FIELDS, path: "data.rows" },
    } as Capability;
    expect(narrowResponse(nested, { data: {} }, { limit: 1 })).toBeUndefined();
  });
});
