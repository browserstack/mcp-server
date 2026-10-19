import { apiClient } from "../../lib/apiClient.js";
import { parse } from "csv-parse/sync";
import logger from "../../logger.js";

type SimplifiedAccessibilityIssue = {
  issue_type: string;
  component: string;
  issue_description: string;
  HTML_snippet: string;
  how_to_fix: string;
  severity: string;
  /** Grouped reports only: how many duplicate rows point at this issue. */
  duplicate_count?: number;
};

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
};

const DUPLICATE_COLUMN = "Duplicate Issue of";
const ISSUE_LINK_COLUMN = "Issue link";

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

  // 2) Fold duplicates into their main issue (grouped reports only).
  //
  // The export writes a duplicate's "Duplicate Issue of" as the exact "Issue link" of the
  // main issue it belongs to, so the two are matched verbatim. A value that matches no
  // main issue, or matches more than one, is not guessed at: it is counted in
  // `unlinked_duplicates` and the duplicate total, never against a specific issue.
  const grouped = columns.includes(DUPLICATE_COLUMN);
  const linkable = grouped && columns.includes(ISSUE_LINK_COLUMN);
  const mainRows = grouped ? parsed.filter(isMainIssue) : parsed;
  const duplicateRows = grouped
    ? parsed.filter((row) => !isMainIssue(row))
    : [];

  const all: SimplifiedAccessibilityIssue[] = mainRows.map((row: any) => ({
    issue_type: row["Issue type"],
    component: row["Component"],
    issue_description: row["Issue description"],
    HTML_snippet: row["HTML snippet"],
    how_to_fix: row["How to fix this issue"],
    severity: (row["Severity"] || "unknown").trim(),
    ...(linkable ? { duplicate_count: 0 } : {}),
  }));

  let unlinkedDuplicates = duplicateRows.length;
  if (linkable && duplicateRows.length > 0) {
    const byLink = new Map<string, SimplifiedAccessibilityIssue | null>();
    mainRows.forEach((row: any, i: number) => {
      const link = (row[ISSUE_LINK_COLUMN] ?? "").trim();
      if (!link) return;
      // Two main issues sharing a link cannot tell their duplicates apart.
      byLink.set(link, byLink.has(link) ? null : all[i]);
    });
    unlinkedDuplicates = 0;
    for (const row of duplicateRows) {
      const main = byLink.get((row[DUPLICATE_COLUMN] ?? "").trim());
      if (main) main.duplicate_count = (main.duplicate_count ?? 0) + 1;
      else unlinkedDuplicates++;
    }
  }

  const totalIssues = all.length;

  // 3) Sort by severity
  const order: Record<string, number> = {
    critical: 0,
    serious: 1,
    moderate: 2,
    minor: 3,
  };
  all.sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));

  // 4) Walk to the starting offset
  let charCursor = 0;
  let idx = 0;
  for (; idx < all.length; idx++) {
    const len = JSON.stringify(all[idx]).length;
    if (charCursor + len > nextPage) break;
    charCursor += len;
  }

  // 5) Collect up to maxCharacterLength
  const page: SimplifiedAccessibilityIssue[] = [];
  for (let i = idx; i < all.length; i++) {
    const recStr = JSON.stringify(all[i]);
    if (charCursor - nextPage + recStr.length > maxCharacterLength) break;
    page.push(all[i]);
    charCursor += recStr.length;
  }

  const pageLength = page.length;

  const hasMore = idx + pageLength < totalIssues;
  return {
    records: page,
    next_page: hasMore ? charCursor : null,
    page_length: pageLength,
    total_issues: totalIssues,
    duplicate_issues: grouped ? duplicateRows.length : null,
    unlinked_duplicates: unlinkedDuplicates,
  };
}
