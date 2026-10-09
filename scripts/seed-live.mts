/**
 * Find-or-create the one project the live capability probes run against, and publish an
 * id pool for them to read.
 *
 * WHY THIS IS NOT PART OF THE PROBE AGENTS. An agent asked to "pick a project with enough
 * data" picks a real one — the first manual run landed on "JD RCA Flaky Samples", which
 * belongs to a colleague. Read-only probing there is rude; a write probe would have been
 * editing their data. And a selection heuristic run once per capability gives a different
 * environment every time, so nothing is reproducible. Selection happens ONCE, here, and
 * every agent reads the answer.
 *
 *   npm run seed:live            resolve, seed, write the pool
 *   npm run seed:live -- --show  print the existing pool and exit
 *
 * IDEMPOTENT, AND IT HAS TO BE BY NAME. Re-running finds every fixture object by its name
 * and only creates what is genuinely absent. The pool file is NOT the source of truth for
 * what exists: it is gitignored, so a fresh checkout (CI) starts with no pool, and anything
 * guarded only by `if (!pool.x)` gets created a second time on that account. Objects this
 * seeder cannot delete then accumulate forever. Guard on a name lookup, not on the pool.
 *
 * THE PROJECT IS PERMANENT. tm exposes no project delete or rename — `update_project_settings`
 * is the only project write — so whatever this creates stays forever. That is why it is a
 * single, loudly-named project rather than one per run.
 *
 * TWO REGIONS, because reads and writes cannot share:
 *   __readonly__  seeded once, never mutated. Read probes assert against it, so its
 *                 contents have to be stable across the whole suite.
 *   __scratch__   where write probes create their own folders and objects. A write probe
 *                 that mutated __readonly__ would break every read probe that ran after it.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BrowserStackMcpServer } from "../src/server-factory.js";
import { fetchTransport, authHeaders } from "../src/tools/capability-registry/egress.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const POOL = `${ROOT}tests/live/.id-pool.json`;

const PROJECT_NAME = "__mcp-capability-fixture__";
const PROJECT_NOTE =
  "Automated capability probes for the MCP capability registry. Do not use for manual testing; contents are asserted against. Owner: AI Platform.";
const READONLY = "__readonly__";
const SCRATCH = "__scratch__";

/** EVERY FIXTURE OBJECT IS ADDRESSED BY NAME, never by position in a listing. See section 3. */
const CASE_A = "probe case A";
const CASE_B = "probe case B";
const BDD_CASE = "__probe-bdd-case";
const SCRATCH_CASE = "Checkout flow";
/** FIXED, not time-stamped: the throwaway has to be findable on the next run. */
const BIN_CASE_PREFIX = "__probe-bin-";
const PLAN_NAME = "probe plan";
const RUN_NAME = "probe run";
/** A SECOND run, in __scratch__, for the cases that write results or edit run metadata.
 *  The __readonly__ run cannot serve: a read case asserts on its exact membership. */
const SCRATCH_RUN_NAME = "probe scratch run";

/**
 * CHURN: the objects the CREATE-shaped eval cases make, and this script removes.
 *
 * Creating is a P0 workflow in its own right — create a folder, a case, a run, a shared step —
 * and leaving it untested to keep the fixture tidy tests the fixture instead of the product.
 * So the create cases run, and their output is swept before the next run rather than left to
 * pile up. Sweeping BEFORE rather than after is deliberate: a run that crashes half way leaves
 * its objects for inspection, and the next run still starts from a known state, which an
 * after-the-fact cleanup cannot promise.
 *
 * Removal is by EXACT name, and only inside `__mcp-capability-fixture__` — a project that
 * holds nothing anybody authored. The eval agent cannot do this itself: the registry refuses
 * destructive capabilities outright, which is the right default and the reason cleanup belongs
 * to the fixture builder talking to the product directly.
 */
const CHURN_FOLDER = "Sprint 42 Tests";
const CHURN_RUN = "Sprint 42 Regression";
const CHURN_SHARED_STEP = "Login as Admin";

// Preprod, with the credentials already configured for the local MCP server. Pinned here
// rather than read from the environment so a stray shell variable cannot point a seeding
// run — which CREATES data — at production.
/**
 * The host to seed against. REQUIRED, with no default.
 *
 * A hardcoded fallback was worse here than a missing one: this script CREATES data, so a
 * default silently decides whose project gets written to when the variable is unset or
 * misspelled. It also put an internal hostname in a public repository for no benefit —
 * anyone entitled to run this knows which host they are pointing at.
 */
function requireBaseUrl(): string {
  const url = (process.env.CAPABILITY_REGISTRY_BASE_URL_TM || "").trim();
  if (!url) {
    throw new Error(
      "CAPABILITY_REGISTRY_BASE_URL_TM is required: this script creates data, so it will " +
        "not guess a host. Export the base URL of the environment you mean to seed.",
    );
  }
  return url;
}

/**
 * Which environment this run is seeding, derived from the host rather than assumed.
 *
 * It used to be pinned to "preprod" so a stray shell variable could not point a run that
 * CREATES data at production. That guard was right about the risk and wrong about the
 * remedy: it mislabelled any other host as preprod rather than refusing it, so the pool
 * recorded an environment the data was never in. Pointing at production is now possible
 * and must be DELIBERATE — an explicit opt-in on top of the host, so no single misspelled
 * variable is enough.
 */
