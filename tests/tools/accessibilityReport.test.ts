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
    expect(result.hidden_issues).toBe(0);
    expect(result.next_page).toBeNull();
  });

  it("leaves out hidden issues, and every occurrence of them", async () => {
    const LINK_C = "https://dash.example/issue?activeIssueId=hidden";
    const hiddenIssue = {
      ...contrast,
      "Issue type": "region",
      "Affected page": "https://site.example/",
    };
    const rows = [
      ...GROUPED_ROWS,
      row({
        ...hiddenIssue,
        "Issue link": LINK_C,
        "Duplicate Issue of": "NA",
        "Issue status": "hidden",
      }),
      // A duplicate of the hidden issue goes with it, whatever its own status says.
      row({
        ...hiddenIssue,
        "Issue link": "https://dash.example/issue?activeIssueId=h1",
        "Duplicate Issue of": LINK_C,
        "Issue status": "hidden",
      }),
      row({
        ...hiddenIssue,
        "Issue link": "https://dash.example/issue?activeIssueId=h2",
        "Duplicate Issue of": LINK_C,
      }),
    ];
    get.mockResolvedValue(csvResponse(toCsv(COLUMNS, rows)));
    const result = await parseAccessibilityReportFromCSV("https://csv");

    expect(result.total_issues).toBe(2);
    expect(result.records.map((r) => r.issue_type)).not.toContain("region");
    expect(result.duplicate_issues).toBe(3);
    expect(result.unlinked_duplicates).toBe(1);
    expect(result.hidden_issues).toBe(1);
  });

  it("leaves out the hidden rows of an ungrouped report", async () => {
    const ungrouped = [
      "Issue type,Severity,Component,Issue description,HTML snippet,How to fix this issue,Issue status",
      "image-alt,critical,img,Missing alt,<img>,Add alt,visible",
      "label,serious,input,No label,<input>,Add a label,hidden",
      "region,moderate,div,Not in a landmark,<div>,Add a landmark,visible",
    ].join("\n");
    get.mockResolvedValue(csvResponse(ungrouped));
    const result = await parseAccessibilityReportFromCSV("https://csv");

    expect(result.total_issues).toBe(2);
    expect(result.records.map((r) => r.issue_type)).toEqual([
      "image-alt",
      "region",
    ]);
    expect(result.hidden_issues).toBe(1);
    expect(result.duplicate_issues).toBeNull();
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
    // No Issue status column: nothing can be known to be hidden.
    expect(result.hidden_issues).toBeNull();
    expect(result.records.every((r) => !("duplicate_count" in r))).toBe(true);
  });

  it("says which page each issue is on and, for a build, which test found it", async () => {
    const buildCsv = toCsv(
      [...COLUMNS, "Source test"],
      GROUPED_ROWS.map((r) => ({ ...r, "Source test": "test_checkout" })),
    );
    get.mockResolvedValue(csvResponse(buildCsv));
    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    expect(records.map((r) => [r.affected_page, r.source_test])).toEqual([
      ["https://site.example/", "test_checkout"],
      ["https://site.example/", "test_checkout"],
    ]);
  });

  it("adds no source_test to a report without that column", async () => {
    get.mockResolvedValue(csvResponse(toCsv(COLUMNS, GROUPED_ROWS)));
    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    expect(
      records.every((r) => r.affected_page === "https://site.example/"),
    ).toBe(true);
    expect(records.every((r) => !("source_test" in r))).toBe(true);
  });
});

