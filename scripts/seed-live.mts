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
  const cases = await call("get_test_cases_v1", {
    path_params: { project_id: pid },
    query: { all_folders: true },
  });
  const have: any[] = cases.body?.test_cases ?? [];
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

  mkdirSync(`${ROOT}tests/live`, { recursive: true });
  writeFileSync(POOL, JSON.stringify(pool, null, 2) + "\n");
  console.log(`\npool -> tests/live/.id-pool.json`);
  console.log(JSON.stringify(pool, null, 2));
}

main().catch((error) => die("unexpected", error?.stack ?? String(error)));