const BASE_URL = requireBaseUrl();
const PRODUCTION = /(^|\/\/)(test-management|api)\.browserstack\.com/.test(BASE_URL);
if (PRODUCTION && process.env.TM_LIVE_ALLOW_PRODUCTION !== "1") {
  throw new Error(
    `${BASE_URL} is production. This script CREATES data, and the project it creates ` +
      "cannot be deleted or renamed afterwards. Set TM_LIVE_ALLOW_PRODUCTION=1 to say so " +
      "deliberately.",
  );
}
const ENV = PRODUCTION ? "production" : "preprod";
// NO DEFAULTS. Seeding creates data with whoever's credentials it is handed, so a
// hardcoded fallback is both a committed secret and a way to write to an account nobody
// chose. Falls back to the names the server itself already uses, so a shell that can run
// the MCP server can run this.
const USERNAME =
  process.env.TM_LIVE_USERNAME ?? process.env.BROWSERSTACK_USERNAME;
const ACCESS_KEY =
  process.env.TM_LIVE_ACCESS_KEY ?? process.env.BROWSERSTACK_ACCESS_KEY;

/**
 * Strip the account from anything printed.
 *
 * The username is half of the `Api-Token: <username>:<access_key>` pair this surface
 * authenticates with, and stdout here reaches CI logs, terminal scrollback and screen
 * shares — read by more people than the shell that set the variable.
 *
 * NOT MASKED — OMITTED. A first attempt printed `ing…Xf`, and CodeQL kept the alert open,
 * correctly: it follows the value from `process.env` through any transform, and a mask is
 * still a derived value on a path that did not need to carry it at all. The environment
 * name already answers the only question the line was for ("am I about to seed the right
 * place?"), and the account is one `cat` away in the pool file.
 *
 * The POOL FILE keeps the full value: it is gitignored, and knowing which account seeded a
 * fixture is exactly what you want when a probe result looks wrong.
 */
function withoutAccount<T extends { account?: string }>(pool: T): Omit<T, "account"> {
  const { account: _omitted, ...rest } = pool;
  return rest;
}

interface Pool {
  env: string;
  account: string;
  /** BOTH id forms. v1 endpoints take the integer, v2 take PR-NNN, and several v1 calls
   *  mix them — resolving it once here is five failed calls nobody else has to make. */
  project: { id: number; identifier: string; name: string };
  readonly: { folder?: number; cases?: string[]; plan?: string; run?: string };
  scratch: { folder?: number; case?: string; run?: string; result_logged?: boolean };
  /** The objects no ordinary create can reach — each one closed a capability that probed
   *  UNVERIFIED. Optional because some cannot be seeded with every account's permissions. */
  gaps?: {
    binned_case?: number | string | null;
    shared_step?: number | string | null;
    bdd_case?: string | null;
    attachment?: number | string | null;
  };
  seeded_at: string;
}

if (!USERNAME || !ACCESS_KEY) {
  console.error(
    "seed refused: no credentials.\n" +
      "  set TM_LIVE_USERNAME / TM_LIVE_ACCESS_KEY, or BROWSERSTACK_USERNAME /\n" +
      "  BROWSERSTACK_ACCESS_KEY, for the account that should own the fixture project.",
  );
  process.exit(1);
}

process.env.CAPABILITY_REGISTRY_INDEX_DIR = `${ROOT}capability/`;
process.env.CAPABILITY_REGISTRY_BASE_URL_TM = BASE_URL;

const tools: any = new BrowserStackMcpServer({
  "browserstack-username": USERNAME,
  "browserstack-access-key": ACCESS_KEY,
} as any).getTools();

/**
 * One capability call, retried on TRANSPORT failure only.
 *
 * Status 0 means the request never completed — the server reports it rather than throwing,
 * so it is indistinguishable from a real answer unless you look. A seeding run makes ~12
 * calls against preprod and one flaked on the second run, failing the whole script with a
 * null body and no explanation. Retried because it is idempotent to retry something that
 * never arrived; a 4xx or 5xx is NOT retried, because the product answered and repeating
 * the call would not change its mind.
 */
async function call(
  name: string,
  args: Record<string, unknown> = {},
  attempt = 1,
) {
  const result = await tools.invokeCapability.handler(
    { name, product: "tm", ...args },
    {} as any,
  );
  const payload = JSON.parse(result.content[0].text);
  const status = payload.http_response?.status ?? 0;
  if (status === 0 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 400 * attempt));
    return call(name, args, attempt + 1);
  }
  return {
    status,
    body: payload.http_response?.body,
    // `error` is the bind-time refusal; `http_response.error` is the transport failure.
    // Reporting neither is how the first flake produced "seed failed: null".
    error: (payload.error ?? payload.http_response?.error) as
      | string
      | undefined,
  };
}

/** A write, with the consent the server demands. Seeding is by definition a write. */
const write = (name: string, args: Record<string, unknown>, summary: string) =>
  call(name, { ...args, user_permission: "granted", change_summary: summary });

/**
 * A request that does NOT go through invokeCapability.
 *
 * Two of the gaps cannot be seeded through the registry, for opposite reasons. Populating
 * the recycle bin needs `bulk_delete_test_cases`, which is `mode: destructive` and is
 * refused before binding — correctly, and the seeder should not be the thing that erodes
 * that gate. Creating an attachment blob needs a genuine multipart upload, which the
 * registry does not do at all.
 *
 * So the seeder talks to the product directly for exactly those two steps. It is a fixture
 * builder, not a caller, and the destructive gate exists to protect callers from an agent's
 * judgement — not to stop a script deliberately deleting a case it just made for the
 * purpose. Everything else in this file still goes through the registry, because the
 * registry path is also what the probes exercise.
 */
