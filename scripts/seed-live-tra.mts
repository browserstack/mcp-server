/**
 * Find-or-create the TRA fixture the live capability probes run against, and publish an id
 * pool for them to read. The tra counterpart of seed-live.mts (tm).
 *
 *   npx tsx scripts/seed-live-tra.mts            resolve, seed, write the pool
 *   npx tsx scripts/seed-live-tra.mts --show     print the existing pool and exit
 *
 * WHY INGESTION, NOT THE REGISTRY. TRA has no create-project or create-build API a customer
 * can call: `create_project` is service-to-service only, and builds only ever come from
 * ingestion — an SDK run or a JUnit XML upload. So the one data-creating step here is a
 * JUnit upload to the upload host. Everything after it (finding the project, the builds and
 * their test runs) goes through invokeCapability, because that is what the probes exercise.
 *
 * ACCOUNT GUARD. This script creates data, and TRA group 2 is BrowserStack's company-wide
 * group. It refuses to run unless the caller's group equals TRA_LIVE_EXPECT_GROUP, and it
 * refuses group 2 outright. There are no credential or host defaults, for the same reason.
 *
 * IDEMPOTENT. Re-running finds the fixture project by name and uploads only the builds that
 * are missing (matched by build name and how many of that name already exist).
 *
 * TWO REGIONS, as in tm:
 *   readonly   builds read probes assert against — never written to
 *   scratch    builds write probes may close, tag, mute, categorise or analyse
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { BrowserStackMcpServer } from "../src/server-factory.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const POOL = `${ROOT}tests/live/.id-pool-tra.json`;

const PROJECT_NAME = "__mcp-probe-tra";
const COMPANY_GROUP = 2;

function required(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    console.error(
      `seed refused: ${name} is required. This script creates data, so it will not guess.`,
    );
    process.exit(1);
  }
  return value;
}

/**
 * Credentials: TRA_LIVE_USERNAME / TRA_LIVE_ACCESS_KEY, or — with an explicit
 * `--creds-from-mcp <server>` — the env block of a locally registered MCP server, read
 * in-process so the key never passes through a shell or a log. Deliberately NO fallback to
 * BROWSERSTACK_*: those are the maintainer's own account, which is the one this must not seed.
 */
function credentials(): { username: string; accessKey: string } {
  const flag = process.argv.indexOf("--creds-from-mcp");
  if (flag !== -1) {
    const server = process.argv[flag + 1];
    const config = JSON.parse(
      readFileSync(`${homedir()}/.claude.json`, "utf8"),
    );
    for (const project of Object.values<any>(config.projects ?? {})) {
      const env = project?.mcpServers?.[server]?.env;
      if (env?.BROWSERSTACK_USERNAME && env?.BROWSERSTACK_ACCESS_KEY) {
        return {
          username: env.BROWSERSTACK_USERNAME,
          accessKey: env.BROWSERSTACK_ACCESS_KEY,
        };
      }
    }
    console.error(
      `seed refused: no credentials found for MCP server "${server}".`,
    );
    process.exit(1);
  }
  const username = process.env.TRA_LIVE_USERNAME;
  const accessKey = process.env.TRA_LIVE_ACCESS_KEY;
  if (!username || !accessKey) {
    console.error(
      "seed refused: set TRA_LIVE_USERNAME / TRA_LIVE_ACCESS_KEY for the dummy account,\n" +
        "  or pass --creds-from-mcp <server> to use a registered MCP server's credentials.",
    );
    process.exit(1);
  }
  return { username, accessKey };
}

// ---------------------------------------------------------------------------------------
// Fixture definition
// ---------------------------------------------------------------------------------------

type Outcome = "pass" | "fail" | "skip";
interface Case {
  suite: string;
  file: string;
  name: string;
  outcome: Outcome;
  error?: { type: string; message: string; line: number };
}

