import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// A web report's issues say which ones a person still has to confirm ("needs review"), and a
// page names each rule's text once, under rules, rather than on every issue: the rule's
// description and usual fix were more than half of an issue's length, so a page held 10-13.

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

describe("a web report's issues, rules and counts", () => {
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

  it("names each rule's text once, under rules, and keeps an issue's own fix only when it differs", async () => {
    const { records, rules } = await parseAccessibilityReportFromCSV("https://csv");

    expect(rules["color-contrast"]).toEqual({
      name: "Elements must meet minimum color contrast ratio thresholds",
      description: "Ensure the contrast between foreground and background colors meets WCAG thresholds",
      wcag: "SC 1.4.3",
      how_to_fix: "Raise the contrast to 4.5:1 (now 2.1)",
    });
    const contrastIssues = records.filter((r) => r.issue_type === "color-contrast");
    expect(contrastIssues).toHaveLength(3);
    for (const r of records) expect(r).not.toHaveProperty("issue_description");
    expect(contrastIssues.map((r) => r.how_to_fix ?? null).sort()).toEqual([
      "Raise the contrast to 4.5:1 (now 3.0)",
      null,
      null,
    ]);
  });

  it("keeps a rule's WCAG criteria and best-practice mark on the rule, not on each issue", async () => {
    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    for (const r of records) {
      expect(r).not.toHaveProperty("wcag");
      expect(r).not.toHaveProperty("best_practice");
    }
  });

  it("counts issues by page, the page with most first", async () => {
    get.mockResolvedValue({
      ok: true,
      statusText: "OK",
      data: toCsv([
        row({ "Issue type": "label", Severity: "serious", "Issue description": "l", "How to fix this issue": "f", "Affected page": "https://site.example/a" }),
        row({ "Issue type": "label", Severity: "serious", "Issue description": "l", "How to fix this issue": "f", "Affected page": "https://site.example/b" }),
        row({ "Issue type": "region", Severity: "moderate", "Issue description": "r", "How to fix this issue": "f", "Affected page": "https://site.example/b" }),
      ]),
    });

    const { summary } = await parseAccessibilityReportFromCSV("https://csv");

    expect(summary.by_page).toEqual([
      { url: "https://site.example/b", count: 2 },
      { url: "https://site.example/a", count: 1 },
    ]);
  });

  it("marks a best-practice rule, which is not a WCAG failure", async () => {
    const { rules } = await parseAccessibilityReportFromCSV("https://csv");

    expect(rules.region).toMatchObject({ best_practice: true, wcag: "Best Practice" });
    expect(rules["color-contrast"]).not.toHaveProperty("best_practice");
  });

  it("counts the whole report, while a page names only its own issues' rules", async () => {
    const { records, rules, summary, next_page } = await parseAccessibilityReportFromCSV(
      "https://csv",
      { maxCharacterLength: 1 },
    );

    expect(records).toHaveLength(1);
    expect(next_page).not.toBeNull();
    expect(Object.keys(rules)).toEqual([records[0].issue_type]);
    expect(summary).toEqual({
      by_severity: { critical: 1, serious: 3, moderate: 1 },
      by_rule: [
        { issue_type: "color-contrast", count: 3 },
        { issue_type: "image-alt", count: 1 },
        { issue_type: "region", count: 1 },
      ],
      by_page: [{ url: "https://site.example/", count: 5 }],
      needs_review: 1,
      best_practice: 1,
    });
  });

  it("keeps a page within its length, its rules' text counted once", async () => {
    for (const maxCharacterLength of [900, 1500, 2500]) {
      const { records, rules } = await parseAccessibilityReportFromCSV("https://csv", {
        maxCharacterLength,
      });
      if (records.length < 2) continue;
      const length =
        records.reduce((sum, r) => sum + JSON.stringify(r).length, 0) +
        Object.values(rules).reduce((sum, r) => sum + JSON.stringify(r).length, 0);
      expect(length).toBeLessThanOrEqual(maxCharacterLength);
    }
  });

  it("lists a severity's issues rule by rule, the most common rule first", async () => {
    get.mockResolvedValue({
      ok: true,
      statusText: "OK",
      data: toCsv([
        row({ "Issue type": "label", Severity: "serious", "Issue description": "l", "How to fix this issue": "f" }),
        contrast("c"),
        row({ "Issue type": "label", Severity: "serious", "Issue description": "l", "How to fix this issue": "f" }),
        contrast("c"),
        row({ "Issue type": "image-alt", Severity: "critical", "Issue description": "a", "How to fix this issue": "f" }),
        contrast("c"),
      ]),
    });

    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    expect(records.map((r) => r.issue_type)).toEqual([
      "image-alt",
      "color-contrast",
      "color-contrast",
      "color-contrast",
      "label",
      "label",
    ]);
  });

  it("shortens a very long HTML snippet, saying how much the CSV has", async () => {
    const long = `<div class="promo">${"<span>offer</span>".repeat(200)}</div>`;
    get.mockResolvedValue({
      ok: true,
      statusText: "OK",
      data: toCsv([
        row({ "Issue type": "region", Severity: "moderate", "Issue description": "r", "How to fix this issue": "f", "HTML snippet": long }),
        row({ "Issue type": "label", Severity: "serious", "Issue description": "l", "How to fix this issue": "f", "HTML snippet": "<input id=q>" }),
      ]),
    });

    const { records } = await parseAccessibilityReportFromCSV("https://csv");

    const region = records.find((r) => r.issue_type === "region")!;
    expect(region.HTML_snippet.startsWith('<div class="promo"><span>offer</span>')).toBe(true);
    expect(region.HTML_snippet.length).toBeLessThan(500);
    expect(region.HTML_snippet).toMatch(new RegExp(`… \\(${long.length - 400} more characters in the CSV\\)$`));
    expect(records.find((r) => r.issue_type === "label")!.HTML_snippet).toBe("<input id=q>");
  });

  it("does the same when the report is read for one page", async () => {
    const { records, rules } = await parseAccessibilityReportFromCSV("https://csv", {
      pageUrl: "https://site.example/",
    });

    expect(records).toHaveLength(5);
    expect(records.find((r) => r.issue_type === "image-alt")?.needs_review).toBe("unreviewed");
    expect(Object.keys(rules).sort()).toEqual(["color-contrast", "image-alt", "region"]);
    for (const r of records) expect(r).not.toHaveProperty("issue_description");
  });
});
