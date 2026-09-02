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

/**
 * Every non-alphanumeric character separates, `_` included.
 *
 * `_` used to be a word character, which made `test_case` a single token while every
 * haystack rendered it as "test case" — so the two could never match. That is the exact
 * string `listEntities` hands back, so a caller following the documented flow searched with
 * a term guaranteed to score zero: "list test_runs" matched 19 capabilities and put an
 * admin settings endpoint first, where "list test runs" matched 103 and put the test-runs
 * listing first.
 */
const WORD = /[a-z0-9]+/g;

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
  "has",
  "have",
  "that",
  "the",
  "these",
  "this",
  "those",
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

/**
 * Query/haystack terms. Verbs are deliberately NOT stopwords — they carry the intent.
 *
 * camelCase is split before lowercasing, so `testRunId`, `test_run_id` and `test run id`
 * all tokenize alike.
 */
export function terms(text: string | undefined): string[] {
  return [
    ...(text || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .matchAll(WORD),
  ]
    .map((match) => match[0])
    .filter((word) => !STOPWORDS.has(word));
}

/**
 * A term plus its naive singular variants.
 *
 * QUERY SIDE ONLY, which is what makes this cheap and safe. Matching is one-directional
 * substring containment, so indexed `attachments` already contains a query of `attachment`;
 * only the reverse — a plural query against singular text — needs help. Stemming the
 * indexed side too would mean rewriting the product's own vocabulary to guess at English,
 * for no additional match.
 */
export function termForms(term: string): string[] {
  const forms = [term];
  // A stripped form must still be three characters. `has` -> `ha` matched more than half
  // the surface as a substring and pushed a correct answer out of the top 8 entirely;
  // short fragments are noise, not variants.
  const add = (form: string) => {
    if (form.length >= 3) forms.push(form);
  };
  if (term.endsWith("es")) add(term.slice(0, -2));
  if (term.endsWith("s") && !term.endsWith("ss")) add(term.slice(0, -1));
  return forms;
}

/** A haystack as one lowercased, space-separated string, ready for containment tests. */
function haystack(text: string | undefined): string {
  return terms(text).join(" ");
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

/** Everything a caller might say that lives on a parameter rather than in the prose. */
function parameterText(capability: Capability): string {
  const parts: string[] = [];
  for (const group of [
    capability.path_params,
    capability.query,
    capability.body,
  ]) {
    for (const param of group || []) {
      parts.push(param.name);
      if (param.description) parts.push(param.description);
      if (param.values) parts.push(param.values.map(String).join(" "));
    }
  }
  return parts.join(" ");
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

/**
 * How much one term is worth, by how rare it is.
 *
 * Containment made every project-scoped endpoint match the term `project` — ~150 of tm's
 * 173 capabilities — so that word carried as much weight as `access`, which appears in
 * exactly one. Rarity is what separates them: a term matching everything scores near zero,
 * a term matching one capability scores near one.
 *
 * This is the IDF idea alone, not BM25. The term-frequency saturation and length
 * normalisation BM25 adds would rescale every score, and the mode and cardinality
 * adjustments below are absolute constants fitted against live mis-rankings. Bounding the
 * factor to 0..1 keeps those constants meaningful.
 */
function rarity(documents: string[], forms: string[]): number {
  let df = 0;
  for (const text of documents) {
    if (forms.some((form) => text.includes(form))) df += 1;
  }
  const total = documents.length || 1;
  return Math.log((total + 1) / (df + 1)) / Math.log(total + 1);
}

function score(
  capability: Capability,
  wanted: string[][],
  weights: number[],
  aliases: Record<string, string[]>,
  hint: "" | Mode,
  plural: boolean,
): { matched: number; ranked: number } {
  if (wanted.length === 0) return { matched: 1, ranked: 1 };

  const haystacks: [string, number][] = [
    [identityText(capability), 6],
    [capability.entity, 4],
    [(aliases[capability.entity] || []).join(" "), 4],
    [capability.intent || "", 2],
    // `returns` is scored BELOW identity, not gated on it. At parity with intent it put a
    // projects listing at #2 for "list test cases in a project" (its returns carries
    // `test_cases_count`); gating it on an identity match instead made a field reachable
    // only through returns unreachable, which is worse.
    [(capability.returns || []).join(" "), 1],
    [(capability.guidance || []).join(" "), 1],
    // Parameter names, their descriptions, and their enum values — 330 descriptions and 34
    // value lists that the artifact already carries and nothing was reading. The vocabulary
    // a caller uses is often the value they mean to send: `pass` and `fail` appear nowhere
    // else in the index, only as the `status` enum on the test-result writes.
    [parameterText(capability), 1],
  ];

  // CONTAINMENT, not set membership. A query of `attachment` has to reach an endpoint whose
  // path says `attachments`; under exact token equality it did not, and that endpoint fell
  // out of the results entirely. A term scores its field once however many forms match.
  let ranked = 0;
  for (const [text, weight] of haystacks) {
    const blob = haystack(text);
    if (!blob) continue;
    for (let i = 0; i < wanted.length; i += 1) {
      if (wanted[i].some((form) => blob.includes(form)))
        ranked += weight * weights[i];
    }
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
  // Forms are computed once per query, not per capability: 173 capabilities x 6 haystacks
  // would otherwise rebuild the same handful of strings a thousand times.
  const wanted = terms(query).map(termForms);
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
    // Rarity is measured once per product against EVERY capability, not against the
    // filtered subset — narrowing by entity must not make a common word look rare.
    const corpus = bundle.capabilities.map((capability) =>
      [
        identityText(capability),
        capability.entity,
        (aliases[capability.entity] || []).join(" "),
        capability.intent || "",
        (capability.returns || []).join(" "),
        parameterText(capability),
      ]
        .map(haystack)
        .join(" "),
    );
    const weights = wanted.map((forms) => rarity(corpus, forms));

    for (const capability of bundle.capabilities) {
      if (options.entity && capability.entity !== options.entity) continue;
      if (options.mode && capability.mode !== options.mode) continue;
      const { matched, ranked } = score(
        capability,
        wanted,
        weights,
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
