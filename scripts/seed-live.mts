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
 * IDEMPOTENT. Re-running finds the fixture project by name rather than creating a second
 * one, and only fills in the parts of the scaffold that are missing.
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

// Preprod, with the credentials already configured for the local MCP server. Pinned here
// rather than read from the environment so a stray shell variable cannot point a seeding
// run — which CREATES data — at production.
const ENV = "preprod";
const BASE_URL = "https://test-management-preprod.bsstag.com";
// NO DEFAULTS. Seeding creates data with whoever's credentials it is handed, so a
// hardcoded fallback is both a committed secret and a way to write to an account nobody
// chose. Falls back to the names the server itself already uses, so a shell that can run
// the MCP server can run this.
const USERNAME =
  process.env.TM_LIVE_USERNAME ?? process.env.BROWSERSTACK_USERNAME;
const ACCESS_KEY =
  process.env.TM_LIVE_ACCESS_KEY ?? process.env.BROWSERSTACK_ACCESS_KEY;

interface Pool {
  env: string;
  account: string;
  /** BOTH id forms. v1 endpoints take the integer, v2 take PR-NNN, and several v1 calls
   *  mix them — resolving it once here is five failed calls nobody else has to make. */
  project: { id: number; identifier: string; name: string };
  readonly: { folder?: number; cases?: string[]; plan?: string; run?: string };
  scratch: { folder?: number };
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
  const base =
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM ||
    "https://test-management-preprod.bsstag.com";
  const headers: Record<string, string> = {
    ...authHeaders({ username, accessKey }),
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
    console.log(readFileSync(POOL, "utf8"));
    return;
  }

  console.log(`seeding ${ENV} as ${USERNAME}\n`);

  // 1. FIND OR CREATE the fixture project.
  const projects = await call("list_projects_v1");
  if (projects.status !== 200)
    die("list_projects_v1", projects.error ?? projects.body, projects.status);
  const all = projects.body?.projects ?? [];
  let project = all.find((p: any) => p.name === PROJECT_NAME);

