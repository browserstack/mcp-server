/**
 * Replay saved payloads against the live API and re-check every contract, with no agents.
 *
 *   npm run replay:live                 reads only (safe, creates nothing)
 *   npm run replay:live -- --writes     also replay the writes (MUTATES the fixture)
 *   npm run replay:live -- --all        every saved payload, not just the drifts
 *
 * WHY THIS EXISTS. Seven batches of subagents established which capabilities describe
 * themselves incorrectly. That was the expensive part and it is done. Verifying a FIX does
 * not need judgement — it needs the same request sent again and the response compared to
 * the contract, which is arithmetic. The probe skill says so: bootstrap with agents once,
 * then replay forever without spending one.
 *
 * It reuses `bind` and `fetchTransport` rather than re-implementing a client, so a payload
 * that stops binding is itself a finding — the request-shaping code is under test here too.
 *
 * READS ONLY BY DEFAULT, and that default is deliberate. Replaying a create makes another
 * object in a real project every time it runs; after seven batches the fixture already
 * holds enough residue. Writes are opt-in and the report says which ones were skipped, so
 * a green run is never mistaken for full coverage.
 *
 * NESTING. `returns` is a flat list of field names at ANY depth, while a response is a
 * tree. Comparing the two as sets of top-level keys reports an envelope like
 * `{success, folder:{…}}` as a dozen failures and is how two people already drew the wrong
 * conclusion. So the response is flattened to every key at every depth before comparing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { bind } from "../src/tools/capability-registry/bind.js";
import { fetchTransport, authHeaders } from "../src/tools/capability-registry/egress.js";
import type { Capability, ProductIndex } from "../src/tools/capability-registry/types.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const WRITES = args.includes("--writes");
const ALL = args.includes("--all");

const username = process.env.TM_LIVE_USERNAME || process.env.BROWSERSTACK_USERNAME;
const accessKey = process.env.TM_LIVE_ACCESS_KEY || process.env.BROWSERSTACK_ACCESS_KEY;
const baseUrl =
  process.env.CAPABILITY_REGISTRY_BASE_URL_TM ||
  "https://test-management-preprod.bsstag.com";

if (!username || !accessKey) {
  console.error(
    "\nCredentials are required and are never read from a file.\n" +
      "  export TM_LIVE_USERNAME=...   TM_LIVE_ACCESS_KEY=...\n" +
      "or the BROWSERSTACK_* pair the server already uses.\n",
  );
  process.exit(2);
}

const doc = JSON.parse(
  readFileSync(`${ROOT}capability/tm.capability-index.json`, "utf8"),
);
const index: ProductIndex = doc.products ? doc.products.tm : doc.tm;
const byName = new Map(index.capabilities.map((c) => [c.name!, c]));
const saved = JSON.parse(
  readFileSync(`${ROOT}tests/live/payloads/tm.json`, "utf8"),
);

/**
 * Is this object a MAP KEYED BY DATA rather than a record with fields?
 *
 * tm returns several: `overall_progress` is {Passed: 3, Untested: 5}, and search results
 * come back keyed by id, {614654: {...}}. Their keys are values, not field names, and
 * walking into them reports `Passed` and `614654` as undeclared fields — which the first
 * run of this script duly did, for 13 capabilities. Detected by shape rather than by a
 * list of exceptions: either the keys are numeric, or every value under them is an object
 * of the same shape, which is what a map looks like and what a record does not.
 */
function looksKeyedByData(record: Record<string, unknown>): boolean {
  const keys = Object.keys(record);
  if (keys.length === 0) return false;
  if (keys.every((k) => /^\d+$/.test(k))) return true;
  // Status-count maps: every value a scalar, every key Capitalised like an enum member.
  const scalar = Object.values(record).every((v) => v === null || typeof v !== "object");
  return scalar && keys.length > 1 && keys.every((k) => /^[A-Z][a-z]+$/.test(k));
}

/** Every key at every depth, so a flat `returns` can be compared with a nested body. */
function keysAtAnyDepth(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    // One element is enough to learn an array's item shape; the rest repeat it.
    if (value.length > 0) keysAtAnyDepth(value[0], out);
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (looksKeyedByData(record)) return out;
    for (const [k, v] of Object.entries(record)) {
      out.add(k);
      keysAtAnyDepth(v, out);
    }
  }
  return out;
}

/**
 * What the capability DECLARES, taken from the resolved response schema as well as
 * `returns`.
 *
 * `returns` is a convenience list, not the contract: it is flat, and it does not enumerate
 * the pagination envelope or nested objects. Comparing a response against it alone reports
 * `count`/`page_size`/`next` as undeclared on every paginated read, when the schema
 * declares them perfectly well under `info`. The schema is the thing a caller is actually
 * promised, so it is what the response is checked against.
 */
