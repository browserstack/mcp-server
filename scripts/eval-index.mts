/**
 * What does this index change cost the ranker? (L2 diagnosis tool)
 *
 * The Vitest gate (tests/tools/indexEval.test.ts) tells you THAT a case went past its
 * maxRank. This tells you BY HOW MUCH and WHICH new capabilities did it, which is the
 * difference between a number to argue about and a list to act on.
 *
 * It reads the SHIPPED index. It exists because of a real miss: three commits took tm from
 * 173 to 218 capabilities while the ranking test read a frozen 173-entry copy. The suite was
 * green against an index nobody ships.
 *
 *   npx tsx scripts/eval-index.mts                                  # every product, local
 *   npx tsx scripts/eval-index.mts --product tm --profile remote
 *   npx tsx scripts/eval-index.mts --product tm --against main      # a git ref, or a file
 *   npx tsx scripts/eval-index.mts --product tra --fixture /tmp/draft.json
 *   npx tsx scripts/eval-index.mts --coverage                       # capabilities with no case
 *   npx tsx scripts/eval-index.mts --guard --against origin/main    # CI: L2 fixture rules
 *
 * With `--against`, the reference is scored too, with three rows: the reference, the
 * CONTROL (current minus everything new since the reference), and the current index. If the
 * control does not reproduce the reference, something other than the additions changed,
 * and the blame list is not trustworthy.
 *
 * Exit code 1: a case is past its maxRank (eval), the coverage check fails (--coverage), or
 * a fixture rule is broken (--guard).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

import {
  ALLOWLIST_FILE,
  ROOT,
  SEARCH_EVAL_DIR,
  coveredNames,
  guardProblems,
  loadRegistry,
  loadSearchFixtures,
  rankIn,
  readJson,
  searchableNames,
  shippedIndexFiles,
  type Allowlist,
  type EvalCase,
  type EvalFixture,
  type Profile,
} from "./lib/index-eval.js";
import type {
  Capability,
  ProductIndex,
} from "../src/tools/capability-registry/types.js";

// ---- arguments ----

const args = process.argv.slice(2);
const opt = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const against = opt("--against");
const profile = (opt("--profile") ?? "local") as Profile;
if (profile !== "local" && profile !== "remote") {
  console.error(`--profile must be local or remote, not ${profile}`);
  process.exit(2);
}

// ---- helpers ----

/** The product object, however the envelope is shaped (released vs pre-release). */
function productOf(doc: any): ProductIndex {
  if (doc.products) return Object.values(doc.products)[0] as ProductIndex;
  const key = Object.keys(doc).find(
    (k) =>
      !["schema_version", "version", "build_id", "harness_commit"].includes(k),
  )!;
  return doc[key] as ProductIndex;
}

