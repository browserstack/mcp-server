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
const pool = JSON.parse(readFileSync(`${ROOT}tests/live/.id-pool.json`, "utf8"));

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

/**
 * Every field as a DOTTED PATH, not a bare leaf name.
 *
 * Comparing leaf names attributes a nested entity's field to its parent. `get_test_run_v2`
 * resolves `test_plan.id` and `issues[].id`, both real fields on nested objects — and a
 * leaf-name matcher reported the run itself as declaring `id`, which sent a false "he
 * shipped a third half-fix" to the person who had just fixed the first two. Any response
 * carrying any nested entity hits this, so it is a class, not an instance.
 */
function pathsOf(
  value: unknown,
  prefix = "",
  out = new Set<string>(),
  open: Set<string> = new Set(),
): Set<string> {
  if (prefix && open.has(prefix)) return out;
  if (Array.isArray(value)) {
    // One element is enough to learn an array's item shape; the rest repeat it.
    if (value.length > 0) pathsOf(value[0], prefix, out, open);
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (looksKeyedByData(record)) return out;
    for (const [k, v] of Object.entries(record)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.add(path);
      pathsOf(v, path, out, open);
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
/**
 * Paths the schema explicitly declares as an object with NO properties.
 *
 * That is the contract saying "the keys here are data, not fields" — `overall_progress` is
 * {Passed: 3, Untested: 5}, keyed by status display name, and the product can add a status
 * tomorrow. Descending into one reports `Untested` as an undeclared field, which is what my
 * shape heuristic caught for multi-key maps and missed for single-key ones.
 *
 * Keyed on the CONTRACT, not on the data — teststack-73's suggestion, and the better rule:
 * guessing from key shape means enumerating status names the product owns. The distinction
 * that matters is `{type: "object"}` with no properties, which is a deliberate open map,
 * versus a path the schema never mentions at all, which is an under-declaration and exactly
 * the finding this script exists to report. Only the first is suppressed.
 */
function openObjectPaths(capability: Capability): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown, prefix: string, seen: Set<string>): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, any>;
    for (const ref of ["$schema", "$response"] as const) {
      if (typeof obj[ref] === "string") {
        if (seen.has(obj[ref])) return;
        const table = ref === "$schema" ? index.schemas : index.responses;
        return walk((table || {})[obj[ref]], prefix, new Set([...seen, obj[ref]]));
      }
    }
    if (obj.type === "object" && !obj.properties && !obj.allOf && !obj.anyOf && prefix) {
      out.add(prefix);
      return;
    }
    if (obj.properties && typeof obj.properties === "object") {
      for (const [name, sub] of Object.entries(obj.properties)) {
        walk(sub, prefix ? `${prefix}.${name}` : name, seen);
      }
    }
    if (obj.items) walk(obj.items, prefix, seen);
    if (obj.schema) walk(obj.schema, prefix, seen);
  };
  const ok = Object.entries(capability.responses || {}).find(([c]) => c.startsWith("2"));
  if (ok) walk(ok[1], "", new Set());
  return out;
}

function declaredFields(capability: Capability): Set<string> {
  // `returns` is flat and pathless, so it can only ever be matched at the top level.
  const out = new Set<string>(capability.returns || []);
  const walk = (node: unknown, prefix: string, seen: Set<string>): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, any>;
    for (const ref of ["$schema", "$response"] as const) {
      if (typeof obj[ref] === "string") {
        // Recursion guard is per BRANCH, not global: the same schema legitimately appears
        // at two different paths, and a global guard would silently drop the second.
        if (seen.has(obj[ref])) return;
        const table = ref === "$schema" ? index.schemas : index.responses;
        return walk((table || {})[obj[ref]], prefix, new Set([...seen, obj[ref]]));
      }
    }
    if (obj.properties && typeof obj.properties === "object") {
      for (const [name, sub] of Object.entries(obj.properties)) {
        const path = prefix ? `${prefix}.${name}` : name;
        out.add(path);
        walk(sub, path, seen);
      }
    }
    if (obj.items) walk(obj.items, prefix, seen);
    if (obj.schema) walk(obj.schema, prefix, seen);
    for (const key of ["allOf", "anyOf", "oneOf"]) {
      if (Array.isArray(obj[key])) obj[key].forEach((x: unknown) => walk(x, prefix, seen));
    }
  };
  const ok = Object.entries(capability.responses || {}).find(([code]) =>
    code.startsWith("2"),
  );
  if (ok) walk(ok[1], "", new Set());
  return out;
}

