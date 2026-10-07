/**
 * Invoke ONE read capability in-process against the worktree's TRA index, and print only
 * the HTTP status and the response SHAPE (keys and value types, never values). Used to
 * re-test index fixes without reconnecting the running MCP server (which holds the old
 * index in memory).
 *
 *   npx tsx scripts/probe-invoke.mts --creds-from-mcp browserstack-tra-dummy \
 *       <capability> <args.json>
 *
 * <args.json> holds the invokeCapability arguments: { path_params?, query?, body? }.
 *
 * GUARDS
 *   - credentials only via --creds-from-mcp <server> (read in-process from ~/.claude.json,
 *     never printed, logged or written).
 *   - account guard: refuses unless the caller's TRA group is 11179383; refuses group 2.
 *   - reads only: refuses any capability whose index mode is not "read".
 *   - output: status + shape; for non-2xx, the error message string (truncated) only.
 *   - `--pluck <dot.path>` additionally prints ONE scalar at that path (e.g. `0.id`), for
 *     chaining fixture ids (hashes, numeric ids) into the next probe. Non-scalars refused.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX = `${ROOT}capability/tra.capability-index.json`;
const BASE_URL = "https://api-observability.browserstack.com";
const EXPECT_GROUP = 11179383;
const COMPANY_GROUP = 2;

function die(message: string): never {
  console.error(`probe refused: ${message}`);
  process.exit(1);
}

function credentials(): { username: string; accessKey: string } {
  const flag = process.argv.indexOf("--creds-from-mcp");
  if (flag === -1) die("pass --creds-from-mcp <server>");
  const server = process.argv[flag + 1];
  const config = JSON.parse(readFileSync(`${homedir()}/.claude.json`, "utf8"));
  for (const project of Object.values<any>(config.projects ?? {})) {
    const env = project?.mcpServers?.[server]?.env;
    if (env?.BROWSERSTACK_USERNAME && env?.BROWSERSTACK_ACCESS_KEY) {
      return {
        username: env.BROWSERSTACK_USERNAME,
        accessKey: env.BROWSERSTACK_ACCESS_KEY,
      };
    }
  }
  die(`no credentials found for MCP server "${server}"`);
}

function positional(): [string, string] {
  const args = process.argv.slice(2);
  for (const name of ["--creds-from-mcp", "--pluck"]) {
    const flag = args.indexOf(name);
    if (flag !== -1) args.splice(flag, 2);
  }
  if (args.length !== 2) die("usage: <capability> <args.json>");
  return [args[0], args[1]];
}

/** Keys and types only — no values. Arrays report length and the first item's shape. */
function shape(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[] (empty)";
    return depth >= 4
      ? `array(${value.length})`
      : { [`array(${value.length})`]: shape(value[0], depth + 1) };
  }
  if (typeof value === "object") {
    if (depth >= 4)
      return `object(${Object.keys(value as object).length} keys)`;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object))
      out[k] = shape(v, depth + 1);
    return out;
  }
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function errorText(body: any, error: unknown): string {
  const candidates = [
    error,
    body?.message,
    body?.error,
    body?.errorMessage,
    body?.errors,
  ];
  const first = candidates.find((c) => c !== undefined && c !== null);
  const text = typeof first === "string" ? first : JSON.stringify(first ?? "");
  return text.slice(0, 300);
}

async function main() {
  const [capability, argsFile] = positional();
  const index = JSON.parse(readFileSync(INDEX, "utf8"));
  const entry = index.tra.capabilities.find((c: any) => c.name === capability);
  if (!entry) die(`unknown capability ${capability}`);
  if (entry.mode !== "read")
    die(`${capability} is mode=${entry.mode}; reads only`);
  const args = JSON.parse(readFileSync(argsFile, "utf8"));

  const creds = credentials();
  process.env.CAPABILITY_REGISTRY_INDEX = INDEX;
  process.env.CAPABILITY_REGISTRY_BASE_URL_TRA = BASE_URL;
  const { BrowserStackMcpServer } = await import("../src/server-factory.js");
  const tools: any = new BrowserStackMcpServer({
    "browserstack-username": creds.username,
    "browserstack-access-key": creds.accessKey,
  } as any).getTools();

  const call = async (name: string, a: Record<string, unknown>) => {
    const result = await tools.invokeCapability.handler(
      { name, product: "tra", ...a },
      {} as any,
    );
    const payload = JSON.parse(result.content[0].text);
    return {
      status: payload.http_response?.status ?? 0,
      body: payload.http_response?.body,
      error: payload.error ?? payload.http_response?.error,
      stage: payload.stage ?? payload.failed_at,
    };
  };

  // Account guard.
  const projects = await call("list_projects_full", {});
  const group = Array.isArray(projects.body)
    ? projects.body[0]?.groupId
    : undefined;
  if (group === undefined) die("could not read the caller's groupId");
  if (group === COMPANY_GROUP) die("refusing TRA group 2 (company-wide group)");
  if (group !== EXPECT_GROUP) die(`caller's group is not ${EXPECT_GROUP}`);

  const r = await call(capability, args);
  const ok = r.status >= 200 && r.status < 300;
  console.log(
    JSON.stringify({ capability, status: r.status, stage: r.stage ?? null }),
  );
  if (ok) console.log(JSON.stringify(shape(r.body), null, 1));
  else console.log(`error: ${errorText(r.body, r.error)}`);
  const pluck = process.argv.indexOf("--pluck");
  if (ok && pluck !== -1) {
    let v: any = r.body;
    for (const k of process.argv[pluck + 1].split(".")) v = v?.[k];
    console.log(
      v !== null && typeof v === "object"
        ? "pluck: refused (not a scalar)"
        : `pluck: ${String(v).slice(0, 120)}`,
    );
  }
}

main().catch((e) => {
  console.error(`probe failed: ${String(e?.message ?? e).slice(0, 300)}`);
  process.exit(1);
});