/** A file at a git ref, or undefined when the ref has no such file. */
function gitShow(ref: string, file: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

/** A file path, or a git ref to read the product's shipped index from. */
function loadReference(
  product: string,
  ref: string,
): { doc: any; label: string } {
  if (existsSync(ref)) {
    return { doc: JSON.parse(readFileSync(ref, "utf8")), label: ref };
  }
  const raw = gitShow(ref, `capability/${product}.capability-index.json`);
  if (!raw)
    throw new Error(
      `${ref} has no capability/${product}.capability-index.json`,
    );
  return { doc: JSON.parse(raw), label: `git:${ref}` };
}

interface Score {
  caps: number;
  top1: number;
  top3: number;
  top8: number;
  missed: number;
  over: number;
  regressions: { q: string; want: number; got: number | "miss" }[];
}

function score(
  products: Record<string, ProductIndex>,
  product: string,
  cases: EvalCase[],
): Score {
  const s: Score = {
    caps: products[product]?.capabilities.length ?? 0,
    top1: 0,
    top3: 0,
    top8: 0,
    missed: 0,
    over: 0,
    regressions: [],
  };
  for (const entry of cases) {
    const rank = rankIn(products, product, entry).rank || Infinity;
    if (rank === 1) s.top1++;
    if (rank <= 3) s.top3++;
    if (rank <= 8) s.top8++;
    else s.missed++;
    if (entry.maxRank && rank > entry.maxRank) {
      s.over++;
      s.regressions.push({
        q: entry.q,
        want: entry.maxRank,
        got: rank === Infinity ? "miss" : rank,
      });
    }
  }
  return s;
}

const row = (label: string, s: Score) =>
  `${label.padEnd(38)} ${String(s.caps).padStart(4)}  ${String(s.top1).padStart(4)} ${String(s.top3).padStart(4)} ${String(s.top8).padStart(4)}  ${String(s.missed).padStart(4)}  ${String(s.over).padStart(4)}`;

/** The same products, with one product's capabilities replaced. */
function withCapabilities(
  products: Record<string, ProductIndex>,
  product: string,
  capabilities: Capability[],
  bundle: ProductIndex = products[product],
): Record<string, ProductIndex> {
  return { ...products, [product]: { ...bundle, capabilities } };
}

// ---- eval ----

function evalProduct(
  products: Record<string, ProductIndex>,
  product: string,
  fixture: EvalFixture,
): number {
  const shippedDoc = readJson<any>(shippedIndexFiles()[product]);
  const shipped = products[product];
  const cases = fixture.cases;

  console.log(
    `\n== ${product} (${profile})   eval: ${cases.length} cases   index: v${shippedDoc.version} build ${shippedDoc.build_id}\n`,
  );
  if (cases.length === 0) {
    console.log("no cases yet: every capability is on the allowlist.");
    return 0;
  }
  console.log(`${"config".padEnd(38)} caps  top1 top3 top8  miss  over`);

  if (fixture.baseline) {
    const b = fixture.baseline;
    console.log(
      `${"declared baseline".padEnd(38)} ${String(b.cases ?? "-").padStart(4)}  ${String(b.top1).padStart(4)} ${String(b.top3).padStart(4)} ${String(b.top8).padStart(4)}     -     -`,
    );
  }

  const current = score(products, product, cases);

  if (against) {
    const { doc, label } = loadReference(product, against);
    const refDoc = productOf(doc);
    // Disabled entries are not searchable, so they are dropped here as the registry drops them.
    const ref = {
      ...refDoc,
      capabilities: refDoc.capabilities.filter((c) => !c.disabled),
    };
    const refNames = new Set(ref.capabilities.map((c) => c.name));
    const added = shipped.capabilities.filter((c) => !refNames.has(c.name));

    console.log(
      row(
        `reference (${label})`,
        score(
          withCapabilities(products, product, ref.capabilities, ref),
          product,
          cases,
        ),
      ),
    );
    console.log(
      row(
        `CONTROL: current minus ${added.length} new`,
        score(
          withCapabilities(
            products,
            product,
            shipped.capabilities.filter((c) => refNames.has(c.name)),
          ),
          product,
          cases,
        ),
      ),
    );
    console.log(row("current, as shipped", current));

    // WHICH new entries displaced an expected answer, and how often. A capability here is
    // competing for words the eval says belong to something else.
    const blame = new Map<string, number>();
    for (const entry of cases) {
      if (!entry.maxRank) continue;
      const { rank, top } = rankIn(products, product, entry);
      if (rank && rank <= entry.maxRank) continue;
      for (const c of top.slice(0, rank ? rank - 1 : 8)) {
        if (c.name && !refNames.has(c.name))
          blame.set(c.name, (blame.get(c.name) ?? 0) + 1);
      }
    }
    if (blame.size) {
      console.log(`\nnew capabilities displacing an expected answer:`);
      [...blame.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .forEach(([n, c]) => console.log(`   ${String(c).padStart(3)}x  ${n}`));
    }
  } else {
    console.log(row("current, as shipped", current));
  }

  if (current.regressions.length) {
    console.log(
      `\n${current.regressions.length} case(s) past their declared ceiling:`,
    );
    for (const r of current.regressions.slice(0, 20)) {
      console.log(
        `   ceiling ${String(r.want).padStart(2)} → ${String(r.got).padStart(4)}   "${r.q}"`,
      );
    }
    if (current.regressions.length > 20) {
      console.log(`   … and ${current.regressions.length - 20} more`);
    }
  }

  // EXACT TWINS. Same method and path shape across API versions: two indistinguishable
  // ways to do one thing. The fix is a publishing decision, not a ranking one.
  const shape = (c: Capability) =>
    `${c.method} ${c.path.replace(/\/api\/v\d+\//, "").replace(/\{[^}]+\}/g, "{}")}`;
  const groups = new Map<string, Capability[]>();
  for (const c of shipped.capabilities) {
    const k = shape(c);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const twins = [...groups.entries()].filter(([, cs]) => cs.length > 1);
  if (twins.length) {
    console.log(
      `\n${twins.length} operation(s) published at more than one API version:`,
    );
    for (const [k, cs] of twins) {
      console.log(`   ${k}\n      ${cs.map((c) => c.name).join("  |  ")}`);
    }
  }
  return current.over;
}

// ---- coverage ----

function coverage(): number {
  const products = loadRegistry("local").index.products;
  const all = searchableNames(products);
  const covered = coveredNames(products, loadSearchFixtures());
  const allow = new Set(readJson<Allowlist>(ALLOWLIST_FILE).names);
  const uncovered = [...all.keys()].filter((n) => !covered.has(n));
  const missing = uncovered.filter((n) => !allow.has(n));
  const stale = [...allow].filter((n) => covered.has(n) || !all.has(n));

  console.log(
    `\ncoverage: ${covered.size} / ${all.size} capabilities have a search-eval case`,
  );
  const byProduct = new Map<string, [number, number]>();
  for (const [name, product] of all) {
    const [c, t] = byProduct.get(product) ?? [0, 0];
    byProduct.set(product, [c + (covered.has(name) ? 1 : 0), t + 1]);
  }
  for (const [p, [c, t]] of [...byProduct].sort()) {
    console.log(
      `   ${p.padEnd(22)} ${String(c).padStart(4)} / ${String(t).padStart(4)}`,
    );
  }
  console.log(`allowlist: ${allow.size} names`);
  if (missing.length) {
    console.log(
      `\n${missing.length} capability(ies) with no case and not on the allowlist. Add a case:`,
    );
    missing.forEach((n) => console.log(`   ${n}`));
  }
  if (stale.length) {
    console.log(
      `\n${stale.length} allowlist name(s) to remove (now covered, or no longer searchable):`,
    );
    stale.forEach((n) => console.log(`   ${n}`));
  }
  return missing.length + stale.length;
}

// ---- guard (CI, needs git) ----

/**
 * The fixture rules that only a diff can see:
 *   - the allowlist only shrinks
 *   - a case whose maxRank goes up has a `why` that changed in the same diff
 *   - a removed case is listed in `retired`, with a `why`
 */
function guard(ref: string): number {
  const rel = (f: string) => relative(ROOT, f);
  const oldAllow = gitShow(ref, rel(ALLOWLIST_FILE));
  const now = loadSearchFixtures();
  const beforeFixtures: Record<string, EvalFixture> = {};
  for (const product of Object.keys(now)) {
    const raw = gitShow(ref, rel(`${SEARCH_EVAL_DIR}/${product}.json`));
    if (raw) beforeFixtures[product] = JSON.parse(raw) as EvalFixture;
  }
  const problems = guardProblems(
    {
      allow: oldAllow ? (JSON.parse(oldAllow) as Allowlist).names : undefined,
      fixtures: beforeFixtures,
    },
    { allow: readJson<Allowlist>(ALLOWLIST_FILE).names, fixtures: now },
  );

  console.log(`\nL2 fixture guard against ${ref}`);
  if (problems.length) {
    problems.forEach((p) => console.log(`   ${p}`));
    return problems.length;
  }
  console.log("   OK");
  return 0;
}

// ---- run ----

let failures = 0;
if (args.includes("--guard")) {
  if (!against) {
    console.error("--guard needs --against <git ref>");
    process.exit(2);
  }
  failures = guard(against);
} else if (args.includes("--coverage")) {
  failures = coverage();
} else {
  const products = loadRegistry(profile).index.products;
  const fixtures = loadSearchFixtures();
  const only = opt("--product");
  const fixtureFile = opt("--fixture");
  if (fixtureFile && !only) {
    console.error("--fixture needs --product");
    process.exit(2);
  }
  const selected = only ? [only] : Object.keys(fixtures);
  for (const product of selected) {
    if (!products[product]) {
      console.error(`no shipped index for product ${product}`);
      process.exit(2);
    }
    const fixture = fixtureFile
      ? readJson<EvalFixture>(fixtureFile)
      : fixtures[product];
    if (!fixture) {
      console.error(`no fixture tests/fixtures/search-eval/${product}.json`);
      process.exit(2);
    }
    // Disabled capabilities are not searchable on purpose. Their cases are not scored.
    const live = {
      ...fixture,
      cases: fixture.cases.filter((e) =>
        products[product].capabilities.some((c) =>
          e.name
            ? c.name === e.name
            : c.method === e.method && c.path === e.path,
        ),
      ),
    };
    if (profile === "remote")
      live.cases = live.cases.filter((e) => e.remote !== "withheld");
    failures += evalProduct(products, product, live);
  }
}

console.log();
if (failures > 0) {
  console.log(`FAIL: ${failures} problem(s).`);
  process.exit(1);
}
console.log("OK");