function declaredFields(capability: Capability): Set<string> {
  const out = new Set<string>(capability.returns || []);
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, any>;
    if (typeof obj.$schema === "string") {
      if (seen.has(obj.$schema)) return;
      seen.add(obj.$schema);
      return walk((index.schemas || {})[obj.$schema]);
    }
    if (typeof obj.$response === "string") {
      if (seen.has(obj.$response)) return;
      seen.add(obj.$response);
      return walk((index.responses || {})[obj.$response]);
    }
    if (obj.properties && typeof obj.properties === "object") {
      for (const [name, sub] of Object.entries(obj.properties)) {
        out.add(name);
        walk(sub);
      }
    }
    if (obj.items) walk(obj.items);
    if (obj.schema) walk(obj.schema);
    for (const key of ["allOf", "anyOf", "oneOf"]) {
      if (Array.isArray(obj[key])) obj[key].forEach(walk);
    }
  };
  const ok = Object.entries(capability.responses || {}).find(([code]) =>
    code.startsWith("2"),
  );
  if (ok) walk(ok[1]);
  return out;
}

const transport = fetchTransport();
const headers = authHeaders({ username, accessKey }, index.auth);

interface Row {
  name: string;
  mode: string;
  status: number | "skipped" | "bind-error";
  undeclared: string[];
  absent: string[];
  note?: string;
}

const rows: Row[] = [];
const entries = Object.entries(
  (saved.payloads || {}) as Record<string, { verdict?: string; arguments?: any }>,
);

for (const [name, entry] of entries) {
  if (!ALL && entry.verdict !== "DRIFT") continue;
  const capability = byName.get(name) as Capability | undefined;
  if (!capability) {
    rows.push({ name, mode: "?", status: "skipped", undeclared: [], absent: [], note: "not in the current index" });
    continue;
  }
  if (capability.mode !== "read" && !WRITES) {
    rows.push({ name, mode: capability.mode, status: "skipped", undeclared: [], absent: [], note: "write — rerun with --writes" });
    continue;
  }

  let bound;
  try {
    bound = bind(capability, entry.arguments || {});
  } catch (error) {
    // A payload that no longer binds is a finding in its own right: either the contract
    // moved under it, or the saved arguments were never valid.
    rows.push({ name, mode: capability.mode, status: "bind-error", undeclared: [], absent: [], note: String(error instanceof Error ? error.message : error).slice(0, 160) });
    continue;
  }

  const response = await transport(
    capability.method,
    `${baseUrl.replace(/\/$/, "")}${bound.path}`,
    headers,
    bound.query,
    bound.body,
  );

  const declared = declaredFields(capability);
  const present = keysAtAnyDepth(response.body);
  rows.push({
    name,
    mode: capability.mode,
    status: response.status,
    undeclared: [...present].filter((k) => !declared.has(k)).sort(),
    absent: [...declared].filter((k) => !present.has(k)).sort(),
  });
}

// ---- report ----

const ran = rows.filter((r) => typeof r.status === "number");
const clean = ran.filter((r) => r.status === 200 && r.undeclared.length === 0 && r.absent.length === 0);
const overReturn = ran.filter((r) => r.undeclared.length > 0);
const conditional = ran.filter((r) => r.undeclared.length === 0 && r.absent.length > 0);

console.log(`\nreplay: ${entries.length} saved payloads, ${rows.length} selected, ${ran.length} invoked`);
console.log(`index v${doc.version} build ${doc.build_id}   env ${baseUrl}\n`);

console.log(`CLEAN — contract matches the response exactly: ${clean.length}`);
for (const r of clean) console.log(`   ${r.name}`);

console.log(`\nRETURNS A FIELD IT DOES NOT DECLARE: ${overReturn.length}`);
for (const r of overReturn)
  console.log(`   ${r.name}\n      undeclared: ${r.undeclared.join(", ")}` +
    (r.absent.length ? `\n      absent    : ${r.absent.join(", ")}` : ""));

console.log(`\nDECLARES A FIELD THE RESPONSE OMITS: ${conditional.length}`);
console.log(`   (expected where the field is conditional — check the guidance says so)`);
for (const r of conditional) console.log(`   ${r.name}\n      absent: ${r.absent.join(", ")}`);

const odd = rows.filter((r) => r.status !== 200 && typeof r.status === "number");
if (odd.length) {
  console.log(`\nNON-200: ${odd.length}`);
  for (const r of odd) console.log(`   ${r.name}  status ${r.status}`);
}
const skipped = rows.filter((r) => r.status === "skipped" || r.status === "bind-error");
if (skipped.length) {
  console.log(`\nNOT INVOKED: ${skipped.length}`);
  for (const r of skipped) console.log(`   ${r.name}  (${r.note})`);
}

console.log();
if (overReturn.length > 0) {
  console.log(`${overReturn.length} capabilit${overReturn.length === 1 ? "y" : "ies"} still return undeclared fields.`);
  process.exit(1);
}
console.log("No capability returns a field it fails to declare.");