async function raw(
  method: string,
  path: string,
  body?: unknown,
  contentType?: string,
) {
  const username =
    process.env.TM_LIVE_USERNAME || process.env.BROWSERSTACK_USERNAME || "";
  const accessKey =
    process.env.TM_LIVE_ACCESS_KEY || process.env.BROWSERSTACK_ACCESS_KEY || "";
  const base = requireBaseUrl();
  // AWAITED. `authHeaders` is async, and spreading the Promise yields {} — a Promise has no
  // own enumerable properties — so every raw() call went out UNAUTHENTICATED and came back
  // 401. Both gaps this script could never close were blamed on the account for it: the
  // recycle-bin case was reported as "delete returns 401 on this account", and the attachment
  // likewise, which in turn excluded two eval cases as unrunnable. The compiler had said so
  // all along, in the one type error this file carried:
  //
  //   Type '{ "Content-Type"?: string; then<...>; catch<...> }' is not assignable to
  //   'Record<string, string>'. Property 'then' is incompatible with index signature.
  //
  // `then` appearing in a spread IS the diagnosis. A 401 that is really a missing await is
  // indistinguishable from a permissions problem from the outside, which is how it survived.
  const headers: Record<string, string> = {
    ...(await authHeaders({ username, accessKey })),
    ...(contentType ? { "Content-Type": contentType } : {}),
  };

  // MULTIPART CANNOT GO THROUGH fetchTransport, which JSON.stringifies every body — a
  // FormData serialises to "{}" and the server takes its empty-upload path, answering 200
  // with `generic_attachment: []`. That is the documented no-op the index warns about, and
  // it looks exactly like success. So the one multipart step uses fetch directly, and
  // Content-Type is left unset on purpose: fetch writes the multipart boundary itself and
  // overriding it breaks the parse in a way that reads as a server rejection.
  if (body instanceof FormData) {
    delete headers["Content-Type"];
    const response = await fetch(`${base}${path}`, { method, headers, body });
    const text = await response.text().catch(() => "");
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep the text: a non-JSON body here is itself the diagnosis */
    }
    return { status: response.status, body: parsed };
  }

  return fetchTransport()(method, `${base}${path}`, headers, {}, body);
}

/** Hoisted to module scope: the find-or-create steps above run long before the gap-seeding
 *  block where this used to be declared, and a `const` read from earlier in the same scope
 *  is a temporal-dead-zone crash, not a type complaint. */
const ok = (status: number) => status >= 200 && status < 300;

function die(step: string, detail: unknown, status?: number): never {
  console.error(
    `\nseed failed at: ${step}${status !== undefined ? `  (HTTP ${status})` : ""}`,
  );
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  // A null body with status 0 means the request never reached the product. Say so, rather
  // than printing "null" and leaving the reader to guess.
  console.error(
    text && text !== "null"
      ? text.slice(0, 400)
      : status === 0
        ? "the request did not complete — preprod unreachable, or the call timed out"
        : "(no detail returned)",
  );
  process.exit(1);
}

