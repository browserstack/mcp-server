/**
 * Narrowing a response the product will not narrow itself.
 *
 * invokeCapability makes one request and hands back what came off the wire. That is the
 * right default and it stays the default: a caller reasoning about a product's answer
 * should be reasoning about the product's answer. This is the declared exception.
 *
 * It exists because of `list_browsers`. `/automate/browsers.json` returns every operating
 * system, browser and version combination the account can run — 5,251 rows and 604 KB —
 * and accepts no parameters at all: `?os=Windows`, `?browser=chrome` and `?zzz=1` all come
 * back byte-identical to the bare call. Its guidance told the caller to "narrow it
 * yourself", which it had no means to do; the only way to use the capability was to not be
 * an agent, because 604 KB of JSON is most of a context window spent to learn that Chrome
 * runs on Windows 11.
 *
 * WHAT KEEPS THIS FROM BECOMING A SECOND API. Three rules, and they are the whole design:
 *
 *  1. A capability must declare `narrowable` before any of this is reachable. Nothing is
 *     applied to a capability that did not ask for it, so the untouched-response promise
 *     is intact everywhere it was intact before.
 *  2. Only the fields it names may be used, and a field outside that set is refused BY
 *     NAME with the set listed — the same way an unknown host is refused. A caller that
 *     guesses `platform` learns what the fields are instead of silently getting everything.
 *  3. The result says it was narrowed, from how many rows, and by what. A smaller answer
 *     that does not announce itself is indistinguishable from a product that returned less
 *     than it has, which is the failure this must not introduce.
 *
 * It is NOT a query language and should not grow into one. Equality, membership, distinct
 * tuples, projection, a cap. Anything a caller cannot express here is a reason to look for
 * a product endpoint that filters, not a reason to add an operator.
 */

import { Capability } from "./types.js";
import { InvocationError } from "./index-loader.js";

/** What the caller asked for. Every field is optional; an empty selection narrows nothing. */
export interface Selection {
  /**
   * Field → the value it must take, or any of several.
   *
   * Strings compare case-insensitively. The product's own spellings are not consistent —
   * `Windows` and `OS X` are capitalised, `android` and `ios` are not, in the same column
   * of the same response — so an exact match would refuse half the corpus on a technicality
   * the caller cannot see from the field name.
   */
  where?: Record<string, unknown>;
  /** Return one row per distinct combination of these fields, and nothing else. */
  distinct?: string[];
  /** Keep only these fields on each row. */
  fields?: string[];
  /** At most this many rows, applied last. */
  limit?: number;
}

export interface Narrowing {
  /** Rows the product sent. */
  from: number;
  /** Rows being handed back. */
  to: number;
  /** Echoed so the answer carries the question — a narrowed body is not self-describing. */
  by: Selection;
}

function isSelectionEmpty(selection: Selection): boolean {
  return (
    !selection.where &&
    !selection.distinct &&
    !selection.fields &&
    selection.limit === undefined
  );
}

/** The array inside a body, by the capability's declared path. */
function rowsAt(
  body: unknown,
  path: string | undefined,
): unknown[] | undefined {
  let here: unknown = body;
  for (const step of (path ?? "").split(".").filter(Boolean)) {
    if (typeof here !== "object" || here === null) return undefined;
    here = (here as Record<string, unknown>)[step];
  }
  return Array.isArray(here) ? here : undefined;
}

/** The body with its array replaced, leaving every sibling key as the product sent it. */
function withRows(
  body: unknown,
  path: string | undefined,
  rows: unknown[],
): unknown {
  const steps = (path ?? "").split(".").filter(Boolean);
  if (steps.length === 0) return rows;
  const clone: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
  };
  let here = clone;
  for (const step of steps.slice(0, -1)) {
    here[step] = { ...(here[step] as Record<string, unknown>) };
    here = here[step] as Record<string, unknown>;
  }
  here[steps[steps.length - 1]] = rows;
  return clone;
}

