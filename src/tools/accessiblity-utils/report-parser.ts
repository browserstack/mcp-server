import { apiClient } from "../../lib/apiClient.js";
import { parse } from "csv-parse/sync";
import logger from "../../logger.js";
import { pageOf, sortBySeverity } from "./paginate.js";

type SimplifiedAccessibilityIssue = {
  issue_type: string;
  component: string;
  issue_description: string;
  HTML_snippet: string;
  how_to_fix: string;
  severity: string;
  /** The page the issue is on; builds and Workflow Analyzer reports span several. */
  affected_page: string;
  /** Automated Tests builds only: the test that found the issue. */
  source_test?: string;
  /** Grouped reports only: how many duplicate rows point at this issue. */
  duplicate_count?: number;
  /** Read for one page: how many times the issue occurs on that page. */
  occurrences_on_page?: number;
  /** Read for one page: the page the issue was first found on, when another one. */
  first_found_on?: string;
};

/** One page of a report, counted as the dashboard's page view counts it. */
type PageSummary = {
  url: string;
  /** Every occurrence on the page, repeats of issues first found elsewhere included. */
  occurrences: number;
  /** The issues those occurrences are of. */
  distinct_issues: number;
  /** Of those, the ones first found on this page. */
  first_found_here: number;
  /** Occurrences by severity. */
  by_severity: Record<string, number>;
  /** When nothing is on the page: report pages whose address looks like it. */
  similar_pages?: string[];
};

const SOURCE_TEST_COLUMN = "Source test";

type PaginationOptions = {
  /** How many JSON-chars max per “page” (default 10000) */
  maxCharacterLength?: number;
  /** Character offset to start from (default 0) */
  nextPage?: number;
  /** Only the issues on this page. */
  pageUrl?: string;
};

type PaginatedResult = {
  records: SimplifiedAccessibilityIssue[];
  /** Character offset for the next page, or null if done */
  page_length: number;
  /** Main issues only when the report is grouped, so it matches the run's issue count. */
  total_issues: number;
  next_page: number | null;
  /** How many issues the pages after this one hold. */
  remaining: number;
  /** Duplicate rows left out of `records`; null when the report is not grouped. */
  duplicate_issues: number | null;
  /** Of those, the ones whose main issue could not be identified (counted only here). */
  unlinked_duplicates: number;
  /** Issues hidden in the dashboard and left out; null when the export has no Issue status. */
  hidden_issues: number | null;
  /** Set when the report was read for one page. */
  page?: PageSummary;
};

const DUPLICATE_COLUMN = "Duplicate Issue of";
const ISSUE_LINK_COLUMN = "Issue link";
const STATUS_COLUMN = "Issue status";

/** An issue hidden in the dashboard, which leaves it out of its count. */
function isHidden(row: Record<string, string>): boolean {
  return (row[STATUS_COLUMN] ?? "").trim().toLowerCase() === "hidden";
}

/** A grouped report marks a main issue `NA`; a duplicate carries its main issue's link. */
function isMainIssue(row: Record<string, string>): boolean {
  const value = (row[DUPLICATE_COLUMN] ?? "").trim();
  return value === "" || value.toUpperCase() === "NA";
}

