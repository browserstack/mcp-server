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
import { Capability, WireParam } from "./types.js";

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
 * Check one argument against its declared schema, raising a caller-safe error.
 *
 * Type checking is also the injection defence for path parameters: most of tm's 278 path
 * parameters are `type: integer`, so a traversal attempt like `../../admin-v2` fails here
 * rather than being encoded into a URL.
 */
export function coerce(value: unknown, param: WireParam): unknown {
  const expected = param.type;
  if (expected === "object" || expected === "array") {
    // An opaque body object is passed through as given: the spec does not describe its
    // fields, so validating or reshaping it would mean inventing a contract.
    if (
      expected === "object" &&
      (typeof value !== "object" || value === null || Array.isArray(value))
    ) {
      throw new InvocationError(`'${param.name}' must be an object`);
    }
    if (expected === "array" && !Array.isArray(value)) {
      throw new InvocationError(`'${param.name}' must be a list`);
    }
    return value;
  }
  if (expected === "integer" || expected === "number") {
    const parsed = Number(String(value).trim());
    if (!Number.isFinite(parsed)) {
      throw new InvocationError(`'${param.name}' must be a number`);
    }
    return expected === "integer" ? Math.trunc(parsed) : parsed;
  }
  if (expected === "boolean") {
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes"].includes(text)) return true;
    if (["false", "0", "no"].includes(text)) return false;
    throw new InvocationError(`'${param.name}' must be true or false`);
  }
  const text = String(value);
  if (param.values && param.values.length > 0) {
    const allowed = param.values.map((v) => String(v));
    if (!allowed.includes(text)) {
      throw new InvocationError(
        `'${param.name}' must be one of: ${allowed.join(", ")}`,
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
