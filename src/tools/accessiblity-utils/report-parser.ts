import { apiClient } from "../../lib/apiClient.js";
import { parse } from "csv-parse/sync";
import logger from "../../logger.js";
import {
  mostCommon,
  PAGE_CHARACTERS,
  pageOf,
  severityRank,
  sortBySeverity,
} from "./paginate.js";

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
  /**
   * The engine could not decide it, so a person confirms it: its review status,
   * "unreviewed" until someone does.
   */
  needs_review?: string;
};

/** An issue as a page hands it out: its rule's text is under the page's rules. */
type IssueRow = Omit<
  SimplifiedAccessibilityIssue,
  "issue_description" | "how_to_fix"
> & {
  /** Only when it differs from its rule's description. */
  issue_description?: string;
  /** Only when it differs from its rule's usual fix. */
  how_to_fix?: string;
};

/** A rule's text, the same on each of its issues. */
type RuleText = {
  name?: string;
  description: string;
  /** The WCAG success criteria it checks, as the report writes them. */
  wcag?: string;
  /** A best practice, not a WCAG failure. */
  best_practice?: true;
  how_to_fix: string;
};

export type IssueSummary = {
  by_severity: Record<string, number>;
  /** Largest first. */
  by_rule: { issue_type: string; count: number }[];
  /** The page each issue was found on, most issues first. */
  by_page: { url: string; count: number }[];
  /** Needs-review issues no one has confirmed yet. */
  needs_review: number;
  best_practice: number;
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
  records: IssueRow[];
  /** The rules this page's issues name. */
  rules: Record<string, RuleText>;
  /** All the issues read, not just this page's. */
  summary: IssueSummary;
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
const NEEDS_REVIEW_COLUMN = "Needs review";
const REVIEW_STATUS_COLUMN = "Needs Review Status";
const BEST_PRACTICE_COLUMN = "Best practice";
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

/**
 * How much of an issue's HTML snippet a page hands out. A snippet can be an element's whole
 * markup (thousands of characters for a container), which took most of a page by itself;
 * its opening tag, which says which element it is, comes first.
 */
const SNIPPET_CHARACTERS = 400;

function shortSnippet(snippet: string | undefined): string {
  const text = snippet ?? "";
  return text.length > SNIPPET_CHARACTERS
    ? `${text.slice(0, SNIPPET_CHARACTERS)}… (${text.length - SNIPPET_CHARACTERS} more characters in the CSV)`
    : text;
}

const isYes = (value: string | undefined) =>
  (value ?? "").trim().toLowerCase() === "yes";

function recordOfRow(
  row: any,
  hasSourceTest: boolean,
): SimplifiedAccessibilityIssue {
  return {
    issue_type: row["Issue type"],
    component: row["Component"],
    issue_description: row["Issue description"],
    HTML_snippet: shortSnippet(row["HTML snippet"]),
    how_to_fix: row["How to fix this issue"],
    severity: (row["Severity"] || "unknown").trim(),
    affected_page: row["Affected page"],
    // A "needs review" issue is one the engine could not decide: a person confirms it.
    ...(isYes(row[NEEDS_REVIEW_COLUMN])
      ? {
          needs_review: (
            (row[REVIEW_STATUS_COLUMN] ?? "").trim() || "unreviewed"
          ).toLowerCase(),
        }
      : {}),
    ...(hasSourceTest ? { source_test: row[SOURCE_TEST_COLUMN] } : {}),
  };
}

/**
 * Each rule's name, description, WCAG criteria and usual fix, from the report's rows: the
 * same on every issue of the rule, so said once under a page's rules. The usual fix is the
 * one most of its issues give; some rules (colour contrast) write the element's own values
 * into it.
 */
function rulesOf(
  rows: Record<string, string>[],
  issues: SimplifiedAccessibilityIssue[],
): Record<string, RuleText> {
  const fixes = new Map<string, string[]>();
  for (const issue of issues) {
    const list = fixes.get(issue.issue_type) ?? [];
    list.push(issue.how_to_fix ?? "");
    fixes.set(issue.issue_type, list);
  }
  const rules: Record<string, RuleText> = {};
  for (const row of rows) {
    const type = row["Issue type"];
    if (!type || rules[type]) continue;
    rules[type] = {
      ...(row["Issue name"] ? { name: row["Issue name"] } : {}),
      description: row["Issue description"] ?? "",
      ...(row["Guideline(s)"] ? { wcag: row["Guideline(s)"] } : {}),
      ...(isYes(row[BEST_PRACTICE_COLUMN])
        ? { best_practice: true as const }
        : {}),
      how_to_fix: mostCommon(
        fixes.get(type) ?? [row["How to fix this issue"] ?? ""],
      ),
    };
  }
  return rules;
}

/** An issue without its rule's text, keeping its own description or fix where they differ. */
function withoutRuleText(
  issue: SimplifiedAccessibilityIssue,
  rule: RuleText | undefined,
): IssueRow {
  const { issue_description, how_to_fix, ...own } = issue;
  return {
    ...own,
    ...(issue_description !== rule?.description ? { issue_description } : {}),
    ...(how_to_fix !== rule?.how_to_fix ? { how_to_fix } : {}),
  };
}

/**
 * The whole report's issues at a glance: by severity, rule and page, and how many to
 * confirm. Pages are told apart as the report writes them, give or take host case, trailing
 * slash and hash, and each is named by the first address the report gives it.
 */
function summaryOf(
  issues: SimplifiedAccessibilityIssue[],
  rules: Record<string, RuleText>,
): IssueSummary {
  const bySeverity: Record<string, number> = {};
  const byRule = new Map<string, number>();
  const byPage = new Map<string, { url: string; count: number }>();
  for (const issue of issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    byRule.set(issue.issue_type, (byRule.get(issue.issue_type) ?? 0) + 1);
    const url = issue.affected_page ?? "";
    const page = byPage.get(samePage(url)) ?? { url, count: 0 };
    page.count++;
    byPage.set(samePage(url), page);
  }
  return {
    by_severity: bySeverity,
    by_rule: [...byRule]
      .map(([issue_type, count]) => ({ issue_type, count }))
      .sort((a, b) => b.count - a.count),
    by_page: [...byPage.values()].sort((a, b) => b.count - a.count),
    // A needs-review issue a person has confirmed is a confirmed failure.
    needs_review: issues.filter(
      (issue) => issue.needs_review && issue.needs_review !== "confirmed",
    ).length,
    best_practice: issues.filter(
      (issue) => rules[issue.issue_type]?.best_practice,
    ).length,
  };
}

/**
 * One page of issues, each without its rule's text, with the rules that page names and the
 * counts of all of them. Most severe first, and within a severity rule by rule, the most
 * common rule first: a page then names fewer rules, and a rule's text, counted against the
 * page's length the first time the page names it, is said once for all its issues there.
 */
function pageWithRules(
  all: SimplifiedAccessibilityIssue[],
  rows: Record<string, string>[],
  options: { maxCharacterLength: number; nextPage: number },
) {
  const rules = rulesOf(rows, all);
  const summary = summaryOf(all, rules);
  const ruleRank = new Map(
    summary.by_rule.map(({ issue_type }, i) => [issue_type, i]),
  );
  const ordered = all
    .map((issue, i) => ({ issue, i }))
    .sort(
      (a, b) =>
        severityRank(a.issue.severity) - severityRank(b.issue.severity) ||
        (ruleRank.get(a.issue.issue_type) ?? 0) -
          (ruleRank.get(b.issue.issue_type) ?? 0) ||
        a.i - b.i,
    )
    .map(({ issue }) => withoutRuleText(issue, rules[issue.issue_type]));
  const named = new Set<string>();
  const page = pageOf(ordered, {
    ...options,
    extraLength: (row) => {
      if (named.has(row.issue_type)) return 0;
      named.add(row.issue_type);
      return JSON.stringify(rules[row.issue_type] ?? {}).length;
    },
  });
  return {
    ...page,
    rules: Object.fromEntries(
      [...new Set(page.records.map((r) => r.issue_type))].map((type) => [
        type,
        rules[type],
      ]),
    ),
    summary,
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
  /** Found on an error page scanned in the page's place: the page did not load. */
  on_error_page?: true;
};

/**
 * Snippets only an error page shows: BrowserStack's Local connection page (its links carry
 * ref=dashboard-privoxy-page), and Chrome's network error page. A page that fails to load
 * is still "scanned", as one of these. A link to the Local docs, or a class merely starting
 * with neterror, is not enough: a real page can have either.
 */
const ERROR_PAGE_SNIPPET =
  /dashboard-privoxy-page|id="main-frame-error"|chrome-error:\/\/|class="neterror[" ]/i;

/** A page whose earlier issues are all gone and new ones appeared: worth a second look. */
const CHANGED_PAGE_MIN_ISSUES = 2;

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
        ...(ERROR_PAGE_SNIPPET.test(row["HTML snippet"] ?? "")
          ? { on_error_page: true as const }
          : {}),
      };
    });
}

