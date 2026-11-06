import { describe, expect, it, Mock, vi } from "vitest";

// How much of a report one call hands out by default: about 30,000 characters of issue
// JSON (about 8k tokens), whatever the report: under Claude Code's 10k-token warning and its
// 50,000-character limit, at a third of the calls 10,000 took.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import { pageOf } from "../../src/tools/accessiblity-utils/paginate.js";
import { parseAccessibilityReportFromCSV } from "../../src/tools/accessiblity-utils/report-parser.js";

const row = (id: number) => ({ id, text: "x".repeat(9000) });

describe("the default page size", () => {
  it("fills a page up to 30,000 characters", () => {
    const page = pageOf([row(1), row(2), row(3), row(4)]);

    expect(page.records.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(page.next_page).not.toBeNull();
  });

  it("is the same for a CSV report", async () => {
    // Each issue's rule text, its fix here, counts against the page the first time the page
    // names the rule. (A long HTML snippet is cut short, so it cannot fill a page.)
    const header = '"Issue type","Severity","Component","Issue description","Affected page","HTML snippet","How to fix this issue"';
    const line = (n: number) =>
      `"rule-${n}","serious","div","d","https://shop.example/","<div>","${"x".repeat(9000)}"`;
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      statusText: "OK",
      data: [header, line(1), line(2), line(3), line(4)].join("\n"),
    });

    const page = await parseAccessibilityReportFromCSV("https://csv");

    expect(page.page_length).toBe(3);
    expect(page.next_page).not.toBeNull();
  });
});

describe("a record longer than a page", () => {
  it("is handed out on a page of its own, so the cursor moves past it", () => {
    const first = pageOf([row(1), { id: 2, text: "x".repeat(40_000) }, row(3)]);
    const second = pageOf([row(1), { id: 2, text: "x".repeat(40_000) }, row(3)], {
      nextPage: first.next_page!,
    });
    const third = pageOf([row(1), { id: 2, text: "x".repeat(40_000) }, row(3)], {
      nextPage: second.next_page!,
    });

    expect(first.records.map((r) => r.id)).toEqual([1]);
    expect(second.records.map((r) => r.id)).toEqual([2]);
    expect(second.next_page).toBeGreaterThan(first.next_page!);
    expect(third.records.map((r) => r.id)).toEqual([3]);
    expect(third.next_page).toBeNull();
  });
});