const CHECKOUT_FAIL = {
  type: "AssertionError",
  message: "Expected payment status 200 but received 500",
  line: 42,
};
const DISCOUNT_FAIL = {
  type: "AssertionError",
  message: "Expected total 90.00 but received 100.00",
  line: 78,
};
const WIDGET_TIMEOUT = {
  type: "TimeoutError",
  message: 'Timed out 5000ms waiting for selector "#widgets-panel"',
  line: 31,
};
const SEARCH_FLAKE = {
  type: "TimeoutError",
  message: "Request to /api/search timed out after 3000ms",
  line: 19,
};
// A different error class from LOGIN_NEW, so the final regression build's failure lands in
// a cluster none of the earlier runs used — which is what the NEW new-failure rule checks.
const LOGIN_BRAND_NEW = {
  type: "TypeError",
  message: "Cannot read properties of undefined (reading 'accessToken')",
  line: 64,
};
const LOGIN_NEW = {
  type: "AssertionError",
  message: "Expected redirect to /home but was /login?error=session",
  line: 27,
};

/**
 * Run shapes. first/second/smoke/scratch are the original fixture; hist_fail / hist_pass /
 * final extend the regression series so the history analyzer's smart tags can trip. Its
 * defaults (observability-pipeline HistoryAnalyzerService + common/dto SmartTags):
 *   always failing  >= 5 runs, the last 5 all failed with the SAME error cluster
 *   new failure     >= 5 runs, latest failed, its cluster absent from the previous 4
 *   flaky           >= 10 runs, more than 5 status flips across the last 10
 */
type Run =
  | "first"
  | "second"
  | "smoke"
  | "scratch"
  | "hist_fail"
  | "hist_pass"
  | "final";
const SEARCH_FAILS: Run[] = ["first", "scratch", "hist_fail"];

function cases(run: Run): Case[] {
  const all: Case[] = [
    // Always failing across both regression runs.
    {
      suite: "Checkout Suite",
      file: "checkout.test.js",
      name: "completes payment",
      outcome: "fail",
      error: CHECKOUT_FAIL,
    },
    {
      suite: "Checkout Suite",
      file: "checkout.test.js",
      name: "applies discount code",
      outcome: "fail",
      error: DISCOUNT_FAIL,
    },
    {
      suite: "Checkout Suite",
      file: "checkout.test.js",
      name: "shows order summary",
      outcome: "pass",
    },
    // Same timeout signature, so failure clustering has something to group.
    {
      suite: "Dashboard Suite",
      file: "dashboard.test.js",
      name: "loads widgets panel",
      outcome: "fail",
      error: WIDGET_TIMEOUT,
    },
    {
      suite: "Dashboard Suite",
      file: "dashboard.test.js",
      name: "renders header",
      outcome: "pass",
    },
    // Flaky: fails on the first run, passes on the second.
    {
      suite: "Search Suite",
      file: "search.test.js",
      name: "returns results for a query",
      outcome: SEARCH_FAILS.includes(run) ? "fail" : "pass",
      error: SEARCH_FLAKE,
    },
    {
      suite: "Search Suite",
      file: "search.test.js",
      name: "handles empty query",
      outcome: "pass",
    },
    // New failure: passes on the first run, fails on the second.
    {
      suite: "Auth Suite",
      file: "auth.test.js",
      name: "logs in with valid credentials",
      outcome: run === "second" || run === "final" ? "fail" : "pass",
      error: run === "final" ? LOGIN_BRAND_NEW : LOGIN_NEW,
    },
    {
      suite: "Auth Suite",
      file: "auth.test.js",
      name: "logs out",
      outcome: "pass",
    },
    {
      suite: "Auth Suite",
      file: "auth.test.js",
      name: "supports SSO login",
      outcome: "skip",
    },
  ];
  if (run === "smoke")
    return all.map((c) => ({
      ...c,
      outcome: c.outcome === "skip" ? "skip" : "pass",
    }));
  return all;
}

interface Scenario {
  key: string;
  region: "readonly" | "scratch" | "history";
  buildName: string;
  occurrence: number; // 1-based: which build of this name this is
  run: Run;
  tags: string[];
}

