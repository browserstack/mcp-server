import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// A web report's issues say which ones a person still has to confirm ("needs review"), which
// are best practices rather than WCAG failures, and the WCAG criteria each checks. Without
// them every issue read as a confirmed WCAG failure.

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
  "Issue status",
];

let n = 0;
function row(fields: Record<string, string>): Record<string, string> {
  n++;
  return {
    "Affected page": "https://site.example/",
    "HTML snippet": `<p id="e${n}">x</p>`,
    "CSS selector": `#e${n}`,
    "Needs review": "No",
    "Needs Review Status": "Confirmed",
    "Best practice": "No",
    "Issue link": `https://dash.example/issue?activeIssueId=${n}`,
    "Duplicate Issue of": "NA",
    "Issue status": "visible",
    ...fields,
  };
}

const contrast = (fix: string) =>
  row({
    "Issue type": "color-contrast",
    "Issue name": "Elements must meet minimum color contrast ratio thresholds",
    Severity: "serious",
    Component: "p",
    "Issue description": "Ensure the contrast between foreground and background colors meets WCAG thresholds",
    "Guideline(s)": "SC 1.4.3",
    "How to fix this issue": fix,
  });

const ROWS = [
  contrast("Raise the contrast to 4.5:1 (now 2.1)"),
  contrast("Raise the contrast to 4.5:1 (now 3.0)"),
  contrast("Raise the contrast to 4.5:1 (now 2.1)"),
  row({
    "Issue type": "image-alt",
    "Issue name": "Images must have alternative text",
    Severity: "critical",
    Component: "img",
    "Issue description": "Ensure img elements have alternative text",
    "Guideline(s)": "SC 1.1.1",
    "Needs review": "Yes",
    "Needs Review Status": "Unreviewed",
    "How to fix this issue": "Add an alt attribute",
  }),
  row({
    "Issue type": "region",
    "Issue name": "All page content should be contained by landmarks",
    Severity: "moderate",
    Component: "div",
    "Issue description": "Ensure all page content is contained by landmarks",
    "Guideline(s)": "Best Practice",
    "Best practice": "Yes",
    "How to fix this issue": "Put the content in a landmark",
  }),
];

function toCsv(rows: Record<string, string>[]): string {
  const cell = (value = "") => `"${value.replace(/"/g, '""')}"`;
  return [COLUMNS, ...rows.map((r) => COLUMNS.map((c) => r[c]))]
    .map((cells) => cells.map(cell).join(","))
    .join("\n");
}

describe("a web report's needs-review and best-practice issues", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ ok: true, statusText: "OK", data: toCsv(ROWS) });
  });

  it("marks an issue a person has to confirm, with its review status, and no other", async () => {
    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    const alt = records.find((r) => r.issue_type === "image-alt");
    expect(alt?.needs_review).toBe("unreviewed");
    for (const r of records.filter((r) => r.issue_type !== "image-alt")) {
      expect(r).not.toHaveProperty("needs_review");
    }
  });

  it("marks a best-practice issue, which is not a WCAG failure, and gives each issue its WCAG criteria", async () => {
    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    const region = records.find((r) => r.issue_type === "region");
    expect(region).toMatchObject({ best_practice: true, wcag: "Best Practice" });
    for (const r of records.filter((r) => r.issue_type !== "region")) {
      expect(r).not.toHaveProperty("best_practice");
    }
    expect(records.find((r) => r.issue_type === "image-alt")?.wcag).toBe("SC 1.1.1");
  });

  it("adds no WCAG criteria when the report gives none", async () => {
    get.mockResolvedValue({
      ok: true,
      statusText: "OK",
      data: toCsv([row({ "Issue type": "label", Severity: "serious", "Issue description": "l", "How to fix this issue": "f", "Guideline(s)": "" })]),
    });

    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    expect(records[0]).not.toHaveProperty("wcag");
  });

  it("keeps each issue's own description and fix", async () => {
    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    const contrastIssues = records.filter((r) => r.issue_type === "color-contrast");
    expect(contrastIssues).toHaveLength(3);
    for (const r of records) {
      expect(r.issue_description).toBeTruthy();
      expect(r.how_to_fix).toBeTruthy();
    }
  });

  it("counts the needs-review and best-practice issues of the whole report, not just the page", async () => {
    const { records, summary, next_page } = await parseAccessibilityReportFromCSV("https://csv", {
      maxCharacterLength: 1,
    });

    expect(records).toHaveLength(1);
    expect(next_page).not.toBeNull();
    expect(summary).toEqual({ needs_review: 1, best_practice: 1 });
  });

  it("does not count a needs-review issue a person has confirmed as still needing review", async () => {
    get.mockResolvedValue({
      ok: true,
      statusText: "OK",
      data: toCsv([
        ...ROWS,
        row({ "Issue type": "label", Severity: "serious", "Issue description": "l", "How to fix this issue": "f", "Needs review": "Yes", "Needs Review Status": "Confirmed" }),
      ]),
    });

    const { records, summary } = await parseAccessibilityReportFromCSV("https://csv");

    expect(records.find((r) => r.issue_type === "label")?.needs_review).toBe("confirmed");
    expect(summary.needs_review).toBe(1);
  });

  it("reads a review status written with spaces around it, and an empty one as unreviewed", async () => {
    get.mockResolvedValue({
      ok: true,
      statusText: "OK",
      data: toCsv([
        row({ "Issue type": "label", Severity: "serious", "Issue description": "l", "How to fix this issue": "f", "Needs review": "Yes", "Needs Review Status": " Confirmed " }),
        row({ "Issue type": "region", Severity: "moderate", "Issue description": "r", "How to fix this issue": "f", "Needs review": "Yes", "Needs Review Status": "  " }),
      ]),
    });

    const { records, summary } = await parseAccessibilityReportFromCSV("https://csv");

    expect(records.find((r) => r.issue_type === "label")?.needs_review).toBe("confirmed");
    expect(records.find((r) => r.issue_type === "region")?.needs_review).toBe("unreviewed");
    expect(summary.needs_review).toBe(1);
  });

  it("does the same when the report is read for one page", async () => {
    const { records, summary } = await parseAccessibilityReportFromCSV("https://csv", {
      pageUrl: "https://site.example/",
    });

    expect(records).toHaveLength(5);
    expect(records.find((r) => r.issue_type === "image-alt")?.needs_review).toBe("unreviewed");
    expect(records.find((r) => r.issue_type === "region")?.best_practice).toBe(true);
    expect(summary).toEqual({ needs_review: 1, best_practice: 1 });
  });
});
