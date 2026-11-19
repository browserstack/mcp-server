import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ExportPendingError,
  type AccessibilityReportFetcher,
  type IssueSource,
} from "./report-fetcher.js";
import {
  compareIssues,
  loadMainIssues,
  type RunIssue,
} from "./report-parser.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";
import {
  createSuccessResponse,
  exportProgress,
  formatDuration,
  type ScanProgressContext,
} from "./shared.js";

/*
 * What a comparison of two web reports (Website Scanner runs, or Automated Tests builds)
 * shares: the two exports matched by rule, element and page, the lists it gives, and the
 * pages that did not load in either.
 */

/**
 * The pages of the newer run that did not load (an error page was scanned in their place),
 * or whose earlier issues all gave way to new ones. Neither the scan nor the dashboard says
 * so, and their real issues would otherwise read as fixed.
 */
export function pagesNotLoadedNote(
  diff: {
    not_checked?: unknown[];
    failed_pages?: string[];
    not_checked_earlier?: unknown[];
    failed_pages_earlier?: string[];
    changed_pages?: string[];
  },
  later: string,
  earlier: string,
  noun: "run" | "build",
): string[] {
  const pages = (urls: string[]) =>
    wrapUntrusted("report page addresses", JSON.stringify(urls));
  // Worded for one page or several, one issue or several.
  const one = (count: number, singular: string, plural: string) =>
    count === 1 ? singular : plural;
  const they = (n: number) => one(n, "it", "they");
  const didNotLoad = (urls: string[], run: string) => {
    const n = urls.length;
    return `⚠️ ${one(n, "1 page", `${n} pages`)} did not load in ${run}: ${one(n, "an error page was", "error pages were")} scanned in ${one(n, "its", "their")} place. The ${one(n, "error page's", "error pages'")} issues are not counted as`;
  };
  // A page that failed in both runs has no issues of its own in either.
  const foundThere = (count: number, run: string, notCountedAs: string) =>
    count > 0
      ? `, and the ${one(count, "1 issue", `${count} issues`)} found there in ${run} ${one(count, "is", "are")} not counted as ${notCountedAs}`
      : "";
  const failed = diff.failed_pages ?? [];
  const failedEarlier = diff.failed_pages_earlier ?? [];
  const changed = diff.changed_pages ?? [];
  return [
    ...(failed.length > 0
      ? [
          `${didNotLoad(failed, later)} new${foundThere(diff.not_checked?.length ?? 0, earlier, "resolved (listed as not checked)")}. ${noun === "run" ? "Scan" : "Run the tests"} again once ${they(failed.length)} ${one(failed.length, "loads", "load")}. ${pages(failed)}`,
        ]
      : []),
    ...(failedEarlier.length > 0
      ? [
          `${didNotLoad(failedEarlier, earlier)} resolved${foundThere(diff.not_checked_earlier?.length ?? 0, later, `new (listed as not checked against the earlier ${noun})`)}. Compare with a ${noun} in which ${they(failedEarlier.length)} loaded. ${pages(failedEarlier)}`,
        ]
      : []),
    ...(changed.length > 0
      ? [
          `⚠️ None of the earlier issues on ${one(changed.length, "1 page remain, and it has", `${changed.length} pages remain, and they have`)} new ones: ${they(changed.length)} may not have loaded, or loaded something else, in ${later}. Check ${one(changed.length, "it", "them")} before calling those issues fixed. ${pages(changed)}`,
        ]
      : []),
  ];
}

/** At most this many issues of each list are listed in a comparison. */
export const COMPARE_LIST_LIMIT = 50;

/**
 * One list of a comparison, at most COMPARE_LIST_LIMIT of it, quoted as data: its rows come
 * from the reports. `total` counts the whole list where only its first issues were read;
 * `rest` says where the ones not listed are.
 */
export function comparedList(
  issues: RunIssue[],
  total = issues.length,
  rest = "",
): string {
  const shown = issues.slice(0, COMPARE_LIST_LIMIT);
  const more = total - shown.length;
  return (
    wrapUntrusted("accessibility comparison", JSON.stringify(shown, null, 2)) +
    (more > 0 ? `\n(${more} more not listed${rest}.)` : "")
  );
}

/**
 * Two reports' CSV exports, read and matched by rule, element and page; or, while an export
 * is still being generated, the answer to give instead.
 */
export async function diffExports(
  reportFetcher: AccessibilityReportFetcher,
  later: IssueSource,
  earlier: IssueSource,
  what: "runs" | "builds",
  context?: ScanProgressContext,
): Promise<
  | { links: [string, string]; diff: ReturnType<typeof compareIssues> }
  | CallToolResult
> {
  let links: [string, string];
  try {
    links = await Promise.all([
      reportFetcher.getReportLink(later, { onWait: exportProgress(context) }),
      reportFetcher.getReportLink(earlier, {}),
    ]);
  } catch (error) {
    if (error instanceof ExportPendingError) {
      return createSuccessResponse([
        `The CSV exports of these ${what} are still being generated (waited ${formatDuration(error.waitedMs)}). Call fetchAccessibilityIssues again with the same arguments in about a minute; the exports continue where they are.`,
      ]);
    }
    throw error;
  }
  const [after, before] = await Promise.all(links.map(loadMainIssues));
  return { links, diff: compareIssues(before, after) };
}
