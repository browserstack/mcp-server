/**
 * L3 protocol E2E: each tool through a real MCP client, with MSW for every HTTP call.
 * Spec: Confluence AIA "MCP Server Regression – Layer Implementation Spec", section 4.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/instrumentation.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackMCP: vi.fn(),
}));
vi.mock("browserstack-local", () => ({
  Local: vi.fn(() => ({
    start: vi.fn((_o: unknown, cb: (e?: Error) => void) => cb()),
    stop: vi.fn((cb: () => void) => cb()),
    isRunning: vi.fn(() => false),
  })),
}));

// Never start, find or kill a real BrowserStackLocal process.
vi.mock("../../src/lib/local.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  killExistingBrowserStackLocalProcesses: vi.fn(async () => {}),
  ensureLocalBinarySetup: vi.fn(async () => {}),
}));
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  execSync: vi.fn(() => {
    throw new Error("L3: child_process.execSync is not allowed");
  }),
}));

// webdriverio sends WebDriver calls through undici's own fetch, which MSW does not see.
// So no case may open a real WebDriver session.
vi.mock("webdriverio", () => ({
  remote: vi.fn(async () => {
    throw new Error(
      "L3: webdriverio.remote is not allowed (no real WebDriver session)",
    );
  }),
}));

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ALL_SPECS } from "./cases/index.js";
import { expandSpec, type Row } from "./harness/cases.js";
import { resetMsw, startMsw, stopMsw } from "./harness/msw.js";
import { runRow } from "./harness/run.js";
import {
  PROFILES,
  startServer,
  type Profile,
  type StartedServer,
} from "./harness/server.js";

beforeAll(startMsw);
afterAll(stopMsw);

function rowsFor(profile: Profile, region: boolean): Row[] {
  return ALL_SPECS.filter((s) => !s.profiles || s.profiles.includes(profile))
    .flatMap(expandSpec)
    .filter((r): r is Row => !("na" in r))
    .filter((r) => (r.kind === "region") === region);
}

function suite(name: string, profile: Profile, region: boolean) {
  const rows = rowsFor(profile, region);
  describe.skipIf(!rows.length)(name, () => {
    let server: StartedServer;
    const tools = new Map<string, Tool>();

    beforeAll(async () => {
      server = await startServer({ profile, region: region ? "eu" : "us" });
      for (const t of (await server.client.listTools()).tools)
        tools.set(t.name, t);
    });
    afterAll(async () => {
      resetMsw();
      await server?.close();
    });

    for (const row of rows) {
      // A known issue runs as an expected failure: it turns red when the bug is fixed.
      const test = row.knownIssue ? it.fails : it;
      const title = row.knownIssue
        ? `${row.id} (known issue: ${row.knownIssue})`
        : row.id;
      test(title, async () => {
        expect(await runRow(server.client, row, tools)).toEqual([]);
      });
    }
  });
}

for (const profile of PROFILES) suite(profile, profile, false);
// Region: an EU account on the local profile. Each call must go to an EU host.
suite("local-EU (region)", "local-US", true);
