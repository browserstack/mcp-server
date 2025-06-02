import fetch from "node-fetch";
import { parse } from "csv-parse/sync";

type SimplifiedAccessibilityIssue = {
  issue_type: string;
  component: string;
  issue_description: string;
  HTML_snippet: string;
  how_to_fix: string;
  severity: string;
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
  total_issues: number;
  next_page: number | null;
};

export async function parseAccessibilityReportFromCSV(
  reportLink: string,
  { maxCharacterLength = 5000, nextPage = 0 }: PaginationOptions = {},
): Promise<PaginatedResult> {
  // 1) Download & parse
  const res = await fetch(reportLink);
  if (!res.ok) throw new Error(`Failed to download report: ${res.statusText}`);
  const text = await res.text();
  const all: SimplifiedAccessibilityIssue[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
  }).map((row: any) => ({
    issue_type: row["Issue type"],
    component: row["Component"],
    issue_description: row["Issue description"],
    HTML_snippet: row["HTML snippet"],
    how_to_fix: row["How to fix this issue"],
    severity: (row["Severity"] || "unknown").trim(),
  }));

  const totalIssues = all.length;

  // 2) Sort by severity
  const order: Record<string, number> = {
    critical: 0,
    serious: 1,
    moderate: 2,
    minor: 3,
  };
  all.sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));

  // 3) Walk to the starting offset
  let charCursor = 0;
  let idx = 0;
  for (; idx < all.length; idx++) {
    const len = JSON.stringify(all[idx]).length;
    if (charCursor + len > nextPage) break;
    charCursor += len;
  }

  // 4) Collect up to maxCharacterLength
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
  };
}
