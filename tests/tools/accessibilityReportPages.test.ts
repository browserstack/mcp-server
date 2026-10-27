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

// A page that fails to load in a re-run is still "scanned": what gets scanned is an error page
// (BrowserStack's Local connection page, or Chrome's network error page) filed under the
// page's address. Its real issues then read as resolved and the error page's as new.
describe("compareIssues and a page that did not load in the later run", () => {
  beforeEach(() => vi.clearAllMocks());

  const PAGE_A = "http://bs-local.com:3100/page-a.html";
  const PAGE_B = "http://bs-local.com:3100/page-b.html";
  const issueOn = (page: string, type: string, selector: string, snippet = "<x>") =>
    row({ "Issue type": type, Component: selector, "CSS selector": selector, "Affected page": page, "HTML snippet": snippet, "Issue link": link(`${type}-${page}`) });

  async function runs(laterB: Record<string, string>[]) {
    serve([
      issueOn(PAGE_A, "css-orientation-lock", "html"),
      issueOn(PAGE_B, "label", "input#no-label"),
      issueOn(PAGE_B, "button-name", "button#icon-btn"),
      issueOn(PAGE_B, "link-name", "a#icon-link"),
    ]);
    const before = await loadMainIssues("https://csv-old");
    serve([issueOn(PAGE_A, "css-orientation-lock", "html"), ...laterB]);
    const after = await loadMainIssues("https://csv-new");
    return compareIssues(before, after);
  }

  it("sets apart, rather than resolves, the issues of a page that showed BrowserStack's connection error page", async () => {
    const diff = await runs([
      issueOn(PAGE_B, "keyboard-focus-visible", "a.docs", '<a href="https://www.browserstack.com/docs/local-testing/binary-params?ref=dashboard-privoxy-page" target="_blank">'),
      issueOn(PAGE_B, "decorative-image", "img.logo", '<img src="https://cdn.example/logo.svg" alt="BrowserStack Logo">'),
    ]);

    expect(diff.failed_pages).toEqual([PAGE_B]);
    expect(diff.resolved).toEqual([]);
    expect(diff.not_checked.map((r) => r.issue_type).sort()).toEqual(["button-name", "label", "link-name"]);
    expect(diff.added).toEqual([]);
    expect(diff.retained).toBe(1);
  });

  it("knows Chrome's network error page too, as a public page that fails to load shows it", async () => {
    const diff = await runs([
      issueOn(PAGE_B, "landmark-one-main", "div#main-frame-error", '<div id="main-frame-error" class="interstitial-wrapper">'),
    ]);

    expect(diff.failed_pages).toEqual([PAGE_B]);
    expect(diff.resolved).toEqual([]);
  });

  it("warns, without reclassifying, when every earlier issue on a page is gone and new ones appeared", async () => {
    const diff = await runs([issueOn(PAGE_B, "region", "div.promo")]);

    expect(diff.failed_pages).toEqual([]);
    expect(diff.changed_pages).toEqual([PAGE_B]);
    expect(diff.resolved).toHaveLength(3);
    expect(diff.added.map((r) => r.issue_type)).toEqual(["region"]);
  });

  it("flags no page when its issues were simply fixed", async () => {
    const diff = await runs([]);

    expect(diff.failed_pages).toEqual([]);
    expect(diff.changed_pages).toEqual([]);
    expect(diff.resolved).toHaveLength(3);
  });
});

// The mirror case: the page failed to load in the earlier run. Its "issues" there were the
// error page's, so they are not resolved, and the page's real issues now are not new.
describe("compareIssues and a page that did not load in the earlier run", () => {
  beforeEach(() => vi.clearAllMocks());

  const PAGE_A = "http://bs-local.com:3100/page-a.html";
  const PAGE_B = "http://bs-local.com:3100/page-b.html";
  const issueOn = (page: string, type: string, selector: string, snippet = "<x>") =>
    row({ "Issue type": type, Component: selector, "CSS selector": selector, "Affected page": page, "HTML snippet": snippet, "Issue link": link(`${type}-${page}`) });
  const errorPage = [
    issueOn(PAGE_B, "keyboard-focus-visible", "a.docs", '<a href="https://www.browserstack.com/docs/local-testing/binary-params?ref=dashboard-privoxy-page" target="_blank">'),
    issueOn(PAGE_B, "decorative-image", "img.logo", '<img src="https://cdn.example/logo.svg" alt="BrowserStack Logo">'),
  ];

  async function runs(earlierB: Record<string, string>[], laterB: Record<string, string>[]) {
    serve([issueOn(PAGE_A, "css-orientation-lock", "html"), ...earlierB]);
    const before = await loadMainIssues("https://csv-old");
    serve([issueOn(PAGE_A, "css-orientation-lock", "html"), ...laterB]);
    const after = await loadMainIssues("https://csv-new");
    return compareIssues(before, after);
  }

  it("does not resolve the error page's issues, nor count the page's real issues as new", async () => {
    const diff = await runs(errorPage, [
      issueOn(PAGE_B, "label", "input#no-label"),
      issueOn(PAGE_B, "button-name", "button#icon-btn"),
    ]);

    expect(diff.failed_pages).toEqual([]);
    expect(diff.failed_pages_earlier).toEqual([PAGE_B]);
    expect(diff.resolved).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.not_checked_earlier.map((r) => r.issue_type).sort()).toEqual(["button-name", "label"]);
    expect(diff.retained).toBe(1);
  });

  it("compares nothing on a page that failed in both runs", async () => {
    const diff = await runs(errorPage, errorPage);

    expect(diff.failed_pages).toEqual([PAGE_B]);
    expect(diff.failed_pages_earlier).toEqual([PAGE_B]);
    expect(diff.resolved).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.not_checked).toEqual([]);
    expect(diff.not_checked_earlier).toEqual([]);
    expect(diff.retained).toBe(1);
  });

  it("does not take a real page that links to the Local docs, or names a class neterror-*, for an error page", async () => {
    const diff = await runs(
      [issueOn(PAGE_B, "label", "input#no-label")],
      [
        issueOn(PAGE_B, "link-name", "a.help", '<a class="help" href="https://www.browserstack.com/docs/local-testing/"></a>'),
        issueOn(PAGE_B, "color-contrast", "div.neterror-banner", '<div class="neterror-banner">Offline?</div>'),
      ],
    );

    expect(diff.failed_pages).toEqual([]);
    expect(diff.failed_pages_earlier).toEqual([]);
    expect(diff.added).toHaveLength(2);
    expect(diff.resolved).toHaveLength(1);
  });
});

describe("compareIssues on large runs", () => {
  it("compares runs of thousands of issues without stalling", () => {
    const issues = (n: number, rule: string) =>
      Array.from({ length: n }, (_, i) => {
        const page = `https://shop.example/p${i % 300}`;
        return { key: `${rule}|#e${i}|${page}`, issue_type: rule, severity: "serious", component: "input", affected_page: page };
      });

    const started = performance.now();
    const diff = compareIssues(issues(3000, "label"), issues(3000, "region"));

    expect(performance.now() - started).toBeLessThan(500);
    expect(diff.resolved).toHaveLength(3000);
    expect(diff.added).toHaveLength(3000);
    expect(diff.changed_pages).toHaveLength(300);
  });
});