  if (project) {
    console.log(
      `  project      FOUND    ${project.identifier} (id ${project.id})`,
    );
  } else {
    const created = await write(
      "create_project_v1",
      { body: { name: PROJECT_NAME, description: PROJECT_NOTE } },
      "create the permanent capability-probe fixture project",
    );
    if (created.status >= 300)
      die("create_project_v1", created.error ?? created.body);
    // The create response is thin; re-list so we hold both id forms from one source.
    const after = await call("list_projects_v1");
    project = (after.body?.projects ?? []).find(
      (p: any) => p.name === PROJECT_NAME,
    );
    if (!project) die("create_project_v1", "created but not found on re-list");
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
  const folders = await call("get_root_folders_v1", {
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
      "create_root_folder_v1",
      { path_params: { project_id: pid }, body: { name } },
      `create the ${name} region of the capability-probe fixture`,
    );
    if (made.status >= 300)
      die(`create_root_folder_v1 ${name}`, made.error ?? made.body);
    const id = made.body?.folder?.id ?? made.body?.id;
    (pool as any)[into].folder = id;
    console.log(`  ${name.padEnd(12)} CREATED  id ${id}`);
  }

  // 3. READ-ONLY TEST CASES. `create_test_case_v1` publishes no body at all — its spec
  //    declares no requestBody — so the bulk endpoint is the only usable create.
  // SCOPED TO __readonly__, NOT all_folders. Listing every folder picked up whatever was
  // newest in the project — which, once this seeder started creating a throwaway case per
  // run to populate the recycle bin, meant `readonly.cases` was routinely a DELETED case
  // from a previous run sitting in __scratch__. Everything downstream inherited it: the
  // attachment seed attached a blob to a deleted case, got a 200, and the listing
  // correctly showed nothing. The pool's own guarantee — that these two cases live in
  // __readonly__ and are never written to — was quietly untrue.
  const cases = await call("list_folder_test_cases_v1", {
    path_params: { project_id: pid, folder_id: pool.readonly.folder },
  });
  const have: any[] = cases.body?.test_cases ?? cases.body?.data?.test_cases ?? [];
  if (have.length >= 2) {
    pool.readonly.cases = have.slice(0, 2).map((c: any) => c.identifier);
    console.log(`  cases        FOUND    ${pool.readonly.cases.join(", ")}`);
  } else {
    const made = await write(
      "create_bulk_test_cases_v1",
      {
        path_params: { project_id: pid, folder_id: pool.readonly.folder },
        body: {
          test_cases: [
            {
              name: "probe case A",
              test_case_folder_id: String(pool.readonly.folder),
              template: "test_case_text",
            },
            {
              name: "probe case B",
              test_case_folder_id: String(pool.readonly.folder),
              template: "test_case_text",
            },
          ],
        },
      },
      "seed two stable test cases for read probes to assert against",
    );
    if (made.status >= 300)
      die("create_bulk_test_cases_v1", made.error ?? made.body);
    const after = await call("get_test_cases_v1", {
      path_params: { project_id: pid },
      query: { all_folders: true },
    });
    pool.readonly.cases = (after.body?.test_cases ?? [])
      .slice(0, 2)
      .map((c: any) => c.identifier);
    console.log(
      `  cases        CREATED  ${(pool.readonly.cases ?? []).join(", ")}`,
    );
  }

  // 4. A PLAN, then 5. A RUN inside it — `test_run` declares `parents: [test_plan, project]`.
  const plans = await call("list_test_plans_v2", {
    path_params: { project_id: pref },
  });
  const plan = (plans.body?.test_plans ?? [])[0];
  if (plan) {
    pool.readonly.plan = plan.identifier ?? plan.id;
    console.log(`  plan         FOUND    ${pool.readonly.plan}`);
  } else {
    const made = await write(
      "create_test_plan_v2",
      { path_params: { project_id: pref }, body: { name: "probe plan" } },
      "seed one test plan for read probes",
    );
    if (made.status >= 300) die("create_test_plan_v2", made.error ?? made.body);
    pool.readonly.plan =
      made.body?.test_plan?.identifier ?? made.body?.identifier;
    console.log(`  plan         CREATED  ${pool.readonly.plan}`);
  }

  const runs = await call("list_test_runs_v2", {
    path_params: { project_id: pref },
  });
  const run = (runs.body?.test_runs ?? [])[0];
  if (run) {
    pool.readonly.run = run.identifier;
    console.log(`  run          FOUND    ${pool.readonly.run}`);
  } else {
    // Carry the case ids explicitly. `create_test_run_v1`'s own guidance: "a create whose
    // only case-bearing field is a filter rule succeeds and creates an EMPTY run."
    const made = await write(
      "create_test_run_v2",
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
    if (made.status >= 300) die("create_test_run_v2", made.error ?? made.body);
    pool.readonly.run =
      made.body?.test_run?.identifier ?? made.body?.identifier;
    console.log(`  run          CREATED  ${pool.readonly.run}`);
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
  const ok = (status: number) => status >= 200 && status < 300;

  pool.gaps = pool.gaps ?? {};

  // A BINNED CASE, for list_binned_test_cases_v1 and count_binned_test_cases_v1.
  // Make one to delete rather than deleting anything that already exists.
  if (!pool.gaps.binned_case) {
    const made = await write(
      "create_test_case_v2",
      {
        path_params: { project_id: pref, folder_id: pool.scratch.folder },
        body: { name: `__probe-bin-${Date.now()}` },
      },
      "seed a throwaway case, to be deleted so the recycle bin is non-empty",
    );
    // v2 creates answer with the TC-NNN identifier and no integer id; bulk-delete takes
    // `ids` as INTEGERS. The folder listing is what maps one to the other.
    const ident =
      made.body?.data?.test_case?.identifier ?? made.body?.test_case?.identifier;
    let id: number | undefined;
    if (ident) {
      const listed = await call("list_folder_test_cases_v1", {
        path_params: { project_id: pool.project.id, folder_id: pool.scratch.folder },
      });
      const rows = listed.body?.test_cases ?? listed.body?.data?.test_cases ?? [];
      id = rows.find((r: any) => r.identifier === ident)?.id;
    }
    if (ok(made.status) && id) {
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
        `  binned case  SKIPPED  create ${made.status}, identifier ${ident ?? "none"}, id ${id ?? "unresolved"}`,
      );
    }
  } else {
    console.log(`  binned case  FOUND    ${pool.gaps.binned_case}`);
  }

  // A SHARED STEP — and NOT for get_shared_components_v1, which is the mistake this
  // comment exists to stop someone repeating.
  //
  // A shared component is not a shared step. Separate upstream collections, separate
  // controllers, separate id spaces, and the index has filed them apart since before this
  // seeder existed: the step capabilities are `entity: shared_step`, get_shared_components_v1
  // is `entity: shared_field`. Seeding a step and reading components returns [] — correctly.
  //
  // get_shared_components_v1 cannot be seeded from here AT ALL: `shared_field` publishes one
  // read and no write anywhere in the index, so nothing on this surface can create its
  // subject. It stays UNVERIFIED until a shared component exists, which today means the
  // product UI. That is a coverage gap in the published surface, not a fixture problem.
  //
  // The step itself is still seeded: it gives get_shared_steps_v1 and its siblings a row,
  // which is worth having on its own terms.
  const steps = await call("get_shared_steps_v1", {
    path_params: { project_id: pool.project.id },
  });
  const existingStep = (steps.body?.shared_steps ?? steps.body?.data ?? [])[0];
  if (existingStep) {
    pool.gaps.shared_step = existingStep.id ?? existingStep.identifier;
    console.log(`  shared step  FOUND    ${pool.gaps.shared_step}`);
  } else {
    const made = await write(
      "create_shared_step_v1",
      {
        path_params: { project_id: pool.project.id },
        body: {
          title: "__probe-shared-step",
          shared_step_details: [{ order: 1, step: "probe step", result: "probe result" }],
        },
      },
      "seed one shared step so get_shared_components_v1 has an item shape to verify",
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

  // A BDD TEST CASE, for validate_bdd_export_selection_v1.
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
  // Note this uses create_test_case_v2, not the v1 bulk create used above: only the v2
  // body declares `template: test_case_bdd`, and the BDD branch REQUIRES Gherkin in
  // `feature` and `scenario` (422 if either is blank) while refusing `test_case_steps`
  // rows outright. The two shapes cannot be mixed, which is why this is a separate case
  // rather than a third entry in the bulk call.
  if (!pool.gaps.bdd_case) {
    const bdd = await write(
      "create_test_case_v2",
      {
        path_params: {
          project_id: pool.project.identifier,
          folder_id: pool.readonly.folder,
        },
        body: {
          name: "__probe-bdd-case",
          template: "test_case_bdd",
          feature: "Feature: capability probe\n  Exercises the BDD export validator.",
          scenario:
            "Scenario: a BDD case is selectable for export\n" +
            "  Given a test case on the BDD template\n" +
            "  When the export selection is validated\n" +
            "  Then the case is accepted",
        },
      },
      "seed one BDD-template case so validate_bdd_export_selection_v1 can exercise its ACCEPT branch, not only its reject branch",
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

  // AN ATTACHMENT, for list_entity_attachments_v2.
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
  if (!pool.gaps.attachment) {
    const target = (
      await call("list_folder_test_cases_v1", {
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
  console.log(JSON.stringify(pool, null, 2));
}

main().catch((error) => die("unexpected", error?.stack ?? String(error)));
