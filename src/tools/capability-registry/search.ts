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
 * side used the capability NAME here. tm now publishes one, but its verbs are not
 * consistent — the endpoint that lists folders is `get_root_folders_v1` — so the path's
 * terminal noun remains the better signal.)
 */
export function isCollection(capability: Capability): boolean {
  if (capability.paginated) return true;
  const segments = capability.path
    .split("/")
    .filter((s) => s && !s.startsWith("{"));
  const tail = segments[segments.length - 1] || "";
  return tail.endsWith("s") && !tail.endsWith("ss");
}

/**
 * Does this capability's mode answer what the caller asked to DO?
 *
 * `destructive` counts as a write. It has to: `modeHint` reads "delete" and "remove" as
 * WRITE verbs, but a delete endpoint's mode is `destructive`, so a strict equality check
 * penalised every destructive capability by 20 FOR BEING A DELETE — on exactly the queries
 * that wanted one. "bulk delete test cases" scored 15.8 on terms, the highest of any missed
 * query in the eval, and still fell out of the top 8.
 *
 * That accounted for 15 of the eval's 36 misses. The mode hint exists to separate reading
 * from changing; destructive is changing.
 *
 * A read hint still refuses destructive, which is the useful half: "show me the test plans"
 * must not surface a delete.
 */