// BUILD NAMES ARE STORED NORMALISED. Ingestion rewrites a build name — "__mcp-probe__ regression"
// came back as "mcp-probe_regression", with no originalName — so a name that is not already in
// that form never matches on the next run, and the idempotency check re-uploads everything (the
// first seeding run did exactly that). These are written in the stored form so they round-trip.
const SCENARIOS: Scenario[] = [
  {
    key: "regression_1",
    region: "readonly",
    buildName: "mcp-probe_regression",
    occurrence: 1,
    run: "first",
    tags: ["mcp-probe", "readonly", "regression"],
  },
  {
    key: "regression_2",
    region: "readonly",
    buildName: "mcp-probe_regression",
    occurrence: 2,
    run: "second",
    tags: ["mcp-probe", "readonly", "regression"],
  },
  // History for the smart tags: #3/#4 repeat first/second, #5-#11 alternate the search test
  // and keep login passing, #12 fails login with a brand-new error. Read-only like #1/#2.
  ...(
    [
      [3, "first"],
      [4, "second"],
      [5, "hist_fail"],
      [6, "hist_pass"],
      [7, "hist_fail"],
      [8, "hist_pass"],
      [9, "hist_fail"],
      [10, "hist_pass"],
      [11, "hist_fail"],
    ] as const
  ).map(
    ([n, run]): Scenario => ({
      key: `regression_${n}`,
      region: "history",
      buildName: "mcp-probe_regression",
      occurrence: n,
      run,
      tags: ["mcp-probe", "readonly", "regression"],
    }),
  ),
  {
    key: "smart_tags",
    region: "readonly",
    buildName: "mcp-probe_regression",
    occurrence: 12,
    run: "final",
    tags: ["mcp-probe", "readonly", "regression"],
  },
  {
    key: "smoke",
    region: "readonly",
    buildName: "mcp-probe_smoke",
    occurrence: 1,
    run: "smoke",
    tags: ["mcp-probe", "readonly", "smoke"],
  },
  {
    key: "scratch_1",
    region: "scratch",
    buildName: "mcp-probe_scratch",
    occurrence: 1,
    run: "scratch",
    tags: ["mcp-probe", "scratch"],
  },
  {
    key: "scratch_2",
    region: "scratch",
    buildName: "mcp-probe_scratch",
    occurrence: 2,
    run: "scratch",
    tags: ["mcp-probe", "scratch"],
  },
  {
    key: "scratch_3",
    region: "scratch",
    buildName: "mcp-probe_scratch",
    occurrence: 3,
    run: "scratch",
    tags: ["mcp-probe", "scratch"],
  },
];

