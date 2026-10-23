import { describe, expect, it, Mock, vi } from "vitest";

// How much of a report one call hands out by default: about 10,000 characters of issue
// JSON, whatever the report, so a large report takes half as many calls as at 5,000.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import { pageOf } from "../../src/tools/accessiblity-utils/paginate.js";
import { parseAccessibilityReportFromCSV } from "../../src/tools/accessiblity-utils/report-parser.js";

const row = (id: number) => ({ id, text: "x".repeat(3000) });

describe("the default page size", () => {
  it("fills a page up to 10,000 characters", () => {
    const page = pageOf([row(1), row(2), row(3), row(4)]);

    expect(page.records.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(page.next_page).not.toBeNull();
  });

  it("is the same for a CSV report", async () => {
    const header = '"Issue type","Severity","Component","Issue description","Affected page","HTML snippet","How to fix this issue"';
    const line = (n: number) =>
      `"rule-${n}","serious","div","d","https://shop.example/","${"x".repeat(3000)}","fix"`;
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
