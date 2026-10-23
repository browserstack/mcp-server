import { beforeEach, describe, expect, it, vi } from "vitest";

// accessibilityExpert is deprecated: it still answers, so nothing that calls it breaks, but
// an agent choosing a tool, and anyone reading an answer, is told it is going away.

const m = vi.hoisted(() => ({ queryAccessibilityRAG: vi.fn() }));

vi.mock("../../src/tools/accessiblity-utils/accessibility-rag.js", () => ({
  queryAccessibilityRAG: m.queryAccessibilityRAG,
}));
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/index.js", () => ({
  trackMCP: vi.fn(),
  PackageJsonVersion: "0.0.0",
}));

import addAccessibilityTools from "../../src/tools/accessibility.js";

function register() {
  const tools: Record<
    string,
    { prompt: string; annotations: any; handler: (...a: any[]) => any }
  > = {};
  const server: any = {
    tool: vi.fn((...args: any[]) => {
      tools[args[0]] = {
        prompt: args[1],
        annotations: args[args.length - 2],
        handler: args[args.length - 1],
      };
    }),
    server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
  };
  addAccessibilityTools(server, {
    "browserstack-username": "fake-user",
    "browserstack-access-key": "fake-key",
  } as any);
  return tools;
}

const text = (result: any) =>
  result.content.map((c: { text: string }) => c.text).join("\n");

describe("accessibilityExpert (deprecated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.queryAccessibilityRAG.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "Text needs a contrast ratio of at least 4.5:1.",
        },
      ],
    });
  });

  it("says it is deprecated where an agent picks its tools", () => {
    const expert = register().accessibilityExpert;

    expect(expert.prompt).toMatch(/^Deprecated/);
    expect(expert.prompt).toMatch(/removed/);
    expect(expert.annotations.title).toMatch(/deprecated/i);
  });

  it("still answers from the knowledge base, with a note that it is deprecated", async () => {
    const result = await register().accessibilityExpert.handler({
      query: "What contrast does body text need?",
    });

    expect(m.queryAccessibilityRAG).toHaveBeenCalledWith(
      "What contrast does body text need?",
      expect.anything(),
    );
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain(
      "Text needs a contrast ratio of at least 4.5:1.",
    );
    expect(result.content[0].text).toMatch(
      /accessibilityExpert is deprecated and will be removed/,
    );
  });

  it("still reports a failed lookup as an error", async () => {
    m.queryAccessibilityRAG.mockRejectedValue(
      new Error("RAG endpoint error: 503"),
    );

    const result = await register().accessibilityExpert.handler({ query: "q" });

    expect(result.isError).toBe(true);
  });
});
