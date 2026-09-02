/**
 * Ranking capabilities against a plain-language query.
 *
 * Ported from the Python `discover._score`, including the two properties that were each
 * fixed after a live mis-ranking:
 *
 *  * PENALTIES REORDER, THEY DO NOT EXCLUDE. `matched` is the pre-penalty term score and is
 *    what decides inclusion; `ranked` carries the preferences. Conflating them dropped 40
 *    legitimate matches outright, because a cardinality penalty took an otherwise-valid
 *    score to zero and the caller saw "no such capability".
 *  * CARDINALITY. A "list" query answered by a single-record getter sends the caller to a
 *    capability needing an id it cannot possibly have yet.
 */

import { Capability, EntityDoc, Mode, ProductIndex } from "./types.js";

const WORD = /[a-z0-9_]+/g;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "want",
  "what",
  "which",
  "with",
  "you",
]);

// Verbs that reveal what the caller means to DO. A preference, not a filter — an explicit
// `mode` argument is the filter.
const READ_VERBS = new Set([
  "list",
  "get",
  "show",
  "find",
  "fetch",
  "read",
  "count",
  "search",
  "view",
  "which",
  "how",
]);
const WRITE_VERBS = new Set([
  "create",
  "add",
  "update",
  "edit",
  "delete",
  "remove",
  "move",
  "copy",
  "archive",
  "assign",
  "restore",
  "reorder",
  "bulk",
  "set",
  "upload",
  "import",
  "clone",
]);

// Words that mean "give me many", which is what makes a single-record getter the wrong answer.
const PLURAL_INTENT = new Set([
  "list",
  "all",
  "every",
  "many",
  "count",
  "search",
  "find",
  "which",
  "each",
]);

/** Query/haystack terms. Verbs are deliberately NOT stopwords — they carry the intent. */
export function terms(text: string | undefined): string[] {
  return [...(text || "").toLowerCase().matchAll(WORD)]
    .map((match) => match[0])
    .filter((word) => !STOPWORDS.has(word));
}

export function modeHint(query: string | undefined): "" | Mode {
  const words = new Set(terms(query));
  const wantsWrite = [...words].some((word) => WRITE_VERBS.has(word));
  if (wantsWrite) return "write";
  const wantsRead = [...words].some((word) => READ_VERBS.has(word));
  return wantsRead ? "read" : "";
}

export function wantsCollection(query: string | undefined): boolean {
  return [...(query || "").toLowerCase().matchAll(WORD)].some((match) =>
    PLURAL_INTENT.has(match[0]),
  );
}

/**
 * True when a capability answers with many records rather than one.
 *
 * Pagination is the reliable signal — a paged operation is a listing by construction. The
 * plural terminal path segment is a weaker fallback for unpaged collections. (The Python
 * side used the capability NAME here; the artifact publishes no name, and the path's own
 * terminal noun carries the same signal because operationIds were derived from it.)
 */
export function isCollection(capability: Capability): boolean {
  if (capability.paginated) return true;
  const segments = capability.path
    .split("/")
    .filter((s) => s && !s.startsWith("{"));
  const tail = segments[segments.length - 1] || "";
  return tail.endsWith("s") && !tail.endsWith("ss");
}

/** Path words stand in for the capability name as the identity haystack. */
function identityText(capability: Capability): string {
  return capability.path
    .split("/")
    .filter(
      (segment) => segment && !segment.startsWith("{") && segment !== "api",
    )
    .join(" ")
    .replace(/[-_]/g, " ");
}

function score(
  capability: Capability,
  wanted: string[],
  aliases: Record<string, string[]>,
  hint: "" | Mode,
  plural: boolean,
): { matched: number; ranked: number } {
  if (wanted.length === 0) return { matched: 1, ranked: 1 };

  const haystacks: [string, number][] = [
    [identityText(capability), 6],
    [capability.entity.replace(/_/g, " "), 4],
    [(aliases[capability.entity] || []).join(" "), 4],
    [capability.intent || "", 2],
    // `returns` is scored BELOW identity, not gated on it. At parity with intent it put a
    // projects listing at #2 for "list test cases in a project" (its returns carries
    // `test_cases_count`); gating it on an identity match instead made a field reachable
    // only through returns unreachable, which is worse.
    [(capability.returns || []).join(" ").replace(/_/g, " "), 1],
    [(capability.guidance || []).join(" "), 1],
  ];

  let ranked = 0;
  for (const [text, weight] of haystacks) {
    const blob = new Set(terms(text));
    ranked += weight * wanted.filter((term) => blob.has(term)).length;
  }
  const matched = ranked;

  if (hint && capability.mode !== hint) ranked -= 20;
  else if (hint && capability.mode === hint) ranked += 6;
  if (plural) ranked += isCollection(capability) ? 8 : -8;

  return { matched, ranked };
}

/**
 * One ranked match, WITH the product it belongs to.
 *
 * Attribution is not decoration: the response tables are per product, so dereferencing a
 * hit's schemas needs to know whose tables to read. It is also what lets a caller pass
 * `product` to invokeEndpoint when two products share an endpoint — until now search
 * ranked across products and then threw away the only thing that could disambiguate them.
 */
export interface SearchHit {
  product: string;
  capability: Capability;
}

export interface SearchResult {
  hits: SearchHit[];
  truncated: boolean;
  total_matched: number;
}

export function searchCapabilities(
  products: Record<string, ProductIndex>,
  query?: string,
  options: {
    entity?: string;
    product?: string;
    mode?: Mode;
    limit?: number;
  } = {},
): SearchResult {
  const limit = options.limit && options.limit > 0 ? options.limit : 8;
  const wanted = terms(query);
  const hint = options.mode ? "" : modeHint(query);
  const plural = wantsCollection(query);

  const scored: {
    matched: number;
    ranked: number;
    product: string;
    capability: Capability;
  }[] = [];
  for (const [name, bundle] of Object.entries(products)) {
    if (options.product && name !== options.product) continue;
    const aliases: Record<string, string[]> = {};
    for (const [entity, doc] of Object.entries(bundle.entities)) {
      aliases[entity] = ((doc as EntityDoc).aliases || []) as string[];
    }
    for (const capability of bundle.capabilities) {
      if (options.entity && capability.entity !== options.entity) continue;
      if (options.mode && capability.mode !== options.mode) continue;
      const { matched, ranked } = score(
        capability,
        wanted,
        aliases,
        hint,
        plural,
      );
      if (matched > 0)
        scored.push({ matched, ranked, product: name, capability });
    }
  }
  scored.sort(
    (a, b) =>
      b.ranked - a.ranked || a.capability.path.localeCompare(b.capability.path),
  );
  return {
    hits: scored
      .slice(0, limit)
      .map(({ product, capability }) => ({ product, capability })),
    truncated: scored.length > limit,
    total_matched: scored.length,
  };
}