function satisfiesHint(mode: Mode, hint: Mode): boolean {
  if (hint === "write") return mode === "write" || mode === "destructive";
  return mode === hint;
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

/**
 * Path words are the identity haystack. The published `name` is deliberately NOT scored.
 *
 * That is a measured result, not an oversight. tm now names every capability, and adding
 * the name to the ranking was tried three ways against tests/fixtures/search-eval.json,
 * which the pre-names index serves 18/18:
 *
 *   folded into this field, weight 6          17/18
 *   its own field, weights 1 / 2 / 3 / 4 / 6  17 / 17 / 17 / 17 / 16
 *   only the words the path lacks, 1..6       17 / 16 / 15 / 15 / 14
 *
 * Every variant loses, for two reasons. The nouns in a name are the route restated — the
 * name is snake-cased from the operationId, itself derived from the path — so scoring them
 * again rewards verbose names for repeating themselves: `get_test_cases_for_v1_test_run`
 * displaced `create_test_result_for_test_case` on "record a pass or fail for a test case in
 * a run", putting a read above the write that answers it. And what a name adds beyond the
 * route is mostly its verb, which tm applies inconsistently (`get_root_folders_v1` lists,
 * `list_folder_test_cases_v1` also lists), so the verb is noise as often as signal.
 *
 * The query this was meant to fix, "list all projects", only went 7 -> 4 even where it
 * helped: `projects` is in 156 of 173 paths as a scope prefix, so rarity correctly values it
 * near zero and no amount of name weighting recovers it. That one is fixed instead by the
 * terminal-segment bonus in `score`, which tells "is that thing" from "is scoped by it".
 *
 * Revisit when a product ships a consistent verb convention — then the verb becomes signal.
 */
/**
 * The terminal path segment — the thing this endpoint is actually ABOUT.
 *
 * A REST path mixes two different things: the resources it is SCOPED BY, and the resource it
 * ADDRESSES. Only the last segment is the latter. See the bonus in `score` for why that
 * distinction matters and why it is applied flat rather than weighted.
 *
 * Trailing placeholders are skipped, so `/test-cases/{id}` is still about test cases.
 * Action tails (`close`, `edit`, `delete`) are kept rather than skipped: for "close a test
 * run" the tail IS the most specific thing the caller said.
 */
function resourceText(capability: Capability): string {
  const segments = capability.path
    .split("/")
    .filter((s) => s && !s.startsWith("{") && s !== "api");
  return (segments[segments.length - 1] || "").replace(/[-_]/g, " ");
}

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

/**
 * Sized to sit alongside the mode (+6) and cardinality (+8) constants, not to dwarf them.
 * The pinned eval is unchanged at every value from 2 to 14 — the bonus only ever fires on
 * queries it does not cover — so this was chosen on the wider sweep: at 10, "close a test
 * run" starts pulling `close_exploratory_session` into second place on the tail match alone.
 */
const RESOURCE_BONUS = 6;
/**
 * How much a cardinality guess is worth. It used to be 8, and it should not have been.
 *
 * `isCollection` is a GUESS read off the URL, and the index carries nothing better: of 88
 * read capabilities, zero declare an array in their response schema, and `paginated` — the
 * one signal that looks trustworthy — is true for `get_report_detail`, a single-record
 * endpoint. There is no derived cardinality in this artifact to appeal to.
 *
 * At ±8 that guess swung 16 points and buried 11 correct answers: `/test-runs/closed` and
 * `/{entity}/search` are listings whose last path segment is not a plural noun, `users-v2`
 * is plural with a version suffix in the way, and the count endpoints answer "how many"
 * with a scalar. All were penalised for what they are called.
 *
 * The fix is not a better classifier — a qualifier word-list would encode tm's route
 * conventions into generic code and rot on the next product. It is to stop betting so much
 * on an unreliable signal. Swept against the eval, holding top1 at 138 with no ceiling
 * violations: ±7 retires 1, ±6 retires 2, ±5 retires 5, ±4 retires 6. Below that it starts
 * costing more than it returns — ±3.5 retires 8 but breaks a case, ±3 breaks two.
 */
const CARDINALITY = 4;

/**
 * The mode penalty stays at 20, unlike the cardinality one — it is earned.
 *
 * Where `isCollection` is a guess off the URL, `modeHint` is measured right: across the
 * eval it agrees with the correct answer's mode 125 times and disagrees 3. A signal that
 * accurate deserves to be decisive.
 *
 * Sweeping it 20 -> 6 retires none of the three misses filed against it and regresses
 * nothing, which says the penalty is not what holds them back. It isn't: they sit at ranks
 * 41, 62 and 78 of the matched set, far below anything a constant could lift. All three
 * are vocabulary gaps wearing a mode-penalty label — "what gets removed" wants a path
 * spelled `rm-summary`, "get rid of" wants `delete`, and "the option set" wants what the
 * product calls a `dataset`. The target barely matches on TERMS; the hint is incidental.
 *
 * Left at 20 deliberately. There was no evidence for moving it, and an unjustified constant
 * is how this scorer got into trouble in the first place.
 */
const MODE_PENALTY = 20;

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
  // PHRASE. Adjacent query terms occurring together say more than the same two words
  // scattered: "test case" is one noun in this vocabulary, "test" and "case" separately
  // are two of the commonest words in the index. Scored at half the field's weight and
  // still scaled by rarity, so it sharpens an existing match rather than creating one.
  for (const [text, weight] of haystacks) {
    const blob = haystack(text);
    if (!blob) continue;
    for (let i = 0; i + 1 < wanted.length; i += 1) {
      if (blob.includes(`${wanted[i][0]} ${wanted[i + 1][0]}`)) {
        ranked += weight * 0.5 * (weights[i] + weights[i + 1]);
      }
    }
  }

  const matched = ranked;

  // THE ENDPOINT IS THAT THING, not merely scoped by it.
  //
  // A REST path mixes the resources it is SCOPED BY with the one it ADDRESSES. `projects` is
  // in 156 of tm's 173 paths but is the terminal segment in 3, so whole-corpus rarity —
  // correctly — values it near nothing, and every project-scoped listing scored the same as
  // the projects listing itself. The top 8 for "list all projects" spanned 15.9 to 14.8,
  // where +8 collection and +6 mode already account for 14: the term signal was ~1 point of
  // noise and the right answer sat 7th.
  //
  // Flat, and deliberately NOT rarity-scaled. Rarity would reintroduce the same problem in
  // reverse — a rare scope noun outranking the real target, which is exactly how a weighted
  // version of this put `/projects/{id}/folders` above `/folder/{id}/test-cases` for "tc list
  // for a folder". This asks one yes/no question instead: is the caller's own word the last
  // thing in the path?
  //
  // Equality is against the QUERY's forms, never the haystack's — the same one-directional
  // rule as containment. `projects` is in forms("projects"), so the projects listing hits;
  // `folders` is not in forms("folder"), so a folder-scoped query does not drag in the
  // folders listing.
  const tail = terms(resourceText(capability));
  if (
    tail.length &&
    wanted.some((forms) => tail.every((word) => forms.includes(word)))
  ) {
    ranked += RESOURCE_BONUS;
  }

  if (hint) ranked += satisfiesHint(capability.mode, hint) ? 6 : -MODE_PENALTY;
  if (plural) ranked += isCollection(capability) ? CARDINALITY : -CARDINALITY;

  return { matched, ranked };
}

/**
 * One ranked match, WITH the product it belongs to.
 *
 * Attribution is not decoration: the response tables are per product, so dereferencing a
 * hit's schemas needs to know whose tables to read. It is also what lets a caller pass
 * `product` to invokeCapability when two products share an endpoint — until now search
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
  /**
   * The best pre-penalty term score, and whether it is weak enough to doubt.
   *
   * A vocabulary miss does NOT look like a miss from the outside: "make a new bucket for my
   * tests" returns a full page of eight confident hits, exactly like a query that worked,
   * because containment finds *something* for `make`, `new` and `tests`. The only thing that
   * separates them is how little the match is worth.
   */
  top_matched: number;
  weak: boolean;
}