/** A run's issues by page, with whether an error page was scanned in the page's place. */
function issuesByPage(
  issues: RunIssue[],
): Map<string, { url: string; issues: RunIssue[]; failed: boolean }> {
  const pages = new Map<
    string,
    { url: string; issues: RunIssue[]; failed: boolean }
  >();
  for (const issue of issues) {
    const key = samePage(issue.affected_page ?? "");
    let page = pages.get(key);
    if (!page) {
      page = { url: issue.affected_page, issues: [], failed: false };
      pages.set(key, page);
    }
    page.issues.push(issue);
    if (issue.on_error_page) page.failed = true;
  }
  return pages;
}

/**
 * Which issues of `current` are new since `base`, which of `base` are gone, and how many
 * remain, decided page by page. A page that did not load in one of the runs (an error page
 * was scanned under its address) is set apart. Not loaded in `current`: its earlier issues
 * were not checked again, so they are `not_checked` rather than resolved, and the error
 * page's issues are not new. Not loaded in `base`: the error page's issues are not resolved,
 * and the page's issues now are `not_checked_earlier` rather than new. A page whose earlier
 * issues are all gone while new ones appeared is named in `changed_pages`, as it may not have
 * loaded either.
 */
export function compareIssues(
  base: RunIssue[],
  current: RunIssue[],
): {
  added: RunIssue[];
  resolved: RunIssue[];
  retained: number;
  not_checked: RunIssue[];
  failed_pages: string[];
  not_checked_earlier: RunIssue[];
  failed_pages_earlier: string[];
  changed_pages: string[];
} {
  const before = issuesByPage(base);
  const after = issuesByPage(current);
  const added: RunIssue[] = [];
  const resolved: RunIssue[] = [];
  const notChecked: RunIssue[] = [];
  const notCheckedEarlier: RunIssue[] = [];
  const failedPages: string[] = [];
  const failedPagesEarlier: string[] = [];
  const changedPages: string[] = [];
  let retained = 0;
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const earlier = before.get(key);
    const later = after.get(key);
    if (later?.failed) failedPages.push(later.url);
    if (earlier?.failed) failedPagesEarlier.push(earlier.url);
    if (later?.failed || earlier?.failed) {
      // Only the run in which the page loaded has its issues, and they cannot be matched.
      if (!earlier?.failed) notChecked.push(...(earlier?.issues ?? []));
      if (!later?.failed) notCheckedEarlier.push(...(later?.issues ?? []));
      continue;
    }
    const earlierKeys = new Set(earlier?.issues.map((issue) => issue.key));
    const laterKeys = new Set(later?.issues.map((issue) => issue.key));
    const pageAdded = (later?.issues ?? []).filter(
      (issue) => !earlierKeys.has(issue.key),
    );
    const pageResolved = (earlier?.issues ?? []).filter(
      (issue) => !laterKeys.has(issue.key),
    );
    added.push(...pageAdded);
    resolved.push(...pageResolved);
    retained += (later?.issues.length ?? 0) - pageAdded.length;
    if (
      earlier &&
      earlier.issues.length >= CHANGED_PAGE_MIN_ISSUES &&
      pageResolved.length === earlier.issues.length &&
      pageAdded.length > 0
    ) {
      changedPages.push(earlier.url);
    }
  }
  return {
    added: sortBySeverity(added),
    resolved: sortBySeverity(resolved),
    retained,
    not_checked: sortBySeverity(notChecked),
    failed_pages: failedPages,
    not_checked_earlier: sortBySeverity(notCheckedEarlier),
    failed_pages_earlier: failedPagesEarlier,
    changed_pages: changedPages,
  };
}

export async function parseAccessibilityReportFromCSV(
  reportLink: string,
  {
    maxCharacterLength = PAGE_CHARACTERS,
    nextPage = 0,
    pageUrl,
  }: PaginationOptions = {},
): Promise<PaginatedResult> {
  // 1) Download & parse
  const { parsed, columns } = await loadReport(reportLink);

  if (pageUrl) {
    const { all, page } = pageIssues(parsed, columns, pageUrl);
    const slice = pageWithRules(all, parsed, { maxCharacterLength, nextPage });
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

  // 3) Most severe first, in pages by JSON length, each rule's text once per page
  const page = pageWithRules(all, parsed, { maxCharacterLength, nextPage });

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