function sameValue(cell: unknown, wanted: unknown): boolean {
  if (typeof cell === "string" && typeof wanted === "string")
    return cell.toLowerCase() === wanted.toLowerCase();
  // `real_mobile` is true or null, and a caller who writes "true" means true.
  if (typeof cell === "boolean" && typeof wanted === "string")
    return String(cell) === wanted.toLowerCase();
  if (cell === null || cell === undefined)
    return wanted === null || wanted === "null";
  return cell === wanted;
}

function assertKnownFields(
  used: string[],
  allowed: string[],
  what: string,
): void {
  const unknown = used.filter((field) => !allowed.includes(field));
  if (unknown.length > 0)
    throw new InvocationError(
      `${what} names ${unknown.map((f) => `'${f}'`).join(", ")}, which this capability ` +
        `cannot be narrowed on. The fields it accepts are: ${allowed.join(", ")}.`,
    );
}

/**
 * Apply a selection to a response, or refuse it.
 *
 * Returns `undefined` when there is nothing to do — no selection, or a capability that
 * declares none — so the caller hands back the original body and the default holds.
 */
/**
 * Refuse a `select` the capability cannot honour — BEFORE anything is sent.
 *
 * This used to run only on the way back, inside `narrowResponse`, so a `create_session`
 * carrying a bad `select` really allocated the device and then came back as an error with
 * the session id dropped on the floor; the retry allocated a second one. It now runs with
 * the other pre-flight checks, ahead of the write-consent prompt, and `narrowResponse`
 * calls it again for the no-request path (`select` empty, or body not the declared shape).
 */
export function assertSelectable(
  capability: Capability,
  selection: Selection | undefined,
): void {
  if (!selection || isSelectionEmpty(selection)) return;
  const declared = capability.narrowable;
  if (!declared)
    throw new InvocationError(
      "that capability does not support `select`: it returns the product's response as " +
        "sent. describeCapability names the ones that do, under `narrowable`.",
    );
  const allowed = declared.fields;
  assertKnownFields(Object.keys(selection.where ?? {}), allowed, "`where`");
  assertKnownFields(selection.distinct ?? [], allowed, "`distinct`");
  assertKnownFields(selection.fields ?? [], allowed, "`fields`");
}

export function narrowResponse(
  capability: Capability,
  body: unknown,
  selection: Selection | undefined,
): { body: unknown; narrowing: Narrowing } | undefined {
  if (!selection || isSelectionEmpty(selection)) return undefined;
  assertSelectable(capability, selection);
  const declared = capability.narrowable!;

  const rows = rowsAt(body, declared.path);
  // A body that is not the shape the capability promised is handed back whole. Narrowing
  // an error payload, or a response that changed shape, would hide exactly the thing the
  // caller needs to see.
  if (!rows) return undefined;

  let out = rows;

  for (const [field, wanted] of Object.entries(selection.where ?? {})) {
    const wantedValues = Array.isArray(wanted) ? wanted : [wanted];
    out = out.filter((row) => {
      const cell = (row as Record<string, unknown>)?.[field];
      return wantedValues.some((value) => sameValue(cell, value));
    });
  }

  if (selection.distinct?.length) {
    const seen = new Set<string>();
    const unique: unknown[] = [];
    for (const row of out) {
      const picked = Object.fromEntries(
        selection.distinct.map((field) => [
          field,
          (row as Record<string, unknown>)?.[field],
        ]),
      );
      const key = JSON.stringify(picked);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(picked);
    }
    out = unique;
  } else if (selection.fields?.length) {
    out = out.map((row) =>
      Object.fromEntries(
        selection.fields!.map((field) => [
          field,
          (row as Record<string, unknown>)?.[field],
        ]),
      ),
    );
  }

  if (selection.limit !== undefined)
    out = out.slice(0, Math.max(0, selection.limit));

  return {
    body: withRows(body, declared.path, out),
    narrowing: { from: rows.length, to: out.length, by: selection },
  };
}
