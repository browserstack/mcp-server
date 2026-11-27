/**
 * L3 meta test: every tool in tools/list needs a row (a case or "n/a: <reason>") for each
 * kind, in each profile. tools/list is built at run time from the server, never a copy.
 *
 * Rollout (spec section 4): report only until every tool has its cases, then it blocks.
 * To block, set META_BLOCKS = true.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/instrumentation.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackMCP: vi.fn(),
}));

import { ALL_SPECS } from "./cases/index.js";
import { expandSpec, KINDS, type Kind } from "./harness/cases.js";
import { PROFILES, startServer } from "./harness/server.js";

const META_BLOCKS = false;
const REPORT = "reports/l3-coverage.json";

describe("L3 meta: a row for each tool and kind", () => {
  it("has no spec for a tool that is not served, and no duplicate spec", async () => {
    const served = new Set<string>();
    for (const profile of PROFILES) {
      const server = await startServer({ profile });
      for (const t of (await server.client.listTools()).tools)
        served.add(t.name);
      await server.close();
    }
    const names = ALL_SPECS.map((s) => s.tool);
    expect(
      names.filter((n) => !served.has(n)),
      "specs for tools not in tools/list",
    ).toEqual([]);
    expect(
      names.filter((n, i) => names.indexOf(n) !== i),
      "duplicate specs",
    ).toEqual([]);
  });

  it(`covers every tool in tools/list (${META_BLOCKS ? "blocking" : "report only"})`, async () => {
    const missing: { profile: string; tool: string; kinds: Kind[] }[] = [];
    let total = 0;
    let covered = 0;

    for (const profile of PROFILES) {
      const server = await startServer({ profile });
      const tools = (await server.client.listTools()).tools.map((t) => t.name);
      await server.close();

      for (const tool of tools) {
        const spec = ALL_SPECS.find(
          (s) =>
            s.tool === tool && (!s.profiles || s.profiles.includes(profile)),
        );
        const kinds = new Set(spec ? expandSpec(spec).map((r) => r.kind) : []);
        const gaps = KINDS.filter((k) => !kinds.has(k));
        total += KINDS.length;
        covered += KINDS.length - gaps.length;
        if (gaps.length) missing.push({ profile, tool, kinds: gaps });
      }
    }

    mkdirSync("reports", { recursive: true });
    writeFileSync(
      REPORT,
      JSON.stringify(
        { blocks: META_BLOCKS, rows: { total, covered }, missing },
        null,
        2,
      ),
    );
    const summary =
      `L3 rows: ${covered} of ${total} (${Math.round((100 * covered) / total)}%). ` +
      `${missing.length} tool/profile pairs have gaps. Details: ${REPORT}`;
    console.log(summary);

    if (META_BLOCKS) expect(missing, summary).toEqual([]);
  });
});
