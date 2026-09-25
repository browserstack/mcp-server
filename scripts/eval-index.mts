/**
 * What does this index change cost the ranker?
 *
 * Run before merging a capability-index update. The eval suite tells you THAT ranking
 * regressed; this tells you BY HOW MUCH and WHICH new entries did it, which is the
 * difference between a number to argue about and a list to act on.
 *
 * It exists because of a real miss. Three commits took tm from 173 to 218 capabilities
 * while `tests/fixtures/capability/` stayed pinned at the 173-entry artifact — and the
 * eval reads the fixture. The suite was green against an index nobody ships, and the
 * regression it would have caught (top-1 141 -> 116, 48 cases past their ceiling) sat
 * undetected until the fixture was synced. A standing harness that reads the SHIPPED
 * index removes that whole class of blind spot.
 *
 *   npx tsx scripts/eval-index.mts
 *   npx tsx scripts/eval-index.mts --against d49d681      # a git ref
 *   npx tsx scripts/eval-index.mts --against /tmp/old.json
 *
 * With `--against`, the reference is scored too and three extra rows are reported:
 * the reference, the CONTROL (current minus everything new since the reference), and the
 * current index. The control is the load-bearing one — if it does not reproduce the
 * reference exactly, something other than the additions changed, and the attribution
 * below is not trustworthy.
 *
 * Exit code is 1 when any case exceeds its declared `maxRank`, so this can gate a merge.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { searchCapabilities } from "../src/tools/capability-registry/search.js";
import type {
  Capability,
  ProductIndex,
} from "../src/tools/capability-registry/types.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHIPPED = `${ROOT}capability/tm.capability-index.json`;
const EVAL = `${ROOT}tests/fixtures/search-eval.json`;

interface EvalCase {
  q: string;
  method: string;
  path: string;
  maxRank?: number;
  miss?: string;
}
interface Score {
  caps: number;
  top1: number;
  top3: number;
  top8: number;
  missed: number;
  over: number;
  /** Cases that exceeded their ceiling, with what they were displaced to. */
  regressions: { q: string; want: number; got: number | "miss" }[];
}

/** The product object, however the envelope is shaped (released vs pre-release). */
function productOf(doc: any): ProductIndex {
  if (doc.products) return Object.values(doc.products)[0] as ProductIndex;
  const key = Object.keys(doc).find(
    (k) =>
      !["schema_version", "version", "build_id", "harness_commit"].includes(k),
  )!;
  return doc[key] as ProductIndex;
}

/** A file path, or a git ref to read `capability/tm.capability-index.json` from. */
function loadReference(ref: string): { doc: any; label: string } {
  if (existsSync(ref)) {
    return { doc: JSON.parse(readFileSync(ref, "utf8")), label: ref };
  }
  const raw = execFileSync(
    "git",
    ["show", `${ref}:capability/tm.capability-index.json`],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return { doc: JSON.parse(raw), label: `git:${ref}` };
}

function score(
  capabilities: Capability[],
  product: ProductIndex,
  cases: EvalCase[],
): Score {
  const products = { tm: { ...product, capabilities } };
  const s: Score = {
    caps: capabilities.length,
    top1: 0,
    top3: 0,
    top8: 0,
    missed: 0,
    over: 0,
    regressions: [],
  };
  for (const entry of cases) {
    const hits = searchCapabilities(products, entry.q, { limit: 8 }).hits;
    const at = hits.findIndex(
      (h) =>
        h.capability.method === entry.method &&
        h.capability.path === entry.path,
    );
    const rank = at < 0 ? Infinity : at + 1;
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

// ---- run ----

const args = process.argv.slice(2);
const against = args.includes("--against")
  ? args[args.indexOf("--against") + 1]
  : undefined;

const evalDoc = JSON.parse(readFileSync(EVAL, "utf8"));
const cases: EvalCase[] = evalDoc.cases;
const shippedDoc = JSON.parse(readFileSync(SHIPPED, "utf8"));
const shipped = productOf(shippedDoc);

console.log(
  `\neval: ${cases.length} cases   index: v${shippedDoc.version} build ${shippedDoc.build_id}\n`,
);
console.log(`${"config".padEnd(38)} caps  top1 top3 top8  miss  over`);

if (evalDoc.baseline) {
  const b = evalDoc.baseline;
  console.log(
    `${"declared baseline".padEnd(38)} ${String(b.cases ?? "-").padStart(4)}  ${String(b.top1).padStart(4)} ${String(b.top3).padStart(4)} ${String(b.top8).padStart(4)}  ${String(b.missed).padStart(4)}     -`,
  );
  console.log(`${"".padEnd(38)}   measured on ${b.measured_on ?? "?"}`);
}

const current = score(shipped.capabilities, shipped, cases);

if (against) {
  const { doc, label } = loadReference(against);
  const ref = productOf(doc);
  const refNames = new Set(ref.capabilities.map((c) => c.name));
  const added = shipped.capabilities.filter((c) => !refNames.has(c.name));

  console.log(row(`reference (${label})`, score(ref.capabilities, ref, cases)));
  console.log(
    row(
      `CONTROL: current minus ${added.length} new`,
      score(
        shipped.capabilities.filter((c) => refNames.has(c.name)),
        shipped,
        cases,
      ),
    ),
  );
  console.log(row("current, as shipped", current));

  // WHICH new entries displaced an expected answer, and how often. This is the list to
  // act on: a capability appearing here is competing for words the eval says belong to
  // something else, which is either a ranking fix or a publishing decision.
  const blame = new Map<string, number>();
  for (const entry of cases) {
    if (!entry.maxRank) continue;
    const hits = searchCapabilities({ tm: shipped }, entry.q, {
      limit: 8,
    }).hits;
    const at = hits.findIndex(
      (h) =>
        h.capability.method === entry.method &&
        h.capability.path === entry.path,
    );
    const rank = at < 0 ? Infinity : at + 1;
    if (rank <= entry.maxRank) continue;
    for (const h of hits.slice(0, at < 0 ? 8 : at)) {
      const n = h.capability.name;
      if (n && !refNames.has(n)) blame.set(n, (blame.get(n) ?? 0) + 1);
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

// EXACT TWINS. Same method and same path shape across API versions: the index publishes
// two indistinguishable ways to do one thing, and no scoring change reliably picks
// between them. Reported separately because the fix is a publishing decision, not a
// ranking one.
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

console.log();
if (current.over > 0) {
  console.log(`FAIL: ${current.over} case(s) exceed their declared maxRank.`);
  process.exit(1);
}
console.log("OK: every case is within its declared ceiling.");
