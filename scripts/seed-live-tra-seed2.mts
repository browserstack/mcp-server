/**
 * Second TRA seeding pass: builds whose test runs carry the data the first fixture lacks
 * (git branch, host names, test tags, hooks, custom metadata, platform info, logs,
 * attachments, split legs and a re-run leg), so the read probes that came back UNVERIFIED on
 * an empty collection can see a real instance. Sibling of seed-live-tra.mts; it keeps that
 * script's account guard and never touches the pool's existing sections — it only writes
 * `seed2.builds`.
 *
 *   npx tsx scripts/seed-live-tra-seed2.mts --creds-from-mcp browserstack-tra-dummy
 *   (add --skip-ext / --skip-junit to run one half)
 *
 * TWO INGESTION PATHS, both what the pipeline source shows it accepts:
 *
 *   ext    /ext/v1 on the collector host (observability-pipeline ExternalBuildController):
 *          build start with version_control (branch), host_info, ci_info, tags; tests with
 *          tags, custom_metadata and environment (os/browser); BEFORE_EACH/AFTER_EACH hooks
 *          linked via the test finish `hooks` list; logs of kind TEST_LOG / HTTP / TEST_STEP /
 *          HOOK_LOG. Gated per group by a whitelist (403 when the group is not on it).
 *
 *   junit  the JUnit upload host (StreamingJunitProcessor / XmlStepsParser): a zip holding the
 *          XML plus a screenshot and a log file, testsuite hostname, testcase properties
 *          (tags, browser, os, os_version, device, attachment, screenshot, any other name =
 *          custom metadata), system-out logs and [[ATTACHMENT|...]]; upload form fields
 *          buildIdentifier (same name + identifier = split legs) and isRerun (new attempt of
 *          the latest build with that name = re-run leg).
 *
 * ACCOUNT GUARD as in seed-live-tra.mts: refuses group 2 and any group other than
 * TRA_LIVE_EXPECT_GROUP. No credential or host defaults.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";

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

function credentials(): { username: string; accessKey: string } {
  const flag = process.argv.indexOf("--creds-from-mcp");
  if (flag !== -1) {
    const server = process.argv[flag + 1];
    const config = JSON.parse(
      readFileSync(`${homedir()}/.claude.json`, "utf8"),
    );
    for (const project of Object.values<any>(config.projects ?? {})) {
      const env = project?.mcpServers?.[server]?.env;
      if (env?.BROWSERSTACK_USERNAME && env?.BROWSERSTACK_ACCESS_KEY)
        return {
          username: env.BROWSERSTACK_USERNAME,
          accessKey: env.BROWSERSTACK_ACCESS_KEY,
        };
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
      "seed refused: set TRA_LIVE_USERNAME / TRA_LIVE_ACCESS_KEY, or pass --creds-from-mcp <server>.",
    );
    process.exit(1);
  }
  return { username, accessKey };
}

const BASE_URL = required("CAPABILITY_REGISTRY_BASE_URL_TRA");
const UPLOAD_URL = required("TRA_UPLOAD_URL");
const COLLECTOR_URL = required("TRA_COLLECTOR_URL"); // e.g. https://collector-observability.browserstack.com
const EXPECT_GROUP = Number(required("TRA_LIVE_EXPECT_GROUP"));
const SKIP_EXT = process.argv.includes("--skip-ext");
const SKIP_JUNIT = process.argv.includes("--skip-junit");

let tools: any;
let AUTH = "";

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

const log: any[] = []; // every ingestion call, for the pool

// ---------------------------------------------------------------------------------------
// ext path
// ---------------------------------------------------------------------------------------

async function ext(method: string, path: string, body: unknown) {
  const response = await fetch(`${COLLECTOR_URL}/ext/v1${path}`, {
    method,
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  log.push({
    path: "ext",
    method,
    route: `/ext/v1${path.replace(/[0-9a-z]{40}/, "{build}")}`,
    status: response.status,
    response: typeof parsed === "string" ? parsed.slice(0, 200) : parsed,
  });
  return { status: response.status, body: parsed };
}

const iso = (ms: number) => new Date(ms).toISOString();

async function seedExt(): Promise<Record<string, unknown>> {
  const t0 = Date.now() - 60_000;
  const start = await ext("POST", "/builds/start", {
    name: "__mcp-probe-seed2-ext",
    project_name: PROJECT_NAME,
    started_at: iso(t0),
    tags: ["mcp-probe", "seed2", "ext"],
    host_info: {
      hostname: "__mcp-probe-host-ext",
      platform: "linux",
      type: "Linux",
      version: "6.1",
      arch: "x64",
    },
    ci_info: {
      name: "Jenkins",
      build_url: "https://example.com/__mcp-probe-ci/job/seed2/1",
      url: "https://example.com/__mcp-probe-ci",
      build_number: "1",
      job_name: "__mcp-probe-seed2-job",
    },
    version_control: {
      name: "git",
      sha: "0123456789abcdef0123456789abcdef01234567",
      short_sha: "0123456",
      branch: "__mcp-probe-seed2-branch",
      committer: "mcp probe",
      author: "mcp probe",
      commit_message: "__mcp-probe seed2 commit",
      committer_date: iso(t0),
      author_date: iso(t0),
      remotes: [
        { name: "origin", url: "https://example.com/__mcp-probe/repo.git" },
      ],
    },
    framework: { name: "mcp-probe", version: "1.0.0" },
  });
  if (start.status !== 200 || !start.body?.build_hashed_id)
    return {
      status: "not_seeded",
      reason: `builds/start -> HTTP ${start.status}`,
      body: start.body,
    };
  const build = start.body.build_hashed_id as string;
  const env = {
    os: "Windows",
    os_version: "11",
    browser: "Chrome",
    browser_version: "120.0",
  };
  const tests = [
    { name: "__mcp-probe ext passes", result: "passed" },
    { name: "__mcp-probe ext fails", result: "failed" },
  ];
  const out: any[] = [];
  let t = t0 + 1000;
  for (const spec of tests) {
    const common = {
      scopes: ["__mcp-probe Ext Suite"],
      file_name: "ext.probe.js",
    };
    const ts = await ext("POST", `/builds/${build}/tests/start`, {
      ...common,
      name: spec.name,
      started_at: iso(t),
      tags: ["__mcp-probe-tag", "seed2-ext"],
      location: "ext.probe.js:10",
      vc_filepath: "tests/ext.probe.js",
      custom_metadata: {
        __mcp_probe_owner: ["seed2"],
        __mcp_probe_area: ["ext", "hooks"],
      },
      environment: env,
    });
    const testUuid = ts.body?.uuid;
    if (!testUuid) {
      out.push({ name: spec.name, error: ts });
      continue;
    }
    const hooks: string[] = [];
    for (const hookType of ["BEFORE_EACH", "AFTER_EACH"]) {
      const hs = await ext("POST", `/builds/${build}/hooks/start`, {
        ...common,
        name: `__mcp-probe ${hookType.toLowerCase()} hook`,
        hook_type: hookType,
        test_run_id: testUuid,
        started_at: iso(t + 10),
        environment: env,
      });
      const hookUuid = hs.body?.uuid;
      if (!hookUuid) continue;
      hooks.push(hookUuid);
      await ext("POST", `/builds/${build}/logs`, {
        logs: [
          {
            hook_run_uuid: hookUuid,
            timestamp: iso(t + 20),
            level: "INFO",
            kind: "HOOK_LOG",
            message: `__mcp-probe ${hookType} log line`,
          },
        ],
      });
      await ext("PUT", `/builds/${build}/hooks/${hookUuid}/finish`, {
        ...common,
        hook_type: hookType,
        result: "passed",
        finished_at: iso(t + 50),
        duration_in_ms: 40,
      });
    }
    await ext("POST", `/builds/${build}/logs`, {
      logs: [
        {
          test_run_uuid: testUuid,
          timestamp: iso(t + 100),
          level: "INFO",
          kind: "TEST_LOG",
          message: "__mcp-probe test log line",
        },
        {
          test_run_uuid: testUuid,
          timestamp: iso(t + 110),
          kind: "TEST_STEP",
          message: "__mcp-probe step: open page",
          duration: 5,
          failure: false,
        },
        {
          test_run_uuid: testUuid,
          timestamp: iso(t + 120),
          kind: "HTTP",
          duration: 12,
          http_response: {
            status_code: 200,
            method: "GET",
            path: "https://example.com/__mcp-probe/api",
            headers: { "content-type": "application/json" },
            body: { ok: true },
          },
        },
      ],
    });
    const fin = await ext("PUT", `/builds/${build}/tests/${testUuid}/finish`, {
      ...common,
      result: spec.result,
      finished_at: iso(t + 900),
      duration_in_ms: 900,
      hooks,
      failure:
        spec.result === "failed"
          ? [
              {
                backtrace: [
                  "AssertionError: __mcp-probe expected 1 to equal 2",
                  "    at ext.probe.js:12:5",
                ],
              },
            ]
          : undefined,
      meta: {
        steps: [
          {
            id: "s1",
            keyword: "Given",
            text: "__mcp-probe step",
            result: spec.result === "failed" ? "failed" : "passed",
            duration: 5,
            started_at: iso(t + 100),
            finished_at: iso(t + 105),
          },
        ],
      },
      custom_metadata: { __mcp_probe_owner: ["seed2"] },
    });
    out.push({
      name: spec.name,
      test_run_uuid: testUuid,
      hook_run_uuids: hooks,
      finish_status: fin.status,
    });
    t += 1000;
  }
  const bf = await ext("PUT", `/builds/${build}/finish`, {
    finished_at: iso(t + 1000),
  });
  return {
    status: "uploaded",
    build_uuid: build,
    finish_status: bf.status,
    tests: out,
    carries: [
      "branch __mcp-probe-seed2-branch",
      "host __mcp-probe-host-ext",
      "ci Jenkins #1",
      "test tags",
      "custom_metadata",
      "environment Windows 11 / Chrome 120",
      "BEFORE_EACH+AFTER_EACH hooks",
      "TEST_LOG/TEST_STEP/HTTP/HOOK_LOG logs",
    ],
  };
}

// ---------------------------------------------------------------------------------------
// sdk path (SEED2_PASS=4)
// ---------------------------------------------------------------------------------------
// The /ext/v1 API answered 403 (group not on its whitelist) and the upload path cannot carry
// BEFORE_ALL/AFTER_ALL hooks (JUnit has none; Allure maps container befores/afters to
// BEFORE_EACH/AFTER_EACH only, which get_test_run_hooks does not match). This is the event
// API every BrowserStack SDK uses (observability-pipeline BuildController /api/v1/builds ->
// JWT, EventController /api/v1/batch, PUT /api/v1/builds/{id}/stop). The JWT is never logged.

async function seedSdk(): Promise<Record<string, unknown>> {
  const t0 = Date.now() - 60_000;
  const start = await fetch(`${COLLECTOR_URL}/api/v1/builds`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "__mcp-probe-seed2-sdk",
      project_name: PROJECT_NAME,
      started_at: iso(t0),
      tags: ["mcp-probe", "seed2", "sdk"],
      host_info: {
        hostname: "__mcp-probe-host-sdk",
        platform: "linux",
        type: "Linux",
        version: "6.1",
        arch: "x64",
      },
      ci_info: {
        name: "Jenkins",
        build_url: "https://example.com/__mcp-probe-ci/job/seed2-sdk/3/",
        url: "https://example.com/__mcp-probe-ci",
        build_number: "3",
        job_name: "__mcp-probe-seed2-sdk-job",
      },
      version_control: {
        name: "git",
        branch: "__mcp-probe-seed2-sdk-branch",
        sha: "89abcdef0123456789abcdef0123456789abcdef",
        short_sha: "89abcde",
        commit_message: "__mcp-probe seed2 sdk commit",
        author: "mcp probe",
        committer: "mcp probe",
        remotes: [],
      },
      observability_version: {
        frameworkName: "mocha",
        frameworkVersion: "10.2.0",
        sdkVersion: "1.40.0",
        language: "javascript",
      },
    }),
  });
  const text = await start.text().catch(() => "");
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  log.push({
    path: "sdk",
    route: "POST /api/v1/builds",
    status: start.status,
    response: body?.build_hashed_id
      ? { build_hashed_id: body.build_hashed_id, jwt: "<redacted>" }
      : text.slice(0, 200),
  });
  if (start.status !== 200 || !body?.jwt)
    return {
      status: "not_seeded",
      reason: `POST /api/v1/builds -> HTTP ${start.status}`,
      body: text.slice(0, 200),
    };
  const build = body.build_hashed_id as string;
  const bearer = `Bearer ${body.jwt}`;
  const scopes = ["__mcp-probe SDK Suite"];
  const common = {
    file_name: "tests/sdk.probe.js",
    vc_filepath: "tests/sdk.probe.js",
    location: "tests/sdk.probe.js",
    scopes,
    framework: "mocha",
  };
  const hook = (hookType: string, name: string, t: number) => ({
    uuid: randomUUID(),
    name,
    hook_type: hookType,
    result: "passed",
    started_at: iso(t),
    finished_at: iso(t + 30),
    duration_in_ms: 30,
    body: { lang: "javascript", code: `${hookType.toLowerCase()}(() => {})` },
    ...common,
  });
  const beforeAll = hook(
    "BEFORE_ALL",
    '"before all" hook: __mcp-probe setup',
    t0 + 100,
  );
  const beforeEach = hook(
    "BEFORE_EACH",
    '"before each" hook: __mcp-probe per-test',
    t0 + 200,
  );
  const afterAll = hook(
    "AFTER_ALL",
    '"after all" hook: __mcp-probe teardown',
    t0 + 5000,
  );
  const tests = [
    { uuid: randomUUID(), name: "__mcp-probe sdk passes", result: "passed" },
    { uuid: randomUUID(), name: "__mcp-probe sdk fails", result: "failed" },
  ];
  const events: any[] = [
    {
      event_type: "HookRunStarted",
      hook_run: { ...beforeAll, result: undefined, finished_at: undefined },
    },
    { event_type: "HookRunFinished", hook_run: beforeAll },
  ];
  tests.forEach((t, i) => {
    const s = t0 + 1000 + i * 1500;
    const tr = {
      ...common,
      uuid: t.uuid,
      name: t.name,
      identifier: `__mcp-probe SDK Suite ${t.name}`,
      body: { lang: "javascript", code: `it('${t.name}', () => {})` },
      started_at: iso(s),
      tags: ["__mcp-probe-tag", "seed2-sdk"],
      custom_metadata: {
        __mcp_probe_owner: { field_type: "multi_dropdown", values: ["seed2"] },
      },
    };
    events.push({ event_type: "TestRunStarted", test_run: tr });
    events.push({
      event_type: "HookRunFinished",
      hook_run: { ...beforeEach, uuid: randomUUID(), test_run_id: t.uuid },
    });
    events.push({
      event_type: "LogCreated",
      logs: [
        {
          kind: "TEST_LOG",
          test_run_uuid: t.uuid,
          timestamp: iso(s + 100),
          level: "INFO",
          message: `__mcp-probe sdk log for ${t.name}`,
        },
      ],
    });
    events.push({
      event_type: "TestRunFinished",
      test_run: {
        ...tr,
        result: t.result,
        finished_at: iso(s + 900),
        duration_in_ms: 900,
        hooks: [beforeAll.uuid],
        ...(t.result === "failed"
          ? {
              failure: [
                {
                  backtrace: [
                    "AssertionError: __mcp-probe expected 1 to equal 2",
                    "    at tests/sdk.probe.js:12:5",
                  ],
                },
              ],
              failure_type: "AssertionError",
            }
          : {}),
      },
    });
  });
  events.push({
    event_type: "HookRunStarted",
    hook_run: { ...afterAll, result: undefined, finished_at: undefined },
  });
  events.push({ event_type: "HookRunFinished", hook_run: afterAll });
  const batch = await fetch(`${COLLECTOR_URL}/api/v1/batch`, {
    method: "POST",
    headers: { Authorization: bearer, "Content-Type": "application/json" },
    body: JSON.stringify(events),
  });
  log.push({
    path: "sdk",
    route: "POST /api/v1/batch",
    events: events.map((e) => e.event_type),
    status: batch.status,
    response: (await batch.text().catch(() => "")).slice(0, 200),
  });
  await new Promise((r) => setTimeout(r, 5000));
  const stop = await fetch(`${COLLECTOR_URL}/api/v1/builds/${build}/stop`, {
    method: "PUT",
    headers: { Authorization: bearer, "Content-Type": "application/json" },
    body: JSON.stringify({ finished_at: iso(Date.now()) }),
  });
  log.push({
    path: "sdk",
    route: "PUT /api/v1/builds/{build}/stop",
    status: stop.status,
    response: (await stop.text().catch(() => "")).slice(0, 200),
  });
  return {
    status: "uploaded",
    build_uuid: build,
    batch_status: batch.status,
    stop_status: stop.status,
    tests: tests.map((t) => ({ name: t.name, uuid: t.uuid })),
    hooks: { before_all: beforeAll.uuid, after_all: afterAll.uuid },
  };
}

// ---------------------------------------------------------------------------------------
// junit path
// ---------------------------------------------------------------------------------------

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const x = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function junitXml(buildName: string, leg: string, failSecond: boolean): string {
  const now = new Date().toISOString().slice(0, 19);
  const props = (extra: Record<string, string>) =>
    `      <properties>\n${Object.entries(extra)
      .map(([k, v]) => `        <property name="${x(k)}" value="${x(v)}"/>`)
      .join("\n")}\n      </properties>`;
  const base = {
    tags: `__mcp-probe-tag,seed2-${leg}`,
    browser: "chrome",
    os: "Windows",
    os_version: "11",
    device: "__mcp-probe-desktop",
    __mcp_probe_owner: "seed2",
    __mcp_probe_area: "[junit,attachments]",
    attachment: "probe-log.txt",
    screenshot: "probe-shot.png",
  };
  const cases = [
    `    <testcase classname="__mcp-probe Seed2 Suite" name="__mcp-probe ${leg} passes" time="1.0">\n${props(base)}\n      <system-out>__mcp-probe stdout line for ${leg}\n[[ATTACHMENT|https://example.com/__mcp-probe/${leg}.txt]]</system-out>\n    </testcase>`,
    failSecond
      ? `    <testcase classname="__mcp-probe Seed2 Suite" name="__mcp-probe ${leg} fails" time="1.5">\n${props(base)}\n      <failure message="__mcp-probe expected 1 to equal 2" type="AssertionError">AssertionError: __mcp-probe expected 1 to equal 2\n    at seed2.test.js:12:5</failure>\n      <system-out>__mcp-probe stdout for failing ${leg}</system-out>\n      <system-err>__mcp-probe stderr for failing ${leg}</system-err>\n    </testcase>`
      : `    <testcase classname="__mcp-probe Seed2 Suite" name="__mcp-probe ${leg} fails" time="1.5">\n${props(base)}\n    </testcase>`,
  ];
  const failures = failSecond ? 1 : 0;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${x(buildName)}" tests="2" failures="${failures}" errors="0" skipped="0" time="2.5">\n  <testsuite name="seed2.test.js" hostname="__mcp-probe-host-junit" tests="2" failures="${failures}" errors="0" skipped="0" time="2.5" timestamp="${now}">\n    <properties>\n      <property name="tags" value="__mcp-probe-suite-tag"/>\n      <property name="hostname" value="__mcp-probe-host-junit"/>\n    </properties>\n${cases.join("\n")}\n  </testsuite>\n</testsuites>\n`;
}

async function uploadJunit(
  key: string,
  buildName: string,
  fields: Record<string, string>,
  failSecond: boolean,
  testKey = key,
) {
  const zip = new JSZip();
  zip.file("report.xml", junitXml(buildName, testKey, failSecond));
  zip.file("probe-log.txt", `__mcp-probe attachment for ${key}\n`);
  zip.file("probe-shot.png", PNG);
  const data = await zip.generateAsync({ type: "uint8array" });
  const form = new FormData();
  form.append(
    "data",
    new Blob([data], { type: "application/zip" }),
    `${key}.zip`,
  );
  form.append("projectName", PROJECT_NAME);
  form.append("buildName", buildName);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: AUTH },
    body: form,
  });
  const text = await response.text().catch(() => "");
  log.push({
    path: "junit",
    key,
    buildName,
    fields,
    status: response.status,
    response: text.slice(0, 200),
  });
  return { status: response.status, text: text.slice(0, 300) };
}

const VCS = JSON.stringify({
  name: "git",
  branch: "__mcp-probe-seed2-branch",
  sha: "0123456789abcdef0123456789abcdef01234567",
  shortSha: "0123456",
  commitMessage: "__mcp-probe seed2 commit",
  author: "mcp probe",
  committer: "mcp probe",
  remotes: [
    { name: "origin", url: "https://example.com/__mcp-probe/repo.git" },
  ],
});
const HOST = (h: string) =>
  JSON.stringify({
    hostName: h,
    hostname: h,
    platform: "darwin",
    type: "Darwin",
    version: "24.6.0",
    arch: "arm64",
  });

// Pass 1 (2026-09-29 ~17:50Z) uploaded split_leg_1/2, rerun_first/retry (test names differed per
// leg, so the retry did not re-run the same tests) and a vcs leg the uploader refused with
// 400 "hostName is a mandatory field". SEED2_PASS=2 uploads the corrected legs.
const JUNIT_PASS1 = [
  {
    key: "split_leg_1",
    buildName: "__mcp-probe-seed2-split",
    fields: {
      tags: "mcp-probe,seed2,split",
      buildIdentifier: "__mcp-probe-seed2-split-run-1",
      ci: "https://example.com/__mcp-probe-ci/job/seed2/7/",
    },
    failSecond: true,
  },
  {
    key: "split_leg_2",
    buildName: "__mcp-probe-seed2-split",
    fields: {
      tags: "mcp-probe,seed2,split",
      buildIdentifier: "__mcp-probe-seed2-split-run-1",
      ci: "https://example.com/__mcp-probe-ci/job/seed2/7/",
    },
    failSecond: true,
  },
  {
    key: "rerun_first",
    buildName: "__mcp-probe-seed2-rerun",
    fields: { tags: "mcp-probe,seed2,rerun" },
    failSecond: true,
  },
  {
    key: "rerun_retry",
    buildName: "__mcp-probe-seed2-rerun",
    fields: { tags: "mcp-probe,seed2,rerun", isRerun: "true" },
    failSecond: false,
  },
  {
    key: "vcs",
    buildName: "__mcp-probe-seed2-vcs",
    fields: {
      tags: "mcp-probe,seed2,vcs",
      versionControl: VCS,
      hostInfo: JSON.stringify({
        hostname: "__mcp-probe-host-vcs",
        platform: "darwin",
      }),
    },
    failSecond: true,
  },
];
const JUNIT_PASS2 = [
  // Same test names on both legs, second leg isRerun=true: a real re-run of the same tests.
  {
    key: "retry_first",
    testKey: "retry",
    buildName: "__mcp-probe-seed2-retry",
    fields: { tags: "mcp-probe,seed2,retry" },
    failSecond: true,
  },
  {
    key: "retry_rerun",
    testKey: "retry",
    buildName: "__mcp-probe-seed2-retry",
    fields: { tags: "mcp-probe,seed2,retry", isRerun: "true" },
    failSecond: false,
  },
  // Git branch + host info through the upload form (the uploader validates hostInfo.hostName).
  {
    key: "vcs2",
    buildName: "__mcp-probe-seed2-vcs",
    fields: {
      tags: "mcp-probe,seed2,vcs",
      versionControl: VCS,
      hostInfo: HOST("__mcp-probe-host-vcs"),
    },
    failSecond: true,
  },
];
// Pass 2 got retry_first/retry_rerun in; vcs2 and allure were refused 400 "remotes must be of
// type array" (the uploader validates versionControl.remotes). SEED2_PASS=3 retries those two.
const PASS = process.env.SEED2_PASS ?? "1";
const JUNIT =
  PASS === "3"
    ? JUNIT_PASS2.filter((u) => u.key === "vcs2")
    : PASS === "2"
      ? JUNIT_PASS2
      : JUNIT_PASS1;

// Allure: the only report format whose processor emits hook runs (container befores/afters ->
// BEFORE_EACH / AFTER_EACH, StreamingAllureProcessor.linkHookRunWithTestRun). Labels: tag ->
// test tags, any other non-scope label -> custom metadata; attachments are files in the zip.
async function uploadAllure(buildName: string) {
  const zip = new JSZip();
  const now = Date.now() - 30_000;
  const results = [
    { name: "__mcp-probe allure passes", status: "passed" },
    { name: "__mcp-probe allure fails", status: "failed" },
  ].map((r, i) => ({
    uuid: randomUUID(),
    historyId: `__mcp-probe-allure-${i}`,
    fullName: `seed2.allure.${i}`,
    name: r.name,
    status: r.status,
    statusDetails:
      r.status === "failed"
        ? {
            message: "__mcp-probe expected 1 to equal 2",
            trace:
              "AssertionError: __mcp-probe expected 1 to equal 2\n    at allure.probe.js:9:3",
          }
        : {},
    stage: "finished",
    start: now + i * 2000,
    stop: now + i * 2000 + 1500,
    labels: [
      { name: "parentSuite", value: "__mcp-probe Allure Suite" },
      { name: "suite", value: "allure.probe.js" },
      { name: "tag", value: "__mcp-probe-tag" },
      { name: "tag", value: "seed2-allure" },
      { name: "host", value: "__mcp-probe-host-allure" },
      { name: "thread", value: "worker-1" },
      { name: "framework", value: "mcp-probe" },
      { name: "language", value: "javascript" },
      { name: "__mcp_probe_owner", value: "seed2" },
      { name: "owner", value: "mcp probe" },
    ],
    steps: [
      {
        name: "__mcp-probe step open page",
        status: "passed",
        stage: "finished",
        start: now + i * 2000 + 10,
        stop: now + i * 2000 + 50,
        steps: [],
      },
    ],
    attachments: [
      {
        name: "probe-shot",
        source: `shot-${i}-attachment.png`,
        type: "image/png",
      },
      {
        name: "probe-log",
        source: `log-${i}-attachment.txt`,
        type: "text/plain",
      },
    ],
    parameters: [],
  }));
  for (const [i, r] of results.entries()) {
    zip.file(`${r.uuid}-result.json`, JSON.stringify(r));
    zip.file(`shot-${i}-attachment.png`, PNG);
    zip.file(`log-${i}-attachment.txt`, `__mcp-probe allure attachment ${i}\n`);
  }
  const hook = (name: string, t: number) => ({
    name,
    status: "passed",
    stage: "finished",
    start: t,
    stop: t + 20,
    steps: [
      {
        name: `${name} step`,
        status: "passed",
        stage: "finished",
        start: t,
        stop: t + 10,
        steps: [],
      },
    ],
    attachments: [],
  });
  const container = {
    uuid: randomUUID(),
    name: "__mcp-probe allure container",
    children: results.map((r) => r.uuid),
    befores: [hook("__mcp-probe beforeEach hook", now - 100)],
    afters: [hook("__mcp-probe afterEach hook", now + 5000)],
    start: now - 200,
    stop: now + 6000,
  };
  zip.file(`${container.uuid}-container.json`, JSON.stringify(container));
  const data = await zip.generateAsync({ type: "uint8array" });
  const form = new FormData();
  form.append(
    "data",
    new Blob([data], { type: "application/zip" }),
    "allure-results.zip",
  );
  form.append("projectName", PROJECT_NAME);
  form.append("buildName", buildName);
  form.append("format", "allure");
  form.append("tags", "mcp-probe,seed2,allure");
  form.append("versionControl", VCS);
  form.append("hostInfo", HOST("__mcp-probe-host-allure"));
  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: AUTH },
    body: form,
  });
  const text = await response.text().catch(() => "");
  log.push({
    path: "allure",
    buildName,
    fields: ["format", "tags", "versionControl", "hostInfo"],
    status: response.status,
    response: text.slice(0, 200),
  });
  return { status: response.status, text: text.slice(0, 300) };
}

// ---------------------------------------------------------------------------------------

async function projectBuilds(projectId: number): Promise<any[]> {
  const out: any[] = [];
  const now = Date.now();
  let next: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query: Record<string, unknown> = {
      date_range: [now - 2 * 86400_000, now + 3600_000],
    };
    if (next) query.next_page = next;
    const r = await call("list_project_builds_via_public_api", {
      path_params: { project_id: projectId },
      query,
    });
    if (r.status !== 200)
      die("list_project_builds_via_public_api", r.error ?? r.body, r.status);
    out.push(
      ...(r.body?.builds ?? []).map((b: any) => ({
        ...b,
        uuid: b.uuid ?? b.build_id,
        originalName: b.originalName ?? b.original_name,
        buildNumber: b.buildNumber ?? b.build_number,
      })),
    );
    const p = r.body?.pagination ?? {};
    next = p.nextPage ?? p.next_page;
    if (!(p.hasNext ?? p.has_next) || !next) break;
  }
  return out;
}

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
      retry_uuids: (d.retries ?? []).map((r: any) => r.uuid),
    });
    return acc;
  }
  leaves(node.children ?? [], acc);
  return acc;
}

async function testRuns(buildUuid: string): Promise<any[]> {
  const r = await call("list_build_test_runs", {
    path_params: { build_id: buildUuid },
    query: {},
  });
  if (r.status !== 200) return [{ error: `HTTP ${r.status}` }];
  return leaves(r.body?.hierarchy ?? []);
}

async function main() {
  const creds = credentials();
  AUTH = `Basic ${Buffer.from(`${creds.username}:${creds.accessKey}`).toString("base64")}`;
  process.env.CAPABILITY_REGISTRY_INDEX_DIR = `${ROOT}capability/`;
  process.env.CAPABILITY_REGISTRY_BASE_URL_TRA = BASE_URL;
  tools = new BrowserStackMcpServer({
    "browserstack-username": creds.username,
    "browserstack-access-key": creds.accessKey,
  } as any).getTools();

  // Account guard.
  const r = await call("list_projects_full");
  if (r.status !== 200 || !Array.isArray(r.body))
    die("list_projects_full", r.error ?? r.body, r.status);
  const group = r.body[0]?.groupId;
  if (group === undefined)
    die("account guard", "no projects to read a groupId from");
  if (group === COMPANY_GROUP)
    die("account guard", "refusing to seed TRA group 2 (company-wide group)");
  if (group !== EXPECT_GROUP)
    die(
      "account guard",
      `caller's group is ${group}, expected ${EXPECT_GROUP}`,
    );
  const project = r.body.find((p: any) => p.name === PROJECT_NAME);
  if (!project) die("account guard", `project ${PROJECT_NAME} not found`);
  console.log(`account guard ok: group ${group}, project ${project.id}`);

  const result: any = { seeded_at: new Date().toISOString() };
  if (!SKIP_EXT) {
    result.ext = await seedExt();
    console.log("ext:", JSON.stringify(result.ext).slice(0, 400));
  }
  if (PASS === "4") {
    result.sdk = await seedSdk();
    console.log("sdk:", JSON.stringify(result.sdk).slice(0, 600));
  }
  if (!SKIP_JUNIT && PASS !== "4") {
    result.junit_uploads = [];
    for (const u of JUNIT) {
      const ack = await uploadJunit(
        u.key,
        u.buildName,
        u.fields,
        u.failSecond,
        (u as any).testKey ?? u.key,
      );
      result.junit_uploads.push({
        key: u.key,
        buildName: u.buildName,
        fields: Object.keys(u.fields),
        status: ack.status,
        ack: ack.text,
      });
      console.log(
        `upload ${u.key}: HTTP ${ack.status} ${ack.text.replace(/\s+/g, " ").slice(0, 160)}`,
      );
      await new Promise((res) => setTimeout(res, 15000)); // keep legs ordered (rerun attaches to the LATEST build)
    }
    if (PASS === "2" || PASS === "3") {
      const ack = await uploadAllure("__mcp-probe-seed2-allure");
      result.allure_upload = {
        buildName: "__mcp-probe-seed2-allure",
        status: ack.status,
        ack: ack.text,
      };
      console.log(
        `upload allure: HTTP ${ack.status} ${ack.text.replace(/\s+/g, " ").slice(0, 160)}`,
      );
    }
  }

  // Wait for ingestion, then collect every seed2 build and its test runs.
  let found: any[] = [];
  const wantNames = [
    ...(PASS === "4"
      ? result.sdk?.status === "uploaded"
        ? ["sdk"]
        : []
      : SKIP_JUNIT
        ? []
        : PASS === "3"
          ? ["vcs", "allure"]
          : PASS === "2"
            ? ["retry", "vcs", "allure"]
            : ["split", "rerun", "vcs"]),
    ...(SKIP_EXT || result.ext?.status !== "uploaded" ? [] : ["ext"]),
  ];
  for (let i = 0; i < 30; i++) {
    found = (await projectBuilds(project.id)).filter((b) =>
      /seed2/.test(`${b.name} ${b.originalName}`),
    );
    const have = wantNames.every((n) =>
      found.some(
        (b) => String(b.name).includes(n) || String(b.originalName).includes(n),
      ),
    );
    const settled = found.every(
      (b) => !/running|in_progress|pending/i.test(String(b.status ?? "")),
    );
    if (have && settled) break;
    await new Promise((res) => setTimeout(res, 10000));
  }
  result.builds = [];
  for (const b of found) {
    const details = await call("get_build_details_via_public_api", {
      path_params: { build_id: b.uuid },
    });
    const d = details.body ?? {};
    result.builds.push({
      build_uuid: b.uuid,
      build_id: b.id ?? d.id ?? null,
      name: b.name,
      original_name: b.originalName,
      build_number: b.buildNumber,
      status: b.status,
      tags: b.tags,
      test_runs: await testRuns(b.uuid),
    });
  }
  result.ingestion_calls = log;

  const pool = JSON.parse(readFileSync(POOL, "utf8"));
  const slot = PASS === "1" ? "ingestion" : `ingestion_pass${PASS}`;
  pool.seed2 = { ...(pool.seed2 ?? {}), [slot]: result };
  writeFileSync(POOL, JSON.stringify(pool, null, 2) + "\n");
  console.log(
    JSON.stringify({ ...result, ingestion_calls: log.length }, null, 2).slice(
      0,
      6000,
    ),
  );
  process.exit(0);
}

main().catch((e) =>
  die("unexpected", e instanceof Error ? (e.stack ?? e.message) : e),
);
