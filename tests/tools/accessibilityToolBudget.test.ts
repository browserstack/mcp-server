import { describe, expect, it, vi } from "vitest";

// Every client loads tool descriptions into the user's context at connect time, so the
// accessibility tools keep to the repo's budget: a prompt of at most 200 characters, and
// each argument's description at most 120. Guidance beyond that belongs in the answers.

vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/index.js", () => ({ trackMCP: vi.fn(), PackageJsonVersion: "0.0.0" }));

import addAccessibilityTools from "../../src/tools/accessibility.js";

const PROMPT_CEILING = 200;
const DESCRIBE_CEILING = 120;

function registered() {
  const tools: { name: string; prompt: string; schema: Record<string, any> }[] = [];
  const server: any = {
    tool: vi.fn((name: string, prompt: string, schema: Record<string, any>) => {
      tools.push({ name, prompt, schema });
    }),
    server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
  };
  addAccessibilityTools(server, {
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  } as any);
  return tools;
}

describe("accessibility tool descriptions", () => {
  const tools = registered();

  it.each(tools.map((t) => [t.name, t.prompt.length]))(
    "%s keeps its prompt within the ceiling (%i chars)",
    (_name, length) => {
      expect(length).toBeLessThanOrEqual(PROMPT_CEILING);
    },
  );

  it("keeps every argument description within the ceiling", () => {
    const over: string[] = [];
    for (const t of tools) {
      for (const [field, def] of Object.entries(t.schema)) {
        const text: string = (def as any).description ?? "";
        if (text.length > DESCRIBE_CEILING) over.push(`${t.name}.${field}: ${text.length}`);
      }
    }
    expect(over).toEqual([]);
  });

  it("takes buildId only in the shape the API uses: 40 lowercase letters and digits", () => {
    const schema = tools.find((t) => t.name === "fetchAccessibilityIssues")!.schema.buildId;
    expect(schema.safeParse("q7m2k9x4c1v8b3n6z0w5r2t9y4p1s8d3f6g0h2ja").success).toBe(true);
    expect(schema.safeParse("checkout-build").success).toBe(false);
    expect(schema.safeParse("3f9a1c7e2b5d4e8f9a0b1c2d3e4f5a6b").success).toBe(false);
  });

  it("takes cursor only as a whole number from 0", () => {
    const schema = tools.find((t) => t.name === "fetchAccessibilityIssues")!.schema.cursor;
    expect(schema.safeParse(0).success).toBe(true);
    expect(schema.safeParse(900).success).toBe(true);
    expect(schema.safeParse(-1).success).toBe(false);
    expect(schema.safeParse(1.5).success).toBe(false);
  });

  it("takes appReportId only as a UUID, so it cannot reach another API path", () => {
    const schema = tools.find((t) => t.name === "fetchAccessibilityIssues")!.schema.appReportId;
    expect(schema.safeParse("6d1f0a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b").success).toBe(true);
    expect(schema.safeParse("..").success).toBe(false);
    expect(schema.safeParse("../reports").success).toBe(false);
  });
});