/**
 * Capabilities whose schema describes the ENVELOPE by design.
 *
 * Both return mixed entity payloads — global search spans every entity type, a history row
 * carries whatever changed — so the schema deliberately stops at the wrapper and a
 * field-level diff is a hundred-line list on every run. Suppressed by name rather than
 * left to dilute the signal, because a report nobody reads catches nothing.
 */
// global_search_v1 WAS here and has been removed. It looked envelope-only; the static
// contract check found seven top-level entity buckets — test_case, test_run, test_plan,
// project, report, shared_step, project_details — named in `returns` and absent from the
// resolved schema. A caller reading the contract cannot learn a global search returns a
// test_case bucket at all. That is under-described, not deliberately terse, and
// suppressing it here would hide the same gap on every future run.
const ENVELOPE_ONLY = new Set<string>([]);

/**
 * Put flat arguments back into the groups bind() expects.
 *
 * The probe subagents recorded `probe.arguments` in two shapes — some grouped as
 * {path_params, query, body}, some flat with the path params as top-level keys beside
 * `body`. Five payloads were unreplayable for that reason alone, which looked like stale
 * fixture ids and was really a recording inconsistency: update_test_run_v2 carried a body
 * and no path params at all, edit_project_v1 had project_id as a sibling of `body`.
 *
 * Fixing it here rather than rewriting the saved payloads keeps them as the probes left
 * them — they are evidence of what was actually sent — while still letting the replay
 * judge the contract. A key that matches no declared parameter is left where it is, so a
 * genuinely unknown field still fails loudly instead of being quietly dropped.
 */
function regroup(capability: Capability, args: any): any {
  const GROUPS = ["path_params", "query", "body"] as const;
  const stray = Object.keys(args).filter((k) => !GROUPS.includes(k as any));
  if (stray.length === 0) return args;
  const out: any = { ...args };
  const declared = (group: "path_params" | "query" | "body") =>
    new Set((((capability as any)[group] as any[]) || []).map((p) => p.name));
  for (const key of stray) {
    const home = GROUPS.find((g) => declared(g).has(key));
    if (!home) continue;
    out[home] = { ...(out[home] || {}), [key]: args[key] };
    delete out[key];
  }
  return out;
}

/**
 * Fill a REQUIRED path param the saved payload does not carry, from the fixture pool.
 *
 * Two payloads recorded a body and no path params at all — update_test_run_v2 and
 * bulk_update_test_run_test_cases_v2 — so they could not be replayed and sat as permanent
 * "not invoked" rows. Rewriting the saved payloads was the wrong fix: they are evidence of
 * what the probes actually sent, and editing them destroys that. The pool is the canonical
 * fixture, so a payload that names no run should replay against the fixture run.
 *
 * Only REQUIRED params, only when absent, and only from the pool — a payload that names a
 * DIFFERENT run keeps its own value, because that choice may have been the point.
 */