describe("parseAccessibilityReportFromCSV leaving issues out", () => {
  beforeEach(() => vi.clearAllMocks());

  const leaveOutRule =
    (rule: string) => async (issues: { issue_type: string }[]) =>
      new Set(issues.filter((issue) => issue.issue_type === rule));

  it("leaves them and their repeats out of the issues and every count", async () => {
    get.mockResolvedValue(csvResponse(toCsv(COLUMNS, GROUPED_ROWS)));
    const leaveOut = vi.fn(leaveOutRule("color-contrast"));

    const result = await parseAccessibilityReportFromCSV("https://csv", {
      leaveOut: leaveOut as any,
    });

    // Asked about every issue read, not one page's.
    expect(leaveOut.mock.calls[0][0].map((i: any) => i.issue_type)).toEqual([
      "color-contrast",
      "image-alt",
    ]);
    expect(result.records.map((r) => r.issue_type)).toEqual(["image-alt"]);
    expect(result.total_issues).toBe(1);
    expect(result.summary.by_rule).toEqual([
      { issue_type: "image-alt", count: 1 },
    ]);
    expect(result.summary.by_severity).toEqual({ critical: 1 });
    // The two repeats of the issue left out go with it; the unlinked one stays counted.
    expect(result.duplicate_issues).toBe(1);
    expect(result.unlinked_duplicates).toBe(1);
  });

  it("keeps the cursor an agent holds when an issue it already read is left out next time", async () => {
    // Six issues of one length, one to a page, so a cursor that moved with the issues left
    // out would land a whole issue late and skip one.
    const csv = [
      "Issue type,Severity,Component,Issue description,HTML snippet,How to fix this issue",
      ...[1, 2, 3, 4, 5, 6].map(
        (n) =>
          `region,moderate,div,Not in a landmark,<div id=a${n}>,Add a landmark`,
      ),
    ].join("\n");
    get.mockResolvedValue(csvResponse(csv));
    const ids = (records: { HTML_snippet: string }[]) =>
      records.map((r) => r.HTML_snippet);

    const first = await parseAccessibilityReportFromCSV("https://csv", {
      maxCharacterLength: 1,
    });
    expect(ids(first.records)).toEqual(["<div id=a1>"]);

    // The user says the first one is a false positive; the agent reads on.
    const leaveOut = async (issues: { HTML_snippet: string }[]) =>
      new Set(issues.filter((i) => i.HTML_snippet === "<div id=a1>"));
    const seen: string[] = [];
    let cursor = first.next_page;
    while (cursor !== null) {
      const page = await parseAccessibilityReportFromCSV("https://csv", {
        maxCharacterLength: 1,
        nextPage: cursor,
        leaveOut: leaveOut as any,
      });
      seen.push(...ids(page.records));
      cursor = page.next_page;
    }

    expect(seen).toEqual([2, 3, 4, 5, 6].map((n) => `<div id=a${n}>`));
  });

  it("hands out every other issue once when issues between pages are left out", async () => {
    const csv = [
      "Issue type,Severity,Component,Issue description,HTML snippet,How to fix this issue",
      ...[1, 2, 3, 4, 5].map(
        (n) =>
          `region,moderate,div,Not in a landmark,<div id=a${n}>,Add a landmark`,
      ),
    ].join("\n");
    get.mockResolvedValue(csvResponse(csv));
    const leaveOut = async (issues: { HTML_snippet: string }[]) =>
      new Set(
        issues.filter((i) =>
          ["<div id=a2>", "<div id=a4>"].includes(i.HTML_snippet),
        ),
      );

    const seen: string[] = [];
    let cursor: number | null = 0;
    // Bounded, so a cursor that stops moving fails the test instead of hanging it.
    for (let calls = 0; cursor !== null && calls < 10; calls++) {
      const page = await parseAccessibilityReportFromCSV("https://csv", {
        maxCharacterLength: 1,
        nextPage: cursor,
        leaveOut: leaveOut as any,
      });
      seen.push(...page.records.map((r) => r.HTML_snippet));
      cursor = page.next_page;
    }

    expect(seen).toEqual(["<div id=a1>", "<div id=a3>", "<div id=a5>"]);
    expect(cursor).toBeNull();
  });

  it("does not let an issue left out take a place on its page", async () => {
    const csv = [
      "Issue type,Severity,Component,Issue description,HTML snippet,How to fix this issue",
      ...[1, 2, 3].map(
        (n) =>
          `region,moderate,div,Not in a landmark,<div id=a${n}>,Add a landmark`,
      ),
    ].join("\n");
    get.mockResolvedValue(csvResponse(csv));

    const page = await parseAccessibilityReportFromCSV("https://csv", {
      maxCharacterLength: 1,
      leaveOut: (async (issues: { HTML_snippet: string }[]) =>
        new Set(issues.filter((i) => i.HTML_snippet !== "<div id=a3>"))) as any,
    });

    expect(page.records.map((r) => r.HTML_snippet)).toEqual(["<div id=a3>"]);
    expect(page.next_page).toBeNull();
    expect(page.remaining).toBe(0);
  });

  it("counts one page's occurrences without the issues left out", async () => {
    get.mockResolvedValue(csvResponse(toCsv(COLUMNS, GROUPED_ROWS)));

    const result = await parseAccessibilityReportFromCSV("https://csv", {
      pageUrl: "https://site.example/",
      leaveOut: leaveOutRule("color-contrast") as any,
    });

    expect(result.records.map((r) => r.issue_type)).toEqual(["image-alt"]);
    expect(result.total_issues).toBe(1);
    expect(result.page).toMatchObject({
      occurrences: 1,
      distinct_issues: 1,
      first_found_here: 1,
      by_severity: { critical: 1 },
    });
  });
});