/**
 * Below this, the caller is probably not speaking the product's language.
 *
 * Measured on tm: vocabulary misses top out at 1.98–2.15 ("where do my things live", "make a
 * new bucket for my tests") while queries that work reach 6.5–12. The two ranges do NOT
 * separate cleanly — "list all projects" scores 1.58 and is nonetheless answered correctly
 * at rank 1, because `projects` is in 156 of 173 paths and worth almost nothing.
 *
 * So this is set generously and false positives are accepted, which is sound only because
 * the vocabulary block is ADDITIVE: it arrives next to the results, never instead of them.
 * Over-triggering costs ~1.5KB against a response that is routinely 38KB; under-triggering
 * costs the caller a wrong answer with no hint that it is wrong. Those are not symmetric.
 */
const WEAK_MATCH = 3;

/** One entity's caller-facing vocabulary: what it is called, and what else it is called. */
export interface VocabularyEntry {
  entity: string;
  title?: string;
  aliases?: string[];
}

/**
 * The product's vocabulary, for a caller whose words are not the product's words.
 *
 * THE ONE FAILURE LEXICAL SEARCH CANNOT FIX. "make a new bucket for my tests" wants the
 * folder-create capability, and `bucket` appears nowhere in the index — no scoring change
 * reaches it, because the word is simply absent. What CAN reach it is the caller: it is a
 * language model, and given tm's entity list it maps bucket -> folder without effort. It
 * just cannot guess the list unprompted.
 *
 * Aliases only, deliberately. They are the vocabulary map — 19 entities in ~1.5KB, against a
 * response that is routinely 38KB. The entity `key_facts` are richer prose but ten times the
 * size, and a caller who needs them can ask describeEntity once it knows which entity to ask
 * about — which is exactly what this hands over.
 */
export function vocabularyOf(
  products: Record<string, ProductIndex>,
  only?: string,
): Record<string, VocabularyEntry[]> {
  const out: Record<string, VocabularyEntry[]> = {};
  for (const [name, bundle] of Object.entries(products)) {
    if (only && name !== only) continue;
    const entries: VocabularyEntry[] = [];
    for (const [entity, doc] of Object.entries(bundle.entities || {})) {
      const aliases = ((doc as EntityDoc).aliases || []) as string[];
      entries.push({
        entity,
        ...((doc as EntityDoc).title
          ? { title: (doc as EntityDoc).title }
          : {}),
        ...(aliases.length ? { aliases } : {}),
      });
    }
    if (entries.length) out[name] = entries;
  }
  return out;
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
  const searched = Object.entries(products).filter(
    ([name]) => !options.product || name === options.product,
  );
  const aliasesByProduct: Record<string, Record<string, string[]>> = {};
  for (const [name, bundle] of searched) {
    const aliases: Record<string, string[]> = {};
    for (const [entity, doc] of Object.entries(bundle.entities)) {
      aliases[entity] = ((doc as EntityDoc).aliases || []) as string[];
    }
    aliasesByProduct[name] = aliases;
  }

  // ONE CORPUS ACROSS EVERY SEARCHED PRODUCT, not one per product.
  //
  // Measured per product, a term's rarity inverts across them: `load` appears in nearly
  // every Load Testing capability, so it scored as noise there, while it appears in 16 of
  // tm's 173 (`upload`, `download`, reached by containment), so it scored as gold there.
  // The word that identifies a product was worth least inside it, and "list load tests"
  // returned five tm results and no Load Testing ones at all.
  //
  // It is also measured against EVERY capability, not the entity- or mode-filtered subset:
  // narrowing a search must not make a common word look rare.
  const corpus = searched.flatMap(([name, bundle]) =>
    bundle.capabilities.map((capability) =>
      [
        identityText(capability),
        capability.entity,
        (aliasesByProduct[name][capability.entity] || []).join(" "),
        capability.intent || "",
        (capability.returns || []).join(" "),
        parameterText(capability),
      ]
        .map(haystack)
        .join(" "),
    ),
  );
  const weights = wanted.map((forms) => rarity(corpus, forms));

  for (const [name, bundle] of searched) {
    const aliases = aliasesByProduct[name];
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
  // Ranked order decides the page; the best TERM score decides confidence. They are
  // different questions: the mode and cardinality constants can lift a weakly-matched
  // capability to the top of a page that is entirely wrong.
  const topMatched = scored.reduce((best, s) => Math.max(best, s.matched), 0);
  return {
    hits: scored
      .slice(0, limit)
      .map(({ product, capability }) => ({ product, capability })),
    truncated: scored.length > limit,
    total_matched: scored.length,
    top_matched: topMatched,
    weak: wanted.length > 0 && topMatched < WEAK_MATCH,
  };
}