function fillFromPool(capability: Capability, args: any): any {
  const required = (capability.path_params ?? []).filter((p) => p.required);
  if (required.length === 0) return args;
  const supplied = { ...(args.path_params ?? {}) };
  const numeric = (p: { name: string; type?: string }) => p.type === "integer";
  const POOL: Record<string, unknown> = {
    project_id: pool.project.id,
    folder_id: pool.readonly.folder,
    test_case_id: pool.readonly.cases?.[0],
    test_plan_id: pool.readonly.plan,
    test_run_id: pool.readonly.run,
  };
  let filled = false;
  for (const param of required) {
    if (supplied[param.name] !== undefined) continue;
    let value = POOL[param.name];
    if (value === undefined) continue;
    // v1 routes take the integer project id, v2 the PR-NNN form; the pool carries both.
    if (param.name === "project_id" && !numeric(param)) value = pool.project.identifier;
    supplied[param.name] = value;
    filled = true;
  }
  return filled ? { ...args, path_params: supplied } : args;
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
  // EVERY saved payload, not just the ones a probe once called DRIFT. That filter read a
  // verdict recorded at probe time, which goes stale the moment anything is fixed — it hid
  // list_binned_test_cases_v1 for three passes as "not invoked" when the truth was that
  // nothing had selected it. Verification is not triage: replaying a payload that passed
  // last week is how you learn it stopped.
  if (ALL === false && !entry.arguments) continue;
  const capability = byName.get(name) as Capability | undefined;
  if (!capability) {
    rows.push({ name, mode: "?", status: "skipped", undeclared: [], absent: [], note: "not in the current index" });
    continue;
  }
  if (ENVELOPE_ONLY.has(name)) {
    rows.push({ name, mode: capability.mode, status: "skipped", undeclared: [], absent: [], note: "schema describes the envelope by design — a field diff is noise" });
    continue;
  }
  if (capability.mode !== "read" && !WRITES) {
    rows.push({ name, mode: capability.mode, status: "skipped", undeclared: [], absent: [], note: "write — rerun with --writes" });
    continue;
  }

  let bound;
  try {
    bound = bind(capability, fillFromPool(capability, regroup(capability, entry.arguments || {})));
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

  // TWO DECLARATION SOURCES, MATCHED DIFFERENTLY, because they are different things.
  // The resolved schema is a tree and compares by PATH — that is what stops a nested
  // entity's `id` being read as the parent's. `returns` is a flat, pathless convenience
  // list whose entries legitimately sit at any depth, so it compares by LEAF. Matching
  // either one path-wise or both leaf-wise produces a confident wrong answer, and this
  // script has now shipped both mistakes.
  // ONLY DIFF A SUCCESS BODY AGAINST THE SUCCESS SCHEMA.
  //
  // A non-2xx carries an ERROR shape, and comparing it with the 2xx schema reports the
  // error's own fields as undeclared successes. That is how create_folder_v2 was reported
  // as returning an undeclared `message` — it was a duplicate-name 400 — and it caught
  // create_report_v2 the same way with `details` and `error` off a 400 body. Twice is a
  // pattern: the fix belongs here rather than in each payload.
  const succeeded =
    typeof response.status === "number" &&
    response.status >= 200 &&
    response.status < 300;
  const declaredPaths = succeeded ? declaredFields(capability) : new Set<string>();
  const declaredLeaves = new Set(capability.returns || []);
  const present = succeeded
    ? pathsOf(response.body, "", new Set(), openObjectPaths(capability))
    : new Set<string>();
  const leaf = (path: string) => path.slice(path.lastIndexOf(".") + 1);
  rows.push({
    name,
    mode: capability.mode,
    status: response.status,
    undeclared: [...present]
      .filter((k) => !declaredPaths.has(k) && !declaredLeaves.has(leaf(k)))
      .sort(),
    // A CHILD IS NOT ABSENT WHEN ITS PARENT IS. `test_run.issues` comes back as an empty
    // array on a run with no linked tickets, so `test_run.issues.id` cannot appear — and
    // reporting the child says the contract is wrong when the fixture simply had nothing
    // there. It buried the real signal: clone_test_run_v2 showed 21 "absent" fields, all
    // of them children of two empty collections. Only the SHALLOWEST missing path on a
    // branch is reported, which is the one a reader can act on.
    absent: [...declaredPaths]
      .filter((k) => !present.has(k) && !declaredLeaves.has(leaf(k)))
      .filter((k) => {
        const parent = k.slice(0, k.lastIndexOf("."));
        return !parent || present.has(parent);
      })
      .sort(),
  });
}

// ---- report ----

const ran = rows.filter((r) => typeof r.status === "number");
// ANY 2xx, not just 200. bulk_update_test_run_test_cases_v2 answers 202 — the bulk change
// is accepted and applied asynchronously — and a check pinned to 200 filed that success
// under "non-200" where the reconcile read it as never invoked.
const clean = ran.filter(
  (r) => typeof r.status === "number" && r.status >= 200 && r.status < 300 &&
    r.undeclared.length === 0 && r.absent.length === 0,
);
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

const odd = rows.filter(
  (r) => typeof r.status === "number" && !(r.status >= 200 && r.status < 300),
);
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