async function main() {
  if (process.argv.includes("--show")) {
    if (!existsSync(POOL))
      die("--show", "no pool yet; run `npm run seed:live` first");
    // Reprint from the parsed object, not the file text: the file holds the account and
    // this is stdout. Read the file directly if you need it.
    console.log(
      JSON.stringify(withoutAccount(JSON.parse(readFileSync(POOL, "utf8"))), null, 2),
    );
    return;
  }

  console.log(`seeding ${ENV}\n`);

  // 1. FIND OR CREATE the fixture project.
  const projects = await call("list_projects");
  if (projects.status !== 200)
    die("list_projects", projects.error ?? projects.body, projects.status);
  const all = projects.body?.projects ?? [];
  let project = all.find((p: any) => p.name === PROJECT_NAME);

  if (project) {
    console.log(
      `  project      FOUND    ${project.identifier} (id ${project.id})`,
    );
  } else {
    const created = await write(
      "create_project",
      { body: { name: PROJECT_NAME, description: PROJECT_NOTE } },
      "create the permanent capability-probe fixture project",
    );
    if (created.status >= 300)
      die("create_project", created.error ?? created.body);
    // The create response is thin; re-list so we hold both id forms from one source.
    const after = await call("list_projects");
    project = (after.body?.projects ?? []).find(
      (p: any) => p.name === PROJECT_NAME,
    );
    if (!project) die("create_project", "created but not found on re-list");
    console.log(
      `  project      CREATED  ${project.identifier} (id ${project.id})`,
    );
  }

  const pid = project.id as number;
  const pref = project.identifier as string;
  const pool: Pool = {
    env: ENV,
    account: USERNAME,
    project: { id: pid, identifier: pref, name: PROJECT_NAME },
    readonly: {},
    scratch: {},
    seeded_at: new Date().toISOString(),
  };

  // 2. THE TWO FOLDERS.
  const folders = await call("list_root_folders", {
    path_params: { project_id: pid },
  });
  const existing: any[] = folders.body?.folders ?? folders.body?.data ?? [];
  const findFolder = (name: string) =>
    existing.find((f: any) => f.name === name);

  for (const [name, into] of [
    [READONLY, "readonly"],
    [SCRATCH, "scratch"],
  ] as const) {
    const found = findFolder(name);
    if (found) {
      (pool as any)[into].folder = found.id;
      console.log(`  ${name.padEnd(12)} FOUND    id ${found.id}`);
      continue;
    }
    const made = await write(
      "create_root_folder",
      { path_params: { project_id: pid }, body: { name } },
      `create the ${name} region of the capability-probe fixture`,
    );
    if (made.status >= 300)
      die(`create_root_folder ${name}`, made.error ?? made.body);
    const id = made.body?.folder?.id ?? made.body?.id;
    (pool as any)[into].folder = id;
    console.log(`  ${name.padEnd(12)} CREATED  id ${id}`);
  }

  // A LISTING HELPER, because every find-or-create below needs the same two shapes.
  const listCases = async (folderId?: number) => {
    const r = await call("list_folder_test_cases", {
      path_params: { project_id: pid, folder_id: folderId },
    });
    return (r.body?.test_cases ?? r.body?.data?.test_cases ?? []) as any[];
  };
  // `name` on the way in comes back as `title` on the way out, and the v1 and v2 listings
  // do not agree on which they publish. Accept either rather than guess.
  const byName = (rows: any[], name: string) =>
    rows.find((c: any) => (c.title ?? c.name) === name);

  // 2b. SWEEP THE CHURN from whatever the last eval run created. See CHURN_* above.
  //
  // Each removal reports what it did. A cleanup that fails silently is worse than none: the
  // next create case would meet an object that already exists, the agent would either refuse
  // or make a duplicate, and the case would fail for a reason that has nothing to do with the
  // behaviour under test.
  const sweptFolder = findFolder(CHURN_FOLDER);
  if (sweptFolder) {
    const gone = await raw(
      "POST",
      `/api/v1/projects/${pid}/folder/${sweptFolder.id}/rm`,
    );
    console.log(
      ok(gone.status)
        ? `  churn folder SWEPT    ${CHURN_FOLDER} (${sweptFolder.id}) and its contents`
        : `  churn folder FAILED   rm returned ${gone.status}`,
    );
  }

  const churnRuns = await call("list_test_runs", {
    path_params: { project_id: pref },
  });
  for (const r of (churnRuns.body?.test_runs ?? []).filter(
    (r: any) => r.name === CHURN_RUN,
  )) {
    const gone = await raw(
      "POST",
      `/api/v1/projects/${pid}/test-runs/${r.id ?? r.identifier}/delete`,
    );
    console.log(
      ok(gone.status)
        ? `  churn run    SWEPT    ${r.identifier}`
        : `  churn run    FAILED   delete returned ${gone.status}`,
    );
  }

  const churnSteps = await call("get_shared_steps", {
    path_params: { project_id: pid },
  });
  for (const step of (
    churnSteps.body?.shared_steps ??
    churnSteps.body?.data?.shared_steps ??
    []
    // `create_shared_step` takes `title`; the listing is not consistent about which it
    // publishes, and a sweep that matches the wrong key is a cleanup that quietly does nothing.
  ).filter((s: any) => (s.title ?? s.name) === CHURN_SHARED_STEP)) {
    const gone = await raw(
      "DELETE",
      `/api/v1/projects/${pid}/shared-steps/${step.id}`,
    );
    console.log(
      ok(gone.status)
        ? `  churn step   SWEPT    ${step.id}`
        : `  churn step   FAILED   delete returned ${gone.status}`,
    );
  }

  // 3. READ-ONLY TEST CASES, ADDRESSED BY NAME.
  //
  // These used to be "the first two rows the folder listing returns". That is stable only
  // while nothing else is ever added to __readonly__ — and the BDD case further down is
  // created in this same folder, so as soon as it appeared the window slid and
  // `readonly.cases` began pointing at a different pair from one run to the next. Nothing
  // looked wrong: the pool was well-formed, both ids were real, every probe got its two
  // cases. But eval cases pinned to `readonly.cases.0` were quietly asserting against
  // whichever case happened to come back first that day, so a passing run proved nothing.
  // Names are the only stable handle here, exactly as the project itself is found by name.
  //
  // Created one at a time through v2 `create_test_case` rather than the v1 bulk endpoint:
  // bulk creates the whole batch or nothing, so it cannot repair a fixture that is missing
  // only one of the two.
  const readonlyCases: string[] = [];
  for (const name of [CASE_A, CASE_B]) {
    const found = byName(await listCases(pool.readonly.folder), name);
    if (found) {
      readonlyCases.push(found.identifier);
      console.log(`  ${name.padEnd(12)} FOUND    ${found.identifier}`);
      continue;
    }
    const made = await write(
      "create_test_case",
      {
        path_params: { project_id: pref, folder_id: pool.readonly.folder },
        body: { name, template: "test_case_steps" },
      },
      `seed the stable read-probe case "${name}"`,
    );
    if (!ok(made.status)) die(`create_test_case ${name}`, made.error ?? made.body);
    // Re-list rather than trust the create response: the identifier is what everything
    // downstream keys on, and the create body nests it differently between versions.
    const now = byName(await listCases(pool.readonly.folder), name);
    if (!now) die(`create_test_case ${name}`, "created, but absent from the folder listing");
    readonlyCases.push(now.identifier);
    console.log(`  ${name.padEnd(12)} CREATED  ${now.identifier}`);
  }
  pool.readonly.cases = readonlyCases;

  // 3b. THE SCRATCH CASE — the one object write probes and the write eval are allowed to mutate.
  //
  // This was previously made by hand, so the pool carried no `scratch.case` and a seeder run
  // against a clean account produced a fixture the write eval had nothing to target. It lives
  // in __scratch__ because it gets written to; no read probe asserts on its contents, which is
  // what makes the accumulating comments it collects harmless.
  //
  // Three steps, because the eval's write case asks for a comment about "the third step".
  const scratchFound = byName(await listCases(pool.scratch.folder), SCRATCH_CASE);
  if (scratchFound) {
    pool.scratch.case = scratchFound.identifier;
    console.log(`  scratch case FOUND    ${pool.scratch.case}`);
  } else {
    const made = await write(
      "create_test_case",
      {
        path_params: { project_id: pref, folder_id: pool.scratch.folder },
        body: {
          name: SCRATCH_CASE,
          template: "test_case_steps",
          test_case_steps: [
            { step: "Add an item to the basket", result: "The basket shows one item" },
            { step: "Open the checkout page", result: "Payment and delivery fields are shown" },
            { step: "Submit the order", result: "It works" },
          ],
        },
      },
      "seed the scratch test case that write probes and the write eval mutate",
    );
    if (!ok(made.status))
      die("create_test_case scratch", made.error ?? made.body);
    const now = byName(await listCases(pool.scratch.folder), SCRATCH_CASE);
    if (!now) die("create_test_case scratch", "created, but absent from the folder listing");
    pool.scratch.case = now.identifier;
    console.log(`  scratch case CREATED  ${pool.scratch.case}`);
  }

  // 4. A PLAN, then 5. A RUN inside it — `test_run` declares `parents: [test_plan, project]`.
  const plans = await call("list_test_plans", {
    path_params: { project_id: pref },
  });
  const plan = (plans.body?.test_plans ?? []).find(
    (p: any) => p.name === PLAN_NAME,
  );
  if (plan) {
    pool.readonly.plan = plan.identifier ?? plan.id;
    console.log(`  plan         FOUND    ${pool.readonly.plan}`);
  } else {
    const made = await write(
      "create_test_plan",
      { path_params: { project_id: pref }, body: { name: "probe plan" } },
      "seed one test plan for read probes",
    );
    if (made.status >= 300) die("create_test_plan", made.error ?? made.body);
    pool.readonly.plan =
      made.body?.test_plan?.identifier ?? made.body?.identifier;
    console.log(`  plan         CREATED  ${pool.readonly.plan}`);
  }

  const runs = await call("list_test_runs", {
    path_params: { project_id: pref },
  });
  const run = (runs.body?.test_runs ?? []).find(
    (r: any) => r.name === RUN_NAME,
  );
  if (run) {
    pool.readonly.run = run.identifier;
    console.log(`  run          FOUND    ${pool.readonly.run}`);
  } else {
    // Carry the case ids explicitly. `create_test_run_by_integer_id`'s own guidance: "a create whose
    // only case-bearing field is a filter rule succeeds and creates an EMPTY run."
    const made = await write(
      "create_test_run",
      {
        path_params: { project_id: pref },
        body: {
          name: "probe run",
          run_state: "new_run",
          test_cases: pool.readonly.cases ?? [],
        },
      },
      "seed one test run, with cases carried explicitly, for read probes",
    );
    if (made.status >= 300) die("create_test_run", made.error ?? made.body);
    pool.readonly.run =
      made.body?.test_run?.identifier ?? made.body?.identifier;
    console.log(`  run          CREATED  ${pool.readonly.run}`);
  }

  // FINDING AN OBJECT IS NOT CHECKING IT STILL MEANS WHAT THE POOL CLAIMS. TR-61 was found by
  // the lookup above on every single run and reported FOUND while holding zero cases: its
  // create had carried an empty `test_cases`, and nothing ever looked inside again. The eval
  // case that asks "which cases are in this run, and who owns each one" then had nothing to
  // answer from and scored as an agent failure, for a defect that was entirely in the fixture.
  // Every other find-or-create here checks existence only because existence is all those
  // objects have; a run also has contents, so the contents get checked too.
  const inRun = await call("list_test_run_test_cases", {
    path_params: { project_id: pref, test_run_id: pool.readonly.run },
  });
  const inRunCount =
    inRun.body?.info?.count ?? (inRun.body?.test_cases ?? []).length;
  if (inRunCount > 0) {
    console.log(`  run cases    FOUND    ${inRunCount} in ${pool.readonly.run}`);
  } else {
    // `test_cases` is the run's COMPLETE intended membership, not an append — which is what
    // we want here, since the run is empty and the pool's two cases are the whole intent.
    const filled = await write(
      "update_test_run",
      {
        path_params: { project_id: pref, test_run_id: pool.readonly.run },
        body: { test_cases: pool.readonly.cases ?? [] },
      },
      "populate the empty probe run, so run-scoped read probes have something to read",
    );
    console.log(
      ok(filled.status)
        ? `  run cases    CREATED  ${(pool.readonly.cases ?? []).join(", ")} in ${pool.readonly.run}`
        : `  run cases    FAILED   update returned ${filled.status} ${JSON.stringify(filled.error ?? filled.body).slice(0, 120)}`,
    );
  }

  // 5b. A SECOND RUN, IN __scratch__, AND ONE RECORDED RESULT.
  //
  // The __readonly__ run cannot serve the cases that edit run metadata or log results: a read
  // case asserts on its exact membership, so a write case pointed at it would break a read
  // case on the next run and the suite would start failing in a way that looks like routing.
  // Writes get their own run for the same reason writes get their own folder.
  //
  // The result matters as much as the run. "Show me the failed results from this run" has no
  // answer on a run whose cases are all untested, and an agent handed an empty list reports it
  // as empty — correctly — so the case passes while measuring nothing. Seeding one execution
  // is what makes the read assertable.
  const scratchRuns = await call("list_test_runs", {
    path_params: { project_id: pref },
  });
  const scratchRun = (scratchRuns.body?.test_runs ?? []).find(
    (r: any) => r.name === SCRATCH_RUN_NAME,
  );
  if (scratchRun) {
    pool.scratch.run = scratchRun.identifier;
    console.log(`  scratch run  FOUND    ${pool.scratch.run}`);
  } else {
    const made = await write(
      "create_test_run",
      {
        path_params: { project_id: pref },
        body: {
          name: SCRATCH_RUN_NAME,
          run_state: "new_run",
          test_cases: pool.scratch.case ? [pool.scratch.case] : [],
        },
      },
      "seed a scratch test run, so write probes never touch the run read probes assert on",
    );
    if (!ok(made.status)) die("create_test_run scratch", made.error ?? made.body);
    pool.scratch.run =
      made.body?.test_run?.identifier ?? made.body?.identifier;
    console.log(`  scratch run  CREATED  ${pool.scratch.run}`);
  }

  // One recorded execution, so "read the results" has something to read. Logging a result is
  // idempotent in the sense that matters here: it appends to the case's execution history
  // rather than creating another entity, so the fixture does not grow an object per run.
  const existingResults = await call("list_test_results_for_test_case", {
    path_params: {
      project_id: pref,
      test_run_id: pool.scratch.run,
      test_case_id: pool.scratch.case,
    },
  });
  const resultRows =
    existingResults.body?.test_results ?? existingResults.body?.results ?? [];
  if (resultRows.length > 0) {
    pool.scratch.result_logged = true;
    console.log(`  run result   FOUND    ${resultRows.length} on ${pool.scratch.case}`);
  } else {
    const logged = await write(
      "create_test_results_for_test_run",
      {
        path_params: { project_id: pref, test_run_id: pool.scratch.run },
        body: {
          test_case_id: pool.scratch.case,
          status: "failed",
          description: "Seeded execution, so result reads have something to return.",
        },
      },
      "record one test result, so read probes for results are not asserting against an empty list",
    );
    pool.scratch.result_logged = ok(logged.status);
    console.log(
      ok(logged.status)
        ? `  run result   CREATED  failed on ${pool.scratch.case} in ${pool.scratch.run}`
        : `  run result   FAILED   ${logged.status} ${JSON.stringify(logged.error ?? logged.body).slice(0, 140)}`,
    );
  }

  // ---- the three gaps that left four capabilities UNVERIFIED -------------------------
  //
  // Each is a capability the probes could reach but could not JUDGE: a clean 200 with an
  // empty collection proves nothing about the declared item shape. Seeding one row each
  // turns "nothing established" into a real verdict.

  // STATUS 0 IS NOT SUCCESS. `call` returns 0 for a bind-time refusal and for a transport
  // failure, and `status < 300` quietly counts both as a win — which is how this seeder
  // reported "attachment CREATED" for a call that never left the process, having been
  // refused for sending TC-NNN where an integer was required.

  pool.gaps = pool.gaps ?? {};

  // A BINNED CASE, for list_binned_test_cases and count_binned_test_cases.
  // Make one to delete rather than deleting anything that already exists.
  // REUSE THE THROWAWAY, DO NOT MINT ONE PER RUN. The name used to carry `Date.now()`, so it
  // was unique by construction and could never be found again; the only guard was
  // `!pool.gaps.binned_case`, which stays falsy forever on an account whose delete returns
  // 401. Every run therefore created one more undeletable case in __scratch__ — five of them
  // (TC-468, 470, 472, 474, 475) before this was caught, and in a nightly job that is one
  // more piece of permanent litter in a production project per night. A fixed prefix makes
  // the leftover findable, so a later run with working credentials bins the one that already
  // exists instead of adding to the pile.
  // Same correction as the attachment below: ask the bin what is in it rather than trust a
  // pool field that is rebuilt empty every run. A case already in the recycle bin satisfies
  // this gap completely, and binning another one each run grows the bin without end.
  const bin = await call("list_binned_test_cases", {
    path_params: { project_id: pool.project.id },
  });
  const alreadyBinned = (
    bin.body?.test_cases ??
    bin.body?.data?.test_cases ??
    []
  )[0];
  if (alreadyBinned?.id) pool.gaps.binned_case = alreadyBinned.id;

  // ASK WHETHER THE BIN EXISTS BEFORE FEEDING IT. The read answers
  // 403 {"error":"Move to Bin feature is not enabled for this user"} on accounts without the
  // feature, and an unreadable bin cannot satisfy the gap no matter how much goes into it —
  // so without this check the seeder DELETED A TEST CASE ON EVERY RUN to populate something
  // nothing can list. That was invisible while the delete itself was failing on a missing
  // auth header; fixing the auth turned a silent no-op into silent destruction.
  const binUnavailable = bin.status === 403 || bin.status === 404;
  if (binUnavailable) {
    pool.gaps.binned_case = null;
    console.log(
      `  binned case  SKIPPED  the recycle bin is not enabled for this account ` +
        `(${bin.status}), so nothing can read what is put in it`,
    );
  } else if (!pool.gaps.binned_case) {
    const scratchRows = await listCases(pool.scratch.folder);
    const leftover = scratchRows.find((r: any) =>
      String(r.title ?? r.name ?? "").startsWith(BIN_CASE_PREFIX),
    );
    let ident: string | undefined = leftover?.identifier;
    let id: number | undefined = leftover?.id;
    if (leftover) {
      console.log(`  bin victim   REUSED   ${ident}`);
    } else {
      const made = await write(
        "create_test_case",
        {
          path_params: { project_id: pref, folder_id: pool.scratch.folder },
          body: { name: `${BIN_CASE_PREFIX}victim` },
        },
        "seed a throwaway case, to be deleted so the recycle bin is non-empty",
      );
      // v2 creates answer with the TC-NNN identifier and no integer id; bulk-delete takes
      // `ids` as INTEGERS. The folder listing is what maps one to the other.
      ident =
        made.body?.data?.test_case?.identifier ?? made.body?.test_case?.identifier;
      if (ident)
        id = (await listCases(pool.scratch.folder)).find(
          (r: any) => r.identifier === ident,
        )?.id;
      if (!ok(made.status) || !id)
        console.log(
          `  bin victim   SKIPPED  create ${made.status}, identifier ${ident ?? "none"}`,
        );
    }
    if (id) {
      const gone = await raw(
        "POST",
        `/api/v1/projects/${pool.project.id}/test-cases/bulk-delete`,
        // raw() bypasses the registry, so the Rails `test_case` wrapper that json_path
        // normally adds for us has to be written by hand here.
        { test_case: { ids: [id], folder_id: pool.scratch.folder } },
        "application/json",
      );
      pool.gaps.binned_case = ok(gone.status) ? id : null;
      console.log(
        ok(gone.status)
          ? `  binned case  CREATED  ${id} (deleted into the bin)`
          : `  binned case  FAILED   delete returned ${gone.status}`,
      );
    } else {
      console.log(
        `  binned case  SKIPPED  no victim resolved (identifier ${ident ?? "none"})`,
      );
    }
  } else {
    console.log(`  binned case  FOUND    ${pool.gaps.binned_case}`);
  }

  // A SHARED STEP — and NOT for list_shared_components, which is the mistake this
  // comment exists to stop someone repeating.
  //
  // A shared component is not a shared step. Separate upstream collections, separate
  // controllers, separate id spaces, and the index has filed them apart since before this
  // seeder existed: the step capabilities are `entity: shared_step`, list_shared_components
  // is `entity: shared_field`. Seeding a step and reading components returns [] — correctly.
  //
  // list_shared_components cannot be seeded from here AT ALL: `shared_field` publishes one
  // read and no write anywhere in the index, so nothing on this surface can create its
  // subject. It stays UNVERIFIED until a shared component exists, which today means the
  // product UI. That is a coverage gap in the published surface, not a fixture problem.
  //
  // The step itself is still seeded: it gives get_shared_steps and its siblings a row,
  // which is worth having on its own terms.
  const steps = await call("get_shared_steps", {
    path_params: { project_id: pool.project.id },
  });
  const existingStep = (steps.body?.shared_steps ?? steps.body?.data ?? [])[0];
  if (existingStep) {
    pool.gaps.shared_step = existingStep.id ?? existingStep.identifier;
    console.log(`  shared step  FOUND    ${pool.gaps.shared_step}`);
  } else {
    const made = await write(
      "create_shared_step",
      {
        path_params: { project_id: pool.project.id },
        body: {
          title: "__probe-shared-step",
          shared_step_details: [{ order: 1, step: "probe step", result: "probe result" }],
        },
      },
      "seed one shared step so list_shared_components has an item shape to verify",
    );
    pool.gaps.shared_step =
      ok(made.status)
        ? (made.body?.data?.id ?? made.body?.shared_step?.id ?? made.body?.id)
        : null;
    console.log(
      ok(made.status)
        ? `  shared step  CREATED  ${pool.gaps.shared_step}`
        : `  shared step  SKIPPED  ${made.status}`,
    );
  }

  // A BDD TEST CASE, for validate_bdd_export_selection.
  //
  // That capability probed UNVERIFIED for a reason worth stating precisely: it did NOT
  // fail. It returned 400 {success:false, message:"No BDD Test Case(s) selected."} — the
  // validator working correctly and rejecting a selection, because the two `__readonly__`
  // cases are built on `test_case_steps` and the validator filters non-BDD cases out. Only
  // the rejection branch was ever exercised.
  //
  // Of the nine UNVERIFIED rows it is the ONLY one a seeder can close. The others are an
  // empty collection with no creator published (folder attachments), a collection empty
  // account-wide (shared components), a project setting we cannot flip (the two review
  // capabilities), or an async job with no status capability to poll (the two exports).
  //
  // Note this uses create_test_case, not the v1 bulk create used above: only the v2
  // body declares `template: test_case_bdd`, and the BDD branch REQUIRES Gherkin in
  // `feature` and `scenario` (422 if either is blank) while refusing `test_case_steps`
  // rows outright. The two shapes cannot be mixed, which is why this is a separate case
  // rather than a third entry in the bulk call.
  // GUARDED BY A NAME LOOKUP, NOT BY THE POOL. `if (!pool.gaps.bdd_case)` is only a guard on
  // an account that already has a pool file — and the pool is gitignored, so CI never does.
  // Every unattended run therefore minted another BDD case: two runs produced TC-471 and
  // TC-473 on the shared account, and since tm's delete returns 401 for these credentials,
  // they cannot be cleaned up. Find it the same way the project is found.
  const bddFound = byName(await listCases(pool.readonly.folder), BDD_CASE);
  if (bddFound) pool.gaps.bdd_case = bddFound.identifier;

  if (!pool.gaps.bdd_case) {
    const bdd = await write(
      "create_test_case",
      {
        path_params: {
          project_id: pool.project.identifier,
          folder_id: pool.readonly.folder,
        },
        body: {
          name: BDD_CASE,
          template: "test_case_bdd",
          feature: "Feature: capability probe\n  Exercises the BDD export validator.",
          scenario:
            "Scenario: a BDD case is selectable for export\n" +
            "  Given a test case on the BDD template\n" +
            "  When the export selection is validated\n" +
            "  Then the case is accepted",
        },
      },
      "seed one BDD-template case so validate_bdd_export_selection can exercise its ACCEPT branch, not only its reject branch",
    );
    pool.gaps.bdd_case = ok(bdd.status)
      ? (bdd.body?.test_case?.identifier ??
        bdd.body?.data?.test_case?.identifier ??
        bdd.body?.test_case?.id ??
        null)
      : null;
    console.log(
      pool.gaps.bdd_case
        ? `  bdd case     CREATED  ${pool.gaps.bdd_case}`
        : `  bdd case     SKIPPED  ${bdd.status} ${JSON.stringify(bdd.error ?? bdd.body).slice(0, 160)}`,
    );
  } else {
    console.log(`  bdd case     FOUND    ${pool.gaps.bdd_case}`);
  }

  // AN ATTACHMENT, for list_entity_attachments.
  //
  // Through the v2 route, which is MULTIPART and takes the file itself. That is the whole
  // reason this lives in the seeder and not in a capability: a byte stream cannot cross the
  // registry boundary, which is why tm's four upload capabilities are published, searchable
  // and inert. The v2 endpoint is not published and should not be — publishing it would add
  // a fifth inert entry, not close a gap.
  //
  // The v1 path was tried first and is dead: upload a blob, then attach it by id, and the
  // attach raises 500 on a well-formed request. So attaching a file to a case is not
  // possible through this surface by ANY route. The seeder can do it only because it is a
  // fixture builder talking to the product directly.
  //
  // Field name is `file`. `attachments[]`, `attachment`, `files[]` and sending no file at
  // all all produce the SAME 422 — the error cannot distinguish a wrong field name from a
  // missing one.
  // GUARDED ON THE LIVE STATE, like everything else here. `pool.gaps` is rebuilt empty on
  // every run — nothing reads the previous pool file back — so `if (!pool.gaps.attachment)`
  // was always true, and this block uploaded another attachment to a __readonly__ case every
  // single run. The 401 hid it until the missing await was fixed; the first authenticated run
  // was also the first run that could accumulate.
  const priorAttachments = await call("list_entity_attachments", {
    path_params: {
      project_id: pool.project.identifier,
      entity_type: "test-cases",
      entity_id: pool.readonly.cases?.[0],
    },
  });
  const priorAttachment = (
    priorAttachments.body?.attachments ??
    priorAttachments.body?.data?.attachments ??
    []
  )[0];
  if (priorAttachment?.id) pool.gaps.attachment = priorAttachment.id;

  if (!pool.gaps.attachment) {
    const target = (
      await call("list_folder_test_cases", {
        path_params: { project_id: pool.project.id, folder_id: pool.readonly.folder },
      })
    ).body?.test_cases?.find((r: any) => r.identifier === pool.readonly.cases?.[0]);
    const form = new FormData();
    form.append(
      "file",
      new Blob([`probe attachment ${new Date().toISOString()}\n`], { type: "text/plain" }),
      "probe.txt",
    );
    const attached = await raw(
      "POST",
      `/api/v2/projects/${pool.project.identifier}/test-cases/${pool.readonly.cases?.[0]}/attachments`,
      form,
    );
    const id = (attached.body as any)?.attachment?.id;
    pool.gaps.attachment = ok(attached.status) && id ? id : null;
    console.log(
      pool.gaps.attachment
        ? `  attachment   CREATED  ${id} on ${pool.readonly.cases?.[0]}`
        : `  attachment   FAILED   v2 attach ${attached.status}`,
    );
    void target;
  } else {
    console.log(`  attachment   FOUND    ${pool.gaps.attachment}`);
  }

  mkdirSync(`${ROOT}tests/live`, { recursive: true });
  writeFileSync(POOL, JSON.stringify(pool, null, 2) + "\n");
  console.log(`\npool -> tests/live/.id-pool.json`);
  // The file above holds the real account; what gets printed does not.
  console.log(JSON.stringify(withoutAccount(pool), null, 2));
}

main().catch((error) => die("unexpected", error?.stack ?? String(error)));
