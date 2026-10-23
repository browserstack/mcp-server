import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// Reading one page of a multi-page report, paging a report with a very large issue, and
// telling two runs' issues apart.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import {
  compareIssues,
  loadMainIssues,
  parseAccessibilityReportFromCSV,
} from "../../src/tools/accessiblity-utils/report-parser.js";

const get = apiClient.get as Mock;

const COLUMNS = [
  "Issue type",
  "Severity",
  "Component",
  "Issue description",
  "Affected page",
  "HTML snippet",
  "CSS selector",
  "How to fix this issue",
  "Issue link",
  "Duplicate Issue of",
  "Issue status",
];

const link = (id: string) => `https://dash.example/issue?activeIssueId=${id}`;

function row(fields: Record<string, string>): Record<string, string> {
  return {
    Severity: "serious",
    "Issue description": "d",
    "HTML snippet": "<x>",
    "How to fix this issue": "fix",
    "Duplicate Issue of": "NA",
    "Issue status": "visible",
    ...fields,
  };
}

function toCsv(rows: Record<string, string>[]): string {
  const cell = (value = "") => `"${value.replace(/"/g, '""')}"`;
  return [COLUMNS, ...rows.map((r) => COLUMNS.map((c) => r[c]))]
    .map((cells) => cells.map(cell).join(","))
    .join("\n");
}

const serve = (rows: Record<string, string>[]) =>
  get.mockResolvedValue({ ok: true, statusText: "OK", data: toCsv(rows) });

const HOME = "https://shop.example/";
const DRY = "https://shop.example/collections/dry-skin";

/**
 * The add-to-cart contrast issue is first found on the home page and repeats on the
 * collection page twice; the collection page has one issue of its own, repeated once.
 */
const SITE = [
  row({ "Issue type": "color-contrast", Component: "span.atc", "CSS selector": "span.atc", "Affected page": HOME, "Issue link": link("a") }),
  row({ "Issue type": "color-contrast", Component: "span.atc", "CSS selector": "span.atc", "Affected page": DRY, "Issue link": link("a2"), "Duplicate Issue of": link("a") }),
  row({ "Issue type": "color-contrast", Component: "span.atc", "CSS selector": "span.atc", "Affected page": DRY, "Issue link": link("a3"), "Duplicate Issue of": link("a") }),
  row({ "Issue type": "image-alt", Severity: "critical", Component: "img.hero", "CSS selector": "img.hero", "Affected page": DRY, "Issue link": link("b") }),
  row({ "Issue type": "image-alt", Severity: "critical", Component: "img.hero", "CSS selector": "img.hero", "Affected page": DRY, "Issue link": link("b2"), "Duplicate Issue of": link("b") }),
  row({ "Issue type": "label", Component: "input", "CSS selector": "input#q", "Affected page": HOME, "Issue link": link("c") }),
  row({ "Issue type": "link-name", Component: "a", "CSS selector": "a.x", "Affected page": DRY, "Issue link": link("h"), "Issue status": "hidden" }),
];

describe("parseAccessibilityReportFromCSV for one page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts every occurrence on the page, as the dashboard's page view does, and lists each issue once", async () => {
    serve(SITE);

    const result = await parseAccessibilityReportFromCSV("https://csv", { pageUrl: DRY });

    expect(result.page).toEqual({
      url: DRY,
      occurrences: 4,
      distinct_issues: 2,
      first_found_here: 1,
      by_severity: { serious: 2, critical: 2 },
    });
    expect(result.total_issues).toBe(2);
    expect(result.records).toEqual([
      expect.objectContaining({ issue_type: "image-alt", affected_page: DRY, occurrences_on_page: 2 }),
      expect.objectContaining({ issue_type: "color-contrast", affected_page: DRY, occurrences_on_page: 2, first_found_on: HOME }),
    ]);
    expect(result.records[0]).not.toHaveProperty("first_found_on");
  });

  it("matches the page whatever its trailing slash or host case", async () => {
    serve(SITE);

    const result = await parseAccessibilityReportFromCSV("https://csv", {
      pageUrl: "https://SHOP.example/collections/dry-skin/",
    });

    expect(result.page?.occurrences).toBe(4);
  });

  it("says when no issue is on the page and names pages that look alike", async () => {
    serve(SITE);

    const result = await parseAccessibilityReportFromCSV("https://csv", {
      pageUrl: "https://shop.example/collections/dry-skin-app",
    });

    expect(result.total_issues).toBe(0);
    expect(result.page).toMatchObject({ occurrences: 0, similar_pages: [DRY] });
  });

  it("gives the no-match note for a page address that is not a URL, rather than failing", async () => {
    serve(SITE);

    const result = await parseAccessibilityReportFromCSV("https://csv", { pageUrl: "http://" });

    expect(result.page).toMatchObject({ url: "http://", occurrences: 0 });
  });

  it("still answers when a short row has no Affected page", async () => {
    get.mockResolvedValue({ ok: true, statusText: "OK", data: `${toCsv(SITE)}\n"region","moderate"` });

    const result = await parseAccessibilityReportFromCSV("https://csv", {
      pageUrl: "https://shop.example/collections/dry-skin-app",
    });

    expect(result.page).toMatchObject({ occurrences: 0, similar_pages: [DRY] });
  });
});

describe("parseAccessibilityReportFromCSV paging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hands out about 10,000 characters of issues per call by default", async () => {
    serve([1, 2, 3, 4].map((n) => row({ "Issue type": `rule-${n}`, Component: "div", "Affected page": HOME, "Issue link": link(`p${n}`), "HTML snippet": "x".repeat(3000) })));

    const page = await parseAccessibilityReportFromCSV("https://csv");

    expect(page.page_length).toBe(3);
    expect(page.next_page).not.toBeNull();
  });

  it("still returns an issue larger than a page, so paging never stalls", async () => {
    serve([
      row({ "Issue type": "small", Component: "a", "Affected page": HOME, "Issue link": link("s") }),
      row({ "Issue type": "huge", Component: "div", "Affected page": HOME, "Issue link": link("h"), "HTML snippet": "x".repeat(8000) }),
      row({ "Issue type": "after", Component: "b", "Affected page": HOME, "Issue link": link("t") }),
    ]);

    const seen: string[] = [];
    let cursor: number | null = 0;
    for (let calls = 0; cursor !== null && calls < 10; calls++) {
      const page = await parseAccessibilityReportFromCSV("https://csv", { nextPage: cursor });
      expect(page.page_length).toBeGreaterThan(0);
      seen.push(...page.records.map((r) => r.issue_type));
      cursor = page.next_page;
    }
    expect(seen.sort()).toEqual(["after", "huge", "small"]);
  });
});

describe("compareIssues", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sorts two runs' main issues into new, resolved and still open by rule, element and page", async () => {
    serve(SITE);
    const before = await loadMainIssues("https://csv-old");
    serve([
      SITE[0],
      row({ "Issue type": "label", Component: "input", "CSS selector": "input#q", "Affected page": `${HOME}`, "Issue link": link("c9") }),
      row({ "Issue type": "region", Severity: "moderate", Component: "div", "CSS selector": "div.main", "Affected page": DRY, "Issue link": link("n") }),
    ]);
    const after = await loadMainIssues("https://csv-new");

    const diff = compareIssues(before, after);

    expect(diff.added.map((r) => r.issue_type)).toEqual(["region"]);
    expect(diff.resolved.map((r) => r.issue_type)).toEqual(["image-alt"]);
    expect(diff.retained).toBe(2);
  });
});
