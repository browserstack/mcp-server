import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import { parseAccessibilityReportFromCSV } from "../../src/tools/accessiblity-utils/report-parser.js";

const get = apiClient.get as Mock;

const COLUMNS = [
  "Issue type",
  "Issue name",
  "Severity",
  "Component",
  "Behavior",
  "Issue description",
  "Affected page",
  "Guideline(s)",
  "HTML snippet",
  "CSS selector",
  "Needs review",
  "Needs Review Status",
  "Best practice",
  "How to fix this issue",
  "Issue link",
  "Duplicate Issue of",
  "Timestamp",
  "Issue status",
  "Page HTML Source",
];

const LINK_A = "https://dash.example/issue?activeIssueId=a";
const LINK_B = "https://dash.example/issue?activeIssueId=b";

function row(fields: Record<string, string>): Record<string, string> {
  return {
    Behavior: "",
    "Needs Review Status": "Confirmed",
    "Best practice": "No",
    Timestamp: "2026-10-01",
    "Issue status": "Visible",
    "Page HTML Source": "https://dash.example/html",
    ...fields,
  };
}

const contrast = {
  "Issue type": "color-contrast",
  "Issue name": "Elements must meet contrast",
  Severity: "serious",
  Component: "p.note",
  "Issue description": "Low contrast",
  "Guideline(s)": "WCAG 2.1 AA, 1.4.3",
  "CSS selector": "p.note",
  "Needs review": "No",
  "How to fix this issue": "Raise contrast",
};

/** Two main issues; two duplicates of A, one duplicate whose main is not in the file. */
const GROUPED_ROWS = [
  row({
    ...contrast,
    "Affected page": "https://site.example/",
    "HTML snippet": '<p class="note">x</p>',
    "Issue link": LINK_A,
    "Duplicate Issue of": "NA",
  }),
  row({
    "Issue type": "image-alt",
    "Issue name": "Images must have alt text",
    Severity: "critical",
    Component: "img.hero",
    "Issue description": "Missing alt",
    "Affected page": "https://site.example/",
    "Guideline(s)": "WCAG 2.1 A",
    "HTML snippet": "<img class=hero>",
    "CSS selector": "img.hero",
    "Needs review": "Yes",
    "How to fix this issue": "Add alt",
    "Issue link": LINK_B,
    "Duplicate Issue of": "NA",
  }),
  row({
    ...contrast,
    "Affected page": "https://site.example/a",
    "HTML snippet": "<p>y</p>",
    "Issue link": "https://dash.example/issue?activeIssueId=c",
    "Duplicate Issue of": LINK_A,
  }),
  row({
    ...contrast,
    "Affected page": "https://site.example/b",
    "HTML snippet": "<p>z</p>",
    "Issue link": "https://dash.example/issue?activeIssueId=d",
    "Duplicate Issue of": LINK_A,
  }),
  row({
    ...contrast,
    "Issue type": "label",
    "Affected page": "https://site.example/c",
    "Issue link": "https://dash.example/issue?activeIssueId=e",
    "Duplicate Issue of": "https://dash.example/issue?activeIssueId=gone",
  }),
];

/** Quote every cell, CSV-style. */
function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const cell = (value = "") => `"${value.replace(/"/g, '""')}"`;
  return [columns, ...rows.map((r) => columns.map((c) => r[c]))]
    .map((cells) => cells.map(cell).join(","))
    .join("\n");
}

function csvResponse(text: string) {
  return { ok: true, statusText: "OK", data: text };
}

describe("parseAccessibilityReportFromCSV", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only main issues, with duplicates counted against the issue they point at", async () => {
    get.mockResolvedValue(csvResponse(toCsv(COLUMNS, GROUPED_ROWS)));
    const result = await parseAccessibilityReportFromCSV("https://csv");

    expect(result.total_issues).toBe(2);
    expect(
      result.records.map((r) => [r.issue_type, r.duplicate_count]),
    ).toEqual([
      ["image-alt", 0],
      ["color-contrast", 2],
    ]);
    // The third duplicate's main issue is not in the file: counted in the total only.
    expect(result.duplicate_issues).toBe(3);
    expect(result.unlinked_duplicates).toBe(1);
    expect(result.next_page).toBeNull();
  });

  it("does not attribute duplicates when the report has no Issue link to match them by", async () => {
    const withoutLinks = toCsv(
      COLUMNS.filter((c) => c !== "Issue link"),
      GROUPED_ROWS,
    );
    get.mockResolvedValue(csvResponse(withoutLinks));
    const result = await parseAccessibilityReportFromCSV("https://csv");

    expect(result.total_issues).toBe(2);
    expect(result.records.every((r) => !("duplicate_count" in r))).toBe(true);
    expect(result.duplicate_issues).toBe(3);
    expect(result.unlinked_duplicates).toBe(3);
  });

  it("keeps every row of an ungrouped report and adds no duplicate fields", async () => {
    const ungrouped = [
      "Issue type,Severity,Component,Issue description,HTML snippet,How to fix this issue,Issue link",
      "image-alt,critical,img,Missing alt,<img>,Add alt,https://d/1",
      "image-alt,critical,img,Missing alt,<img>,Add alt,https://d/2",
    ].join("\n");
    get.mockResolvedValue(csvResponse(ungrouped));
    const result = await parseAccessibilityReportFromCSV("https://csv");

    expect(result.total_issues).toBe(2);
    expect(result.duplicate_issues).toBeNull();
    expect(result.unlinked_duplicates).toBe(0);
    expect(result.records.every((r) => !("duplicate_count" in r))).toBe(true);
  });
});