const xmlEscape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function junit(scenario: Scenario): string {
  const now = new Date().toISOString().slice(0, 19);
  const list = cases(scenario.run);
  const bySuite = new Map<string, Case[]>();
  for (const c of list)
    bySuite.set(c.file, [...(bySuite.get(c.file) ?? []), c]);
  const failures = list.filter((c) => c.outcome === "fail").length;
  const skipped = list.filter((c) => c.outcome === "skip").length;
  const suites = [...bySuite.entries()].map(([file, items]) => {
    const body = items
      .map((c) => {
        const open = `    <testcase classname="${xmlEscape(c.suite)}" name="${xmlEscape(c.name)}" time="1.0"`;
        if (c.outcome === "pass") return `${open}/>`;
        if (c.outcome === "skip")
          return `${open}>\n      <skipped/>\n    </testcase>`;
        const e = c.error!;
        const trace = `${e.type}: ${e.message}\n    at Object.<anonymous> (${c.file}:${e.line}:18)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;
        return `${open}>\n      <failure message="${xmlEscape(e.message)}" type="${e.type}">${xmlEscape(trace)}</failure>\n    </testcase>`;
      })
      .join("\n");
    const f = items.filter((c) => c.outcome === "fail").length;
    const s = items.filter((c) => c.outcome === "skip").length;
    return `  <testsuite name="${file}" tests="${items.length}" failures="${f}" errors="0" skipped="${s}" time="${items.length}.0" timestamp="${now}">\n${body}\n  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xmlEscape(scenario.buildName)}" tests="${list.length}" failures="${failures}" errors="0" skipped="${skipped}" time="${list.length}.0">\n${suites.join("\n")}\n</testsuites>\n`;
}

// ---------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------

const BASE_URL = process.argv.includes("--show")
  ? ""
  : required("CAPABILITY_REGISTRY_BASE_URL_TRA");
const UPLOAD_URL = process.argv.includes("--show")
  ? ""
  : required("TRA_UPLOAD_URL");
const EXPECT_GROUP = process.argv.includes("--show")
  ? 0
  : Number(required("TRA_LIVE_EXPECT_GROUP"));

let tools: any;

async function call(
  name: string,
  args: Record<string, unknown> = {},
  attempt = 1,
): Promise<{ status: number; body: any; error?: string }> {
  const result = await tools.invokeCapability.handler(
    { name, product: "tra", ...args },
    {} as any,
  );
  const payload = JSON.parse(result.content[0].text);
  const status = payload.http_response?.status ?? 0;
  if (status === 0 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return call(name, args, attempt + 1);
  }
  return {
    status,
    body: payload.http_response?.body,
    error: payload.error ?? payload.http_response?.error,
  };
}

function die(step: string, detail: unknown, status?: number): never {
  console.error(
    `\nseed failed at: ${step}${status !== undefined ? `  (HTTP ${status})` : ""}`,
  );
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.error(
    text && text !== "null" ? text.slice(0, 500) : "(no detail returned)",
  );
  process.exit(1);
}

async function upload(
  scenario: Scenario,
  creds: { username: string; accessKey: string },
) {
  const form = new FormData();
  form.append(
    "data",
    new Blob([junit(scenario)], { type: "text/xml" }),
    `${scenario.key}.xml`,
  );
  form.append("projectName", PROJECT_NAME);
  form.append("buildName", scenario.buildName);
  form.append("tags", scenario.tags.join(","));
  const auth = Buffer.from(`${creds.username}:${creds.accessKey}`).toString(
    "base64",
  );
  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body: form,
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) die(`upload ${scenario.key}`, text, response.status);
  return text.slice(0, 300);
}

// ---------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------

async function projects(): Promise<any[]> {
  const r = await call("list_projects_full");
  if (r.status !== 200 || !Array.isArray(r.body))
    die("list_projects_full", r.error ?? r.body, r.status);
  return r.body;
}

async function builds(projectId: number): Promise<any[]> {
  const out: any[] = [];
  const now = Date.now();
  let next: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query: Record<string, unknown> = {
      date_range: [now - 90 * 86400_000, now + 3600_000],
    };
    if (next) query.next_page = next;
    const r = await call("list_project_builds_via_public_api", {
      path_params: { project_id: projectId },
      query,
    });
    if (r.status !== 200)
      die("list_project_builds_via_public_api", r.error ?? r.body, r.status);
    // The live listing is snake_case (build_id, original_name, build_number, ...) although the
    // index declares camelCase (uuid, originalName, buildNumber). Accept both.
    out.push(
      ...(r.body?.builds ?? []).map((b: any) => ({
        ...b,
        uuid: b.uuid ?? b.build_id,
        originalName: b.originalName ?? b.original_name,
        buildNumber: b.buildNumber ?? b.build_number,
        startedAt: b.startedAt ?? b.started_at,
      })),
    );
    const p = r.body?.pagination ?? {};
    const hasNext = p.hasNext ?? p.has_next;
    next = p.nextPage ?? p.next_page;
    if (!hasNext || !next || (r.body?.builds ?? []).length === 0) break;
  }
  return out;
}

/**
 * Leaf test runs out of the nested ROOT -> DESCRIBE -> TEST hierarchy.
 *
 * A TEST node carries NO id field of its own. The integer test-run id — what the
 * /testRun/{test_run_id} and /testRuns/{testRunId} paths take — appears only as the
 * `details=` parameter of the node's observability_url; each retry carries its own uuid.
 */
function leaves(node: any, acc: any[] = []): any[] {
  if (Array.isArray(node)) {
    for (const n of node) leaves(n, acc);
    return acc;
  }
  if (!node || typeof node !== "object") return acc;
  if (node.type === "TEST") {
    const d = node.details ?? {};
    const match = /[?&]details=(\d+)/.exec(String(d.observability_url ?? ""));
    acc.push({
      test_run_id: match ? Number(match[1]) : null,
      name: node.display_name,
      status: d.status,
      is_flaky: d.is_flaky,
      is_new_failure: d.is_new_failure,
      is_always_failing: d.is_always_failing,
      is_muted: d.is_muted,
      retry_uuids: (d.retries ?? []).map((r: any) => r.uuid),
    });
    return acc;
  }
  leaves(node.children ?? [], acc);
  return acc;
}

async function testRuns(buildUuid: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = await call("list_build_test_runs", {
      path_params: { build_id: buildUuid },
      query: next ? { next_page: next } : {},
    });
    if (r.status !== 200)
      return out.length
        ? out
        : [
            {
              error: `HTTP ${r.status}`,
              detail: String(r.error ?? JSON.stringify(r.body)).slice(0, 200),
            },
          ];
    leaves(r.body?.hierarchy ?? [], out);
    const p = r.body?.pagination ?? {};
    next = p.nextPage ?? p.next_page;
    if (!(p.hasNext ?? p.has_next) || !next) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------

async function main() {
  if (process.argv.includes("--show")) {
    if (!existsSync(POOL)) die("--show", "no pool yet; run the seeder first");
    const { account: _omitted, ...rest } = JSON.parse(
      readFileSync(POOL, "utf8"),
    );
    console.log(JSON.stringify(rest, null, 2));
    return;
  }
  const creds = credentials();
  process.env.CAPABILITY_REGISTRY_INDEX_DIR = `${ROOT}capability/`;
  process.env.CAPABILITY_REGISTRY_BASE_URL_TRA = BASE_URL;
  tools = new BrowserStackMcpServer({
    "browserstack-username": creds.username,
    "browserstack-access-key": creds.accessKey,
  } as any).getTools();

  // 1. Account guard.
  const before = await projects();
  const group = before[0]?.groupId;
  if (group === undefined)
    die("account guard", "the account has no projects to read a groupId from");
  if (group === COMPANY_GROUP)
    die("account guard", "refusing to seed TRA group 2 (company-wide group)");
  if (group !== EXPECT_GROUP)
    die(
      "account guard",
      `caller's group is ${group}, expected ${EXPECT_GROUP}`,
    );
  console.log(`account guard ok: group ${group}`);

  // 2. Upload whatever is missing.
  let project = before.find((p) => p.name === PROJECT_NAME);
  const existing = project ? await builds(project.id) : [];
  const countByName = (list: any[], name: string) =>
    list.filter((b) => b.name === name).length;
  const uploaded: string[] = [];
  for (const s of SCENARIOS) {
    const have =
      countByName(existing, s.buildName) +
      uploaded.filter(
        (k) => SCENARIOS.find((x) => x.key === k)!.buildName === s.buildName,
      ).length;
    if (have >= s.occurrence) continue;
    const ack = await upload(s, creds);
    uploaded.push(s.key);
    console.log(`uploaded ${s.key}: ${ack.replace(/\s+/g, " ")}`);
    // Keep uploads of the same name ordered, so occurrence N really is the Nth build.
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (uploaded.length === 0)
    console.log("all fixture builds already present; nothing uploaded");

  // 3. Wait for ingestion: the project and every expected build must be visible.
  const expected = new Map<string, number>();
  for (const s of SCENARIOS)
    expected.set(
      s.buildName,
      Math.max(expected.get(s.buildName) ?? 0, s.occurrence),
    );
  let found: any[] = [];
  for (let i = 0; i < Number(process.env.TRA_SEED_WAIT_POLLS || 40); i++) {
    project = (await projects()).find((p) => p.name === PROJECT_NAME);
    if (project) {
      found = await builds(project.id);
      const complete = [...expected].every(
        ([name, n]) => countByName(found, name) >= n,
      );
      const settled = found.every(
        (b) => !/running|in_progress|pending/i.test(String(b.status ?? "")),
      );
      if (complete && settled) break;
    }
    if (i === Number(process.env.TRA_SEED_WAIT_POLLS || 40) - 1)
      die(
        "ingestion wait",
        `after ~6 min: project ${project ? "found" : "missing"}, ${found.length} builds visible: ` +
          JSON.stringify(
            found.map((b) => ({
              name: b.name,
              originalName: b.originalName,
              status: b.status,
              n: b.buildNumber,
            })),
          ),
      );
    await new Promise((r) => setTimeout(r, 9000));
  }
  console.log(`ingested: project ${project.id} with ${found.length} builds`);

  // 4. Map scenarios to builds (oldest first within a name) and collect their test runs.
  const byName = new Map<string, any[]>();
  for (const b of [...found].sort(
    (a, b) =>
      (a.buildNumber ?? 0) - (b.buildNumber ?? 0) ||
      String(a.startedAt).localeCompare(String(b.startedAt)),
  )) {
    const name = b.name; // the stored (normalised) name; original_name holds the raw upload name
    byName.set(name, [...(byName.get(name) ?? []), b]);
  }
  const readonly: Record<string, unknown> = {};
  const scratch: Record<string, unknown> = {};
  const history: Record<string, unknown> = {};
  for (const s of SCENARIOS) {
    const b = byName.get(s.buildName)?.[s.occurrence - 1];
    if (!b) die("map builds", `no build #${s.occurrence} named ${s.buildName}`);
    if (s.region === "history") {
      history[s.key] = {
        build_uuid: b.uuid,
        build_number: b.buildNumber,
        status: b.status,
      };
      continue;
    }
    const details = await call("get_build_details_via_public_api", {
      path_params: { build_id: b.uuid },
    });
    const d = details.body ?? {};
    const entry = {
      build_uuid: b.uuid,
      build_id: b.id ?? d.id ?? d.build_id_int ?? null,
      details_status: details.status,
      build_number: b.buildNumber,
      name: b.name,
      status: b.status,
      tags: b.tags,
      test_runs: await testRuns(b.uuid),
    };
    (s.region === "readonly" ? readonly : scratch)[s.key] = entry;
  }

  // 5. Smart tags are computed asynchronously by the history analyzer after ingestion, so
  // wait for them on the build designed to carry them, and record which runs got which.
  const tagged = readonly.smart_tags as any;
  const polls = Number(process.env.TRA_SEED_TAG_POLLS || 20);
  for (let i = 0; i < polls; i++) {
    const runs = tagged.test_runs as any[];
    if (
      runs.some((t) => t.is_always_failing) &&
      runs.some((t) => t.is_flaky) &&
      runs.some((t) => t.is_new_failure)
    )
      break;
    if (i === polls - 1) break;
    await new Promise((r) => setTimeout(r, 15000));
    tagged.test_runs = await testRuns(tagged.build_uuid);
  }
  const names = (flag: string) =>
    (tagged.test_runs as any[]).filter((t) => t[flag]).map((t) => t.name);
  const smartTags = {
    build: "readonly.smart_tags",
    always_failing: names("is_always_failing"),
    flaky: names("is_flaky"),
    new_failure: names("is_new_failure"),
  };
  console.log(
    "smart tags on the final regression build:",
    JSON.stringify(smartTags),
  );

  // Builds beyond the scenarios (the first run's duplicate uploads, or later ones) are spare
  // scratch: never asserted against, free for write probes that consume a build.
  const used = new Map<string, number>();
  for (const s of SCENARIOS)
    used.set(s.buildName, Math.max(used.get(s.buildName) ?? 0, s.occurrence));
  const spare = [...byName].flatMap(([name, list]) =>
    list.slice(used.get(name) ?? 0).map((b) => ({
      build_uuid: b.uuid,
      build_id: b.id,
      build_number: b.buildNumber,
      name: b.name,
      status: b.status,
    })),
  );
  scratch.spare_builds = spare;

  const pool = {
    product: "tra",
    env: "prod",
    account: creds.username,
    group_id: group,
    project: {
      id: project.id,
      name: project.name,
      normalised_name: project.normalisedName,
      th_project_id: project.thProjectId,
    },
    readonly,
    scratch,
    history,
    smart_tags: smartTags,
    scenarios: {
      always_failing: ["completes payment", "applies discount code"],
      flaky: ["returns results for a query"],
      new_failure_in_regression_2: ["logs in with valid credentials"],
      skipped: ["supports SSO login"],
      shared_error_signature:
        'TimeoutError: Timed out 5000ms waiting for selector "#widgets-panel"',
    },
    seeded_at: new Date().toISOString(),
  };
  writeFileSync(POOL, JSON.stringify(pool, null, 2) + "\n");
  const { account: _omitted, ...printable } = pool;
  console.log(
    JSON.stringify(
      {
        ...printable,
        readonly: Object.keys(readonly),
        scratch: Object.keys(scratch),
      },
      null,
      2,
    ),
  );
  console.log(`\npool -> tests/live/.id-pool-tra.json`);
  process.exit(0);
}

main().catch((e) =>
  die("unexpected", e instanceof Error ? (e.stack ?? e.message) : e),
);
