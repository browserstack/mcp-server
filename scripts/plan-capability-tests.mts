/**
 * Order every capability so that whatever it needs has already been tested, and emit a CSV
 * of batches to hand out.
 *
 *   npm run plan:tests            write tests/live/capability-test-plan.csv
 *   npm run plan:tests -- --batch 10
 *
 * WHY A CSV AND NOT LOGIC INSIDE THE PROBE SKILL. The batches get assigned to different
 * people. A sort that lives inside the skill is re-derived per agent, cannot be reviewed
 * before the work starts, and gives no shared artifact to track progress on. Sorting once
 * and publishing the order means the plan is reviewable, assignable, and the same for
 * everyone.
 *
 * THE ORDER. Two keys, both taken from the index rather than invented:
 *
 *   1. ENTITY TIER, from a topological sort of `entity.parents`. tm resolves to four
 *      tiers — project/template at 0, folder/test_plan/custom_field at 1, test_case and
 *      test_run at 2, result/comment/version at 3. Nothing at tier 2 can be exercised
 *      until tier 1 exists, which is exactly the "test list_projects, then create a case,
 *      then list cases" sequence, derived instead of hand-written.
 *
 *   2. OPERATION ROLE within an entity: surveys first (a list that needs nothing but a
 *      project — proves access and discovers ids), then creates (which PRODUCE ids), then
 *      fetches (which CONSUME an id), then updates, then destructive last. Testing a
 *      `get_x` before any `create_x` means hunting for a pre-existing x; doing it after
 *      means using the one you just made.
 *
 * The result is that a batch is mostly self-supplying: by the time a tester reaches
 * `get_test_run_v2` they have created a run, and the id is theirs rather than borrowed.
 *
 * NOT A DEPENDENCY SOLVER. It does not promise that every prerequisite is in the same
 * batch — `result` needs both a run and a case, which live in an earlier tier and possibly
 * an earlier batch. The seed fixture covers that case: `npm run seed:live` publishes a
 * project, folder, two cases, a plan and a run, so a tester starting at any batch has the
 * tier-0 and tier-1 objects already.
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  Capability,
  ProductIndex,
} from "../src/tools/capability-registry/types.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}tests/live/capability-test-plan.csv`;

const args = process.argv.slice(2);
const BATCH = Number(
  args.includes("--batch") ? args[args.indexOf("--batch") + 1] : 10,
);
const product = args.includes("--product")
  ? args[args.indexOf("--product") + 1]
  : "tm";

const doc = JSON.parse(
  readFileSync(`${ROOT}capability/${product}.capability-index.json`, "utf8"),
);
const index: ProductIndex = doc.products ? doc.products[product] : doc[product];

/** Depth of an entity in its own `parents` graph. Cycle-guarded; unknown parents ignored. */
function tiers(idx: ProductIndex): Record<string, number> {
  const names = Object.keys(idx.entities);
  const depth: Record<string, number> = {};
  const walk = (entity: string, stack = new Set<string>()): number => {
    if (depth[entity] !== undefined) return depth[entity];
    if (stack.has(entity)) return 0;
    stack.add(entity);
    const parents = ((idx.entities[entity] as any).parents ?? []).filter(
      (p: string) => names.includes(p),
    );
    depth[entity] = parents.length
      ? 1 + Math.max(...parents.map((p: string) => walk(p, stack)))
      : 0;
    return depth[entity];
  };
  names.forEach((n) => walk(n));
  return depth;
}

/**
 * What role the capability plays in its entity's lifecycle, which decides test order.
 *
 * Read off the mode plus whether it consumes an id, NOT off the verb in the name — tm
 * spells 68 of its 85 non-read operations as POST, so the method tells you nothing, and
 * names are inconsistent enough that `get_root_folders_v1` is a listing.
 */
function role(c: Capability): [number, string] {
  if (c.mode === "destructive") return [5, "destructive"];
  // ONLY the capability's OWN entity id counts. `project_id` is on almost every path as a
  // SCOPE, not as the thing being addressed — counting it made `create_root_folder_v1`
  // look like an update and left the plan with 6 creates and 86 updates.
  const own = new Set([`${c.entity}_id`, "id"]);
  const addressesInstance = (c.path_params ?? []).some((p) => own.has(p.name));
  if (c.mode === "read")
    return addressesInstance ? [3, "fetch"] : [1, "survey"];
  // A write that names no instance of its own entity is making one.
  return addressesInstance ? [4, "update"] : [2, "create"];
}

const depth = tiers(index);

const rows = index.capabilities
  .map((c) => {
    const [rank, kind] = role(c);
    const parents = ((index.entities[c.entity] as any)?.parents ??
      []) as string[];
    const needs = (c.path_params ?? [])
      .filter((p) => p.required)
      .map((p) => p.name)
      .join(" ");
    return {
      tier: depth[c.entity] ?? 9,
      entity: c.entity,
      rank,
      kind,
      name: c.name ?? `${c.method} ${c.path}`,
      mode: c.mode,
      method: c.method,
      path: c.path,
      needs,
      prereq: parents.join(" "),
      guidance: (c.guidance?.length ?? 0) > 0 ? "yes" : "",
    };
  })
  .sort(
    (a, b) =>
      a.tier - b.tier ||
      a.entity.localeCompare(b.entity) ||
      a.rank - b.rank ||
      a.name.localeCompare(b.name),
  );

const cell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = [
  "batch",
  "seq",
  "capability",
  "entity",
  "tier",
  "role",
  "mode",
  "method",
  "path",
  "required_path_params",
  "entity_prereqs",
  "has_guidance",
  // left blank for whoever runs the batch
  "owner",
  "status",
  "verdict",
  "notes",
];

const lines = [header.join(",")];
rows.forEach((r, i) => {
  lines.push(
    [
      Math.floor(i / BATCH) + 1,
      i + 1,
      r.name,
      r.entity,
      r.tier,
      r.kind,
      r.mode,
      r.method,
      r.path,
      r.needs,
      r.prereq,
      r.guidance,
      "",
      "",
      "",
      "",
    ]
      .map(cell)
      .join(","),
  );
});

mkdirSync(`${ROOT}tests/live`, { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n");

const batches = Math.ceil(rows.length / BATCH);
console.log(
  `${rows.length} capabilities -> ${batches} batches of ${BATCH}  ->  tests/live/capability-test-plan.csv\n`,
);
const byTier: Record<number, number> = {};
const byKind: Record<string, number> = {};
for (const r of rows) {
  byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
  byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
}
console.log(
  "by entity tier :",
  Object.entries(byTier)
    .map(([k, v]) => `${k}:${v}`)
    .join("  "),
);
console.log(
  "by role        :",
  Object.entries(byKind)
    .map(([k, v]) => `${k}:${v}`)
    .join("  "),
);
console.log("\nfirst batch:");
rows
  .slice(0, BATCH)
  .forEach((r, i) =>
    console.log(
      `  ${String(i + 1).padStart(3)}  t${r.tier} ${r.kind.padEnd(11)} ${r.mode.padEnd(11)} ${r.name}`,
    ),
  );
