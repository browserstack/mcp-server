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
};

const SOURCE_TEST_COLUMN = "Source test";

type PaginationOptions = {
  /** How many JSON-chars max per “page” (default 10000) */
  maxCharacterLength?: number;
  /** Character offset to start from (default 0) */
  nextPage?: number;
};

type PaginatedResult = {
  records: SimplifiedAccessibilityIssue[];
  /** Character offset for the next page, or null if done */
  page_length: number;
  /** Main issues only when the report is grouped, so it matches the run's issue count. */
  total_issues: number;
  next_page: number | null;
  /** Duplicate rows left out of `records`; null when the report is not grouped. */
  duplicate_issues: number | null;
  /** Of those, the ones whose main issue could not be identified (counted only here). */
  unlinked_duplicates: number;
  /** Issues hidden in the dashboard and left out; null when the export has no Issue status. */
  hidden_issues: number | null;
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

export async function parseAccessibilityReportFromCSV(
  reportLink: string,
  { maxCharacterLength = 5000, nextPage = 0 }: PaginationOptions = {},
): Promise<PaginatedResult> {
  // 1) Download & parse
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
        issue_type: row["Issue type"],
        component: row["Component"],
        issue_description: row["Issue description"],
        HTML_snippet: row["HTML snippet"],
        how_to_fix: row["How to fix this issue"],
        severity: (row["Severity"] || "unknown").trim(),
        affected_page: row["Affected page"],
        ...(hasSourceTest ? { source_test: row[SOURCE_TEST_COLUMN] } : {}),
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
