/**
 * Telling a record apart from the envelope around it, and what may be published when the
 * product declares no schema at all.
 *
 * Ported from the Python side, where every rule here was learned from a live failure.
 */

/** Field names that describe the RESPONSE rather than a record. */
const ENVELOPE_NAMES = new Set([
  "success", "status_code", "self", "info", "meta", "errors", "error", "message",
  "page", "page_size", "per_page", "prev", "next", "count", "total", "total_count",
  "current_page", "last_page", "has_more",
]);

const ENVELOPE_PATTERNS = [/^total(_|$)/, /_pages?$/, /^(has|is)_/, /^empty(_|$)/];

export function isEnvelopeField(name: string): boolean {
  const lowered = (name || "").trim().toLowerCase();
  if (ENVELOPE_NAMES.has(lowered)) return true;
  return ENVELOPE_PATTERNS.some((pattern) => pattern.test(lowered));
}

/** The subset of a declared `returns` that could plausibly be on a row. */
export function rowFields(returns: string[] | undefined): string[] {
  return (returns || []).filter((name) => !isEnvelopeField(name));
}

/**
 * Rows found by SHAPE, not by name.
 *
 * A hardcoded key list was wrong and quietly so: tm uses 30 distinct row-key names across
 * its responses (`histories`, `attachments`, `steps`, `path_folders`, `duplicates`, …), and
 * a list of 13 missed 24 of them over 35 operations.
 */
const PREFERRED_ITEM_KEYS = ["items", "projects", "test_cases", "data", "results", "folders",
  "test_runs", "test_plans", "plans", "reports", "datasets"];

/** Object properties that describe the response, so a lone row is never mistaken for one. */
const ENVELOPE_OBJECT_KEYS = new Set([
  "info", "meta", "links", "pagination", "page_info", "errors", "error", "self", "_links",
]);

const TOTAL_KEYS = ["total", "total_count", "count"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function itemsOf(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) return [];

  const candidates = new Map<string, Record<string, unknown>[]>();
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value) && value.some(isRecord)) {
      candidates.set(key, value.filter(isRecord));
    }
  }
  if (candidates.size > 0) {
    for (const key of PREFERRED_ITEM_KEYS) {
      const hit = candidates.get(key);
      if (hit) return hit;
    }
    return candidates.values().next().value as Record<string, unknown>[];
  }

  // ANY array-valued property marks the row LOCATION, so an empty one is a genuine empty
  // answer. "no rows" must stay distinguishable from "this shape has no rows in it".
  if (Object.values(body).some((value) => Array.isArray(value))) return [];

  // A SINGLE-RECORD RESPONSE IS ONE ROW. Without this, every stats/summary/detail read came
  // back ok:true, count:0, items:[] — the worst available failure, because it is not an
  // error: the product answered fully and the resolver could not see it.
  const nested = Object.entries(body).filter(
    ([key, value]) => isRecord(value) && Object.keys(value).length > 0 &&
      !ENVELOPE_OBJECT_KEYS.has(key),
  );
  if (nested.length === 1) return [nested[0][1] as Record<string, unknown>];
  return [body];
}

/** Declared total, if the envelope carries one. tm puts it under `info`. */
export function totalOf(body: unknown): number | undefined {
  if (!isRecord(body)) return undefined;
  const containers = [body.info, body.meta, body];
  for (const container of containers) {
    if (!isRecord(container)) continue;
    for (const key of TOTAL_KEYS) {
      const value = container[key];
      if (typeof value === "number" && Number.isInteger(value)) return value;
    }
  }
  return undefined;
}

// ---- discovery mode ---------------------------------------------------------------
//
// `returns` is an allowlist, which is the right default. But 32 of tm's 173 operations
// declare a bare `{type: object}` response, so there is no field name to allowlist and the
// capability would be excluded — 19% of the surface, including "list test plans". The
// choice is not "safe capability vs unsafe capability", it is "discovered shape vs no
// capability at all". Two limits make it acceptable, and both are load-bearing:
//
//   * SCALARS ONLY — a nested object is never expanded, which contains the blast radius of
//     an unknown field. The harness records that `assignee` expands to email / full_name /
//     browserstack_user_id and that custom-field `field_values` echo signed URLs; both are
//     objects, so neither can travel this path.
//   * A NAME DENYLIST for the scalars that remain.
const SENSITIVE_MARKERS = [
  "token", "secret", "password", "access_key", "api_key", "apikey", "private",
  "credential", "signature", "email", "phone", "browserstack_user_id", "session_id",
];
const SENSITIVE_EXACT = new Set(["user_id", "group_id"]);

/** A row is a record, not a table dump. */
export const MAX_DISCOVERED_FIELDS = 24;

export function isSensitiveField(name: string): boolean {
  const lowered = (name || "").toLowerCase();
  if (SENSITIVE_EXACT.has(lowered)) return true;
  return SENSITIVE_MARKERS.some((marker) => lowered.includes(marker));
}

export function discoveredFields(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row || {})) {
    if (value !== null && typeof value === "object") continue;   // scalars only
    if (isSensitiveField(name) || isEnvelopeField(name)) continue;
    out[name] = value;
    if (Object.keys(out).length === MAX_DISCOVERED_FIELDS) break;
  }
  return out;
}

/** Keep only the declared fields, or the discovered scalars when nothing is declared. */
export function projectRow(
  row: Record<string, unknown>,
  returns: string[] | undefined,
  discover: boolean,
): Record<string, unknown> {
  if (returns && returns.length > 0) {
    const out: Record<string, unknown> = {};
    for (const name of returns) if (name in row) out[name] = row[name];
    return out;
  }
  return discover ? discoveredFields(row) : {};
}
