import { beforeEach, describe, expect, it, vi } from "vitest";

// The accessibility knowledge base refuses a question over 500 characters ("Query is too
// long"). A longer one is shortened: its last sentence (the question itself, which agents put
// last) and as much of its opening as fits, or only its opening when it has one sentence or
// a last sentence too long to keep. The note says which was sent.

const rag = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/tools/accessiblity-utils/accessibility-rag.js", () => ({
  queryAccessibilityRAG: rag.query,
}));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/index.js", () => ({ trackMCP: vi.fn(), PackageJsonVersion: "0.0.0" }));

import addAccessibilityTools from "../../src/tools/accessibility.js";
import {
  EXPERT_QUERY_MAX_CHARS,
  fitExpertQuery,
} from "../../src/tools/accessiblity-utils/expert-query.js";

const context = (n: number) =>
  Array.from({ length: n }, (_, i) => `Context sentence number ${i} about the checkout form.`).join(" ");
const QUESTION = "How do I fix the missing form labels?";

/** True when a string holds a high surrogate without the low one after it, or the reverse. */
const hasLoneSurrogate = (s: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("fitExpertQuery", () => {
  it("leaves a question within the limit as it is", () => {
    expect(fitExpertQuery(QUESTION)).toEqual({ query: QUESTION, shortened: false });
  });

  it("keeps the last sentence and as much of the opening as fits", () => {
    const long = `${context(15)} ${QUESTION}`;

    const fitted = fitExpertQuery(long);

    expect(long.length).toBeGreaterThan(EXPERT_QUERY_MAX_CHARS);
    expect(fitted.shortened).toBe(true);
    expect(fitted.kept).toBe("opening and last sentence");
    expect(fitted.query.length).toBeLessThanOrEqual(EXPERT_QUERY_MAX_CHARS);
    expect(fitted.query.startsWith("Context sentence number 0")).toBe(true);
    expect(fitted.query.endsWith(` … ${QUESTION}`)).toBe(true);
  });

  it("keeps only the opening of a question with one long sentence, and says so", () => {
    const fitted = fitExpertQuery(`${"word ".repeat(150)}end`);

    expect(fitted.kept).toBe("opening");
    expect(fitted.query.length).toBeLessThanOrEqual(EXPERT_QUERY_MAX_CHARS);
    expect(fitted.query).not.toContain("…");
  });

  it("splits Chinese and Japanese text at 。？！, so the question at the end is kept", () => {
    const zhQuestion = "如何修复缺少的表单标签？";
    const long = `${"这是关于结账表单的背景说明。".repeat(40)}${zhQuestion}`;

    const fitted = fitExpertQuery(long);

    expect(fitted.kept).toBe("opening and last sentence");
    expect(fitted.query.endsWith(zhQuestion)).toBe(true);
    expect(fitted.query.length).toBeLessThanOrEqual(EXPERT_QUERY_MAX_CHARS);
  });

  it("never cuts between the two halves of a character outside the BMP", () => {
    // 499 ASCII characters, then emoji: a cut at 500 would land inside the first one.
    const fitted = fitExpertQuery(`${"a".repeat(EXPERT_QUERY_MAX_CHARS - 1)}${"😀".repeat(20)}`);

    expect(fitted.shortened).toBe(true);
    expect(hasLoneSurrogate(fitted.query)).toBe(false);
    expect(fitted.query.length).toBeLessThanOrEqual(EXPERT_QUERY_MAX_CHARS);
  });
});

describe("accessibilityExpert with a long question", () => {
  let ask: (query: string) => Promise<any>;

  beforeEach(() => {
    rag.query.mockReset();
    rag.query.mockResolvedValue({ content: [{ type: "text", text: "Answer." }] });
    let handler: (...args: any[]) => any = () => undefined;
    const server: any = {
      tool: vi.fn((...args: any[]) => {
        if (args[0] === "accessibilityExpert") handler = args[args.length - 1];
      }),
      server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
    };
    addAccessibilityTools(server, { "browserstack-username": "u", "browserstack-access-key": "k" } as any);
    ask = (query) => handler({ query });
  });

  it.each([
    ["opening and last sentence", `${context(15)} ${QUESTION}`],
    ["opening", `${"word ".repeat(150)}end`],
  ])("says the %s was sent, matching what was cut", async (kept, query) => {
    const result = await ask(query);

    const sent: string = rag.query.mock.calls[0][0];
    expect(result.content[0].text).toMatch(/^Note: accessibilityExpert is deprecated/);
    expect(result.content[1].text).toBe(
      `The question was ${query.length} characters; the knowledge base takes at most ${EXPERT_QUERY_MAX_CHARS}, so ${sent.length} were sent: its ${kept}. If the answer misses the point, ask again more briefly.`,
    );
    expect(result.content.at(-1).text).toBe("Answer.");
  });

  it("adds only the deprecation note to a question within the limit", async () => {
    const result = await ask(QUESTION);

    expect(rag.query.mock.calls[0][0]).toBe(QUESTION);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toMatch(/^Note: accessibilityExpert is deprecated/);
    expect(result.content[1]).toEqual({ type: "text", text: "Answer." });
  });
});