/** A page address as the report writes it, give or take host case, trailing slash and hash. */
function samePage(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

function recordOfRow(
  row: any,
  hasSourceTest: boolean,
): SimplifiedAccessibilityIssue {
  return {
    issue_type: row["Issue type"],
    component: row["Component"],
    issue_description: row["Issue description"],
    HTML_snippet: row["HTML snippet"],
    how_to_fix: row["How to fix this issue"],
    severity: (row["Severity"] || "unknown").trim(),
    affected_page: row["Affected page"],
    ...(hasSourceTest ? { source_test: row[SOURCE_TEST_COLUMN] } : {}),
  };
}

async function loadReport(
  reportLink: string,
): Promise<{ parsed: any[]; columns: string[] }> {
  const res = await apiClient.get({ url: reportLink });
  if (!res.ok) throw new Error(`Failed to download report: ${res.statusText}`);
  const text =
    typeof res.data === "string" ? res.data : JSON.stringify(res.data);

  let parsed: any[];
  let columns: string[] = [];
  try {
    parsed = parse(text, {
      columns: (header: string[]) => {
        columns = header;
        return header;
      },
      skip_empty_lines: true,
      relax_column_count_less: true,
    });
  } catch (err) {
    logger.error(
      `[AccessibilityReport] CSV parse failed (${text.length} chars): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    throw err;
  }
  return { parsed, columns };
}

/**
 * One page of a report: every occurrence on it, as the dashboard's page view counts, with
 * each issue listed once. A grouped report records a repeat under the page it occurs on but
 * points it at its main issue, which may be on another page; those count here too.
 */
function pageIssues(
  parsed: any[],
  columns: string[],
  pageUrl: string,
): { all: SimplifiedAccessibilityIssue[]; page: PageSummary } {
  const grouped = columns.includes(DUPLICATE_COLUMN);
  const hasSourceTest = columns.includes(SOURCE_TEST_COLUMN);
  const target = samePage(pageUrl);
  const visible = parsed.filter((row) => !isHidden(row));
  const onPage = visible.filter(
    (row) => samePage(row["Affected page"] ?? "") === target,
  );
  const mainByLink = new Map<string, any>();
  for (const row of visible) {
    if (!grouped || isMainIssue(row)) {
      mainByLink.set((row[ISSUE_LINK_COLUMN] ?? "").trim(), row);
    }
  }
  const issues = new Map<string, SimplifiedAccessibilityIssue>();
  const bySeverity: Record<string, number> = {};
  onPage.forEach((row, i) => {
    const severity = (row["Severity"] || "unknown").trim();
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    const mainLink =
      grouped && !isMainIssue(row)
        ? (row[DUPLICATE_COLUMN] ?? "").trim()
        : (row[ISSUE_LINK_COLUMN] ?? "").trim();
    const key = mainLink || `row-${i}`;
    let issue = issues.get(key);
    if (!issue) {
      const main = mainByLink.get(mainLink) ?? row;
      issue = {
        ...recordOfRow(main, hasSourceTest),
        affected_page: row["Affected page"],
        occurrences_on_page: 0,
      };
      if (samePage(main["Affected page"] ?? "") !== target) {
        issue.first_found_on = main["Affected page"];
      }
      issues.set(key, issue);
    }
    issue.occurrences_on_page = (issue.occurrences_on_page ?? 0) + 1;
  });
  const all = [...issues.values()];
  const page: PageSummary = {
    url: pageUrl,
    occurrences: onPage.length,
    distinct_issues: all.length,
    first_found_here: all.filter((issue) => !issue.first_found_on).length,
    by_severity: bySeverity,
  };
  if (onPage.length === 0) {
    const tail =
      new URL(target, "https://x").pathname.split("/").filter(Boolean).pop() ??
      "";
    const stem = tail.split("-").slice(0, 2).join("-");
    // A short row may have no Affected page at all.
    const pages = [
      ...new Set(
        visible
          .map((row) => row["Affected page"])
          .filter((p): p is string => Boolean(p)),
      ),
    ];
    page.similar_pages = pages
      .filter((p) => stem && samePage(p).includes(stem))
      .slice(0, 5);
  }
  return { all, page };
}

/** A main issue as two runs are matched on: the rule, the element and the page. */
export type RunIssue = {
  key: string;
  issue_type: string;
  severity: string;
  component: string;
  affected_page: string;
};

/** A report's main issues that the dashboard counts (not hidden), keyed for comparing runs. */
export async function loadMainIssues(reportLink: string): Promise<RunIssue[]> {
  const { parsed, columns } = await loadReport(reportLink);
  const grouped = columns.includes(DUPLICATE_COLUMN);
  return parsed
    .filter((row) => (!grouped || isMainIssue(row)) && !isHidden(row))
    .map((row) => {
      const element = (row["CSS selector"] || row["Component"] || "").trim();
      return {
        key: [
          row["Issue type"],
          element,
          samePage(row["Affected page"] ?? ""),
        ].join("|"),
        issue_type: row["Issue type"],
        severity: (row["Severity"] || "unknown").trim(),
        component: row["Component"],
        affected_page: row["Affected page"],
      };
    });
}

/** Which issues of `current` are new since `base`, which of `base` are gone, and how many remain. */
export function compareIssues(
  base: RunIssue[],
  current: RunIssue[],
): { added: RunIssue[]; resolved: RunIssue[]; retained: number } {
  const before = new Set(base.map((issue) => issue.key));
  const after = new Set(current.map((issue) => issue.key));
  return {
    added: sortBySeverity(current.filter((issue) => !before.has(issue.key))),
    resolved: sortBySeverity(base.filter((issue) => !after.has(issue.key))),
    retained: current.filter((issue) => before.has(issue.key)).length,
  };
}

export async function parseAccessibilityReportFromCSV(
  reportLink: string,
  { maxCharacterLength = 5000, nextPage = 0, pageUrl }: PaginationOptions = {},
): Promise<PaginatedResult> {
  // 1) Download & parse
  const { parsed, columns } = await loadReport(reportLink);

  if (pageUrl) {
    const { all, page } = pageIssues(parsed, columns, pageUrl);
    const slice = pageOf(sortBySeverity(all), { maxCharacterLength, nextPage });
    return {
      ...slice,
      total_issues: all.length,
      duplicate_issues: null,
      unlinked_duplicates: 0,
      hidden_issues: null,
      page,
    };
  }

  // 2) Leave out hidden issues and fold duplicates into their main issue, as the
  // dashboard's count does.
  //
  // A hidden issue (Issue status "hidden") is left out with every occurrence of it. In a
  // grouped report, a duplicate's "Duplicate Issue of" is the exact "Issue link" of the
  // main issue it repeats, so the two are matched verbatim. A value that matches no main
  // issue, or matches more than one, is not guessed at: it is counted in
  // `unlinked_duplicates` and the duplicate total, never against a specific issue.
  const grouped = columns.includes(DUPLICATE_COLUMN);
  const linkable = grouped && columns.includes(ISSUE_LINK_COLUMN);
  const hasSourceTest = columns.includes(SOURCE_TEST_COLUMN);
  const mainRows = grouped ? parsed.filter(isMainIssue) : parsed;
  const visibleMainRows = mainRows.filter((row) => !isHidden(row));
  const duplicateRows = grouped
    ? parsed.filter((row) => !isMainIssue(row))
    : [];

  const recordOf = new Map<unknown, SimplifiedAccessibilityIssue>();
  const all: SimplifiedAccessibilityIssue[] = visibleMainRows.map(
    (row: any) => {
      const record: SimplifiedAccessibilityIssue = {
        ...recordOfRow(row, hasSourceTest),
        ...(linkable ? { duplicate_count: 0 } : {}),
      };
      recordOf.set(row, record);
      return record;
    },
  );

  // Each main issue's link → its record, "hidden" when it is left out, or null when two
  // main issues share the link and their duplicates cannot be told apart.
  const byLink = new Map<
    string,
    SimplifiedAccessibilityIssue | "hidden" | null
  >();
  if (linkable) {
    for (const row of mainRows) {
      const link = (row[ISSUE_LINK_COLUMN] ?? "").trim();
      if (!link) continue;
      byLink.set(
        link,
        byLink.has(link) ? null : (recordOf.get(row) ?? "hidden"),
      );
    }
  }
  let duplicates = 0;
  let unlinkedDuplicates = 0;
  for (const row of duplicateRows) {
    const main = byLink.get((row[DUPLICATE_COLUMN] ?? "").trim());
    if (isHidden(row) || main === "hidden") continue;
    duplicates++;
    if (main) main.duplicate_count = (main.duplicate_count ?? 0) + 1;
    else unlinkedDuplicates++;
  }

  // 3) Most severe first, in pages by JSON length
  const page = pageOf(sortBySeverity(all), { maxCharacterLength, nextPage });

  return {
    ...page,
    total_issues: all.length,
    duplicate_issues: grouped ? duplicates : null,
    unlinked_duplicates: unlinkedDuplicates,
    hidden_issues: columns.includes(STATUS_COLUMN)
      ? mainRows.length - visibleMainRows.length
      : null,
  };
}
