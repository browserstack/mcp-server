/**
 * Turn grouped caller arguments into a path, a query and a body.
 *
 * Arguments arrive GROUPED — {path_params, query, body} — because spec parameter names
 * collide across locations: four tm operations declare one name in two places (`bulk-move`
 * has `folder_id` as both a path parameter and a body field). A flat map cannot say which
 * one is meant, which is exactly why the Python side used to rename body fields `body_*`.
 * Grouping removes the collision AND the rename, so a caller sends the spec's own names.
 */

import { InvocationError } from "./index-loader.js";
import { Capability, WireConstraints, WireParam } from "./types.js";

export interface GroupedArguments {
  path_params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

export interface BoundRequest {
  path: string;
  query: Record<string, unknown>;
  body?: Record<string, unknown>;
}

/**
 * String formats worth ENFORCING, as opposed to merely publishing.
 *
 * A validator that rejects a correct value is worse than no validator: the caller cannot
 * route around it, and the request that would have worked never leaves. So this covers only
 * the formats where "wrong" is unambiguous and a legitimate value cannot trip it.
 *
 * tm declares eight formats. `date`, `date-time` and `uuid` are here. `email` and `uri` are
 * deliberately NOT — every compact regex for either rejects addresses and URLs that servers
 * accept, and being wrong in that direction blocks real work. `int64`, `float` and `binary`
 * say what a number or blob is, which `type` already covers.
 */
const FORMATS: Record<
  string,
  { test: (value: string) => boolean; want: string }
> = {
  date: {
    // A real calendar date, so 2026-02-31 fails rather than being reformatted.
    test: (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().startsWith(v),
    want: "a date (YYYY-MM-DD)",
  },
  "date-time": {
    // Permissive on purpose: offset or Z, optional fractional seconds. Tightening this
    // buys nothing and starts rejecting timestamps the product would have taken.
    test: (v) =>
      /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?$/.test(
        v,
      ) && !Number.isNaN(Date.parse(v)),
    want: "a date-time (e.g. 2026-01-31T09:30:00Z)",
  },
  uuid: {
    test: (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    want: "a UUID",
  },
};

/**
 * A declared `pattern`, compiled once, or undefined if it will not compile here.
 *
 * `u` because tm's patterns use `\p{L}`/`\p{N}`, which are a syntax error without it. A
 * pattern this engine cannot compile is SKIPPED rather than thrown: the index is generated
 * from someone else's spec, and refusing to invoke a working endpoint because its regex
 * dialect differs would be our bug landing on the caller.
 */
const patternCache = new Map<string, RegExp | undefined>();
function compiled(pattern: string): RegExp | undefined {
  if (!patternCache.has(pattern)) {
    let regex: RegExp | undefined;
    try {
      regex = new RegExp(pattern, "u");
    } catch {
      try {
        regex = new RegExp(pattern);
      } catch {
        regex = undefined;
      }
    }
    patternCache.set(pattern, regex);
  }
  return patternCache.get(pattern);
}

/**
 * Every constraint the parameter declares, checked against the COERCED value.
 *
 * Runs inside `bind`, which register.ts calls dry before the write-consent gate — so a
 * value that breaks a constraint is refused before the user is asked to approve anything,
 * and nothing reaches egress.
 *
 * `label` carries the parent name for a nested field, so the message names `test_case.name`
 * rather than a bare `name` the caller would have to go looking for.
 */
function checkConstraints(
  value: unknown,
  param: WireConstraints & { name: string; type: string },
  label = param.name,
): void {
  const fail = (what: string): never => {
    throw new InvocationError(`'${label}' ${what}`);
  };

  if (typeof value === "number") {
    if (param.minimum !== undefined && value < param.minimum)
      fail(`must be at least ${param.minimum}`);
    if (param.maximum !== undefined && value > param.maximum)
      fail(`must be at most ${param.maximum}`);
    if (param.multipleOf !== undefined && param.multipleOf > 0) {
      // Scale BOTH to integers before the modulo: 0.3 % 0.1 is 0.09999… in binary floating
      // point and would reject a value the product accepts. The scale has to cover the
      // value's decimals as well as the step's — scaling by the step alone rounds 0.25 to
      // 3 against a step of 1, which then divides evenly and lets a bad value through.
      const scale = 10 ** Math.max(decimals(param.multipleOf), decimals(value));
      if (
        Math.round(value * scale) % Math.round(param.multipleOf * scale) !==
        0
      )
        fail(`must be a multiple of ${param.multipleOf}`);
    }
  }

  if (typeof value === "string") {
    if (param.minLength !== undefined && value.length < param.minLength)
      fail(`must be at least ${param.minLength} character(s)`);
    if (param.maxLength !== undefined && value.length > param.maxLength)
      fail(`must be at most ${param.maxLength} character(s)`);
    if (param.pattern) {
      const regex = compiled(param.pattern);
      if (regex && !regex.test(value)) fail(`must match ${param.pattern}`);
    }
    const format = param.format ? FORMATS[param.format] : undefined;
    if (format && !format.test(value)) fail(`must be ${format.want}`);
  }

  if (Array.isArray(value)) {
    if (param.minItems !== undefined && value.length < param.minItems)
      fail(`must have at least ${param.minItems} item(s)`);
    if (param.maxItems !== undefined && value.length > param.maxItems)
      fail(`must have at most ${param.maxItems} item(s)`);
    if (param.uniqueItems) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) fail("must not contain duplicate items");
    }
  }
}

/** Decimal places, for scaling `multipleOf` out of floating point. */
function decimals(n: number): number {
  const text = String(n);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/**
 * The declared fields one level inside an object, or inside each item of an array.
 *
 * Only what `fields` names is checked, and an undeclared key is left alone — `fields` is a
 * projection of the shape, not a closed contract, so rejecting the rest would refuse valid
 * bodies. That is the opposite of the top level, where the full parameter list IS known and
 * an unknown name is an error.
 */
function checkFields(value: unknown, param: WireParam): void {
  if (!param.fields?.length) return;
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      continue;
    const record = item as Record<string, unknown>;
    for (const field of param.fields) {
      if (!(field.name in record)) {
        if (field.required)
          throw new InvocationError(
            `missing required parameter(s): ${param.name}.${field.name}`,
          );
        continue;
      }
      const label = `${param.name}.${field.name}`;
      const coerced = coerceType(record[field.name], field, label);
      checkConstraints(coerced, field, label);
    }
  }
}

/**
 * Check one argument against its declared schema, raising a caller-safe error.
 *
 * Type checking is also the injection defence for path parameters: most of tm's 278 path
 * parameters are `type: integer`, so a traversal attempt like `../../admin-v2` fails here
 * rather than being encoded into a URL.
 */
export function coerce(value: unknown, param: WireParam): unknown {
  const coerced = coerceType(value, param);
  checkConstraints(coerced, param);
  checkFields(coerced, param);
  return coerced;
}

function coerceType(
  value: unknown,
  param: { name: string; type: string; values?: unknown[] },
  label = param.name,
): unknown {
  const expected = param.type;
  if (expected === "object" || expected === "array") {
    // An opaque body object is passed through as given: the spec does not describe its
    // fields, so validating or reshaping it would mean inventing a contract.
    if (
      expected === "object" &&
      (typeof value !== "object" || value === null || Array.isArray(value))
    ) {
      throw new InvocationError(`'${label}' must be an object`);
    }
    if (expected === "array" && !Array.isArray(value)) {
      throw new InvocationError(`'${label}' must be a list`);
    }
    return value;
  }
  if (expected === "integer" || expected === "number") {
    const parsed = Number(String(value).trim());
    if (!Number.isFinite(parsed)) {
      throw new InvocationError(`'${label}' must be a number`);
    }
    return expected === "integer" ? Math.trunc(parsed) : parsed;
  }
  if (expected === "boolean") {
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes"].includes(text)) return true;
    if (["false", "0", "no"].includes(text)) return false;
    throw new InvocationError(`'${label}' must be true or false`);
  }
  const text = String(value);
  if (param.values && param.values.length > 0) {
    const allowed = param.values.map((v) => String(v));
    if (!allowed.includes(text)) {
      throw new InvocationError(
        `'${label}' must be one of: ${allowed.join(", ")}`,
      );
    }
  }
  return text;
}

/** Place a value at a JSON-pointer-ish path, creating the objects on the way. */
function place(
  root: Record<string, unknown>,
  pointer: string,
  value: unknown,
): void {
  const segments = pointer.split("/").filter((segment) => segment !== "");
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

const GROUPS: { group: keyof GroupedArguments; declared: keyof Capability }[] =
  [
    { group: "path_params", declared: "path_params" },
    { group: "query", declared: "query" },
    { group: "body", declared: "body" },
  ];

export function bind(
  capability: Capability,
  args: GroupedArguments,
): BoundRequest {
  let path = capability.path;
  const query: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};

  for (const { group, declared } of GROUPS) {
    const supplied = args[group] || {};
    if (
      typeof supplied !== "object" ||
      supplied === null ||
      Array.isArray(supplied)
    ) {
      throw new InvocationError(`${group} must be an object of name -> value`);
    }
    const params = (capability[declared] as WireParam[] | undefined) || [];
    const byName = new Map(params.map((param) => [param.name, param]));

    // Unknown arguments are an error rather than being dropped: silently ignoring a
    // misspelled filter would return a larger result set that looks like a correct answer.
    const unknown = Object.keys(supplied).filter((name) => !byName.has(name));
    if (unknown.length > 0) {
      throw new InvocationError(
        `unknown ${group}: ${unknown.sort().join(", ")}. accepted: ` +
          `${[...byName.keys()].sort().join(", ") || "none"}`,
      );
    }

    for (const [name, raw] of Object.entries(supplied)) {
      const param = byName.get(name)!;
      const value = coerce(raw, param);
      if (group === "path_params") {
        // Encode with nothing exempt: a `/` inside a path value would otherwise rewrite the
        // route. Schema checking already stops this for integer ids; this covers strings.
        path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
      } else if (group === "body") {
        place(body, param.json_path || `/${name}`, value);
      } else {
        query[name] = value;
      }
    }
  }

  // `required` is enforced for BODY as well as path. It was path-only on the Python side at
  // first, so a missing required body field passed silently and the product answered with a
  // 4xx that read like the caller's fault.
  const missing: string[] = [];
  for (const { group, declared } of GROUPS) {
    if (group === "query") continue;
    const supplied = args[group] || {};
    for (const param of (capability[declared] as WireParam[] | undefined) ||
      []) {
      if (param.required && !(param.name in supplied)) missing.push(param.name);
    }
  }
  if (missing.length > 0) {
    throw new InvocationError(
      `missing required parameter(s): ${missing.sort().join(", ")}`,
    );
  }

  const leftover = path.match(/\{[a-z_]+\}/gi);
  if (leftover) {
    throw new InvocationError(
      `path placeholder(s) not supplied: ${leftover.join(", ")}`,
    );
  }
  return { path, query, body: Object.keys(body).length > 0 ? body : undefined };
}
