import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ScanFailureDetails } from "./scanner.js";
import {
  ScanNotInListError,
  type AccessibilityReportFetcher,
  type IssueSource,
} from "./report-fetcher.js";
import type { ErrorPage } from "./report-parser.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  createErrorResponse,
  createSuccessResponse,
  describeSource,
  initializeScanner,
  scanDashboardNote,
  sourceArgs,
} from "./shared.js";

/*
 * What fetchAccessibilityIssues and startAccessibilityScan say when a report has no full
 * result to give: a run that failed or was cancelled, a report still finalizing, a run
 * still going with no report yet (or stuck), a build id no API knows, and the pages a run
 * did not scan or that showed an error page.
 */

/**
 * Of PROCESSING_STATUSES, the processing after the run: a web report's advanced issues while
 * "finalizing", an app build's rules while "rule_processing". It usually ends within a few
 * minutes, but a first read no longer waits for it inside the call. It used to wait up to
 * five minutes and then read the export, and a client cuts off a call that long: the
 * claude.ai connector aborts a tool call silent for 305 s, progress notifications or not.
 * Every such call left the agent with nothing, and one reported a fix as verified that had
 * added 26 issues. So the read says the report is not ready, and to call again, which any
 * client handles.
 */
export const FINALIZING_STATUSES = new Set(["finalizing", "rule_processing"]);

/**
 * The answer for a first read of a report still finalizing: not ready yet, and when to come
 * back. Not an error, since nothing failed, but it says outright that no issues were read,
 * so an empty answer cannot be taken for a clean page.
 */
export function stillFinalizingResponse(
  source: IssueSource,
  status: string,
  preface: string[],
  extraArgs: string,
): CallToolResult {
  const state =
    status === "rule_processing"
      ? "is still running its accessibility rules (status: rule_processing)"
      : "is still finalizing (status: finalizing): BrowserStack is still adding its issues";
  return createSuccessResponse([
    ...preface,
    `⏳ The report for ${describeSource(source)} ${state}. This usually takes a few minutes after the run ends. No issues have been read yet, so this is not a result: do not tell the user the page is clean or the fix is verified.`,
    `Call fetchAccessibilityIssues again with ${sourceArgs(source)}${extraArgs} in a minute or two. If it still says this after about 10 minutes, tell the user the report is stuck instead of calling again.`,
  ]);
}

/**
 * A build id no API knows, after the scan list was searched for it (`scanList`) or the API
 * that reads runs by build id said it has none. The id is the user's to check, so this is a
 * plain answer naming what to pass instead, not a fault to report.
 */
export function buildIdNotFound(
  buildId: string,
  scanList?: ScanNotInListError,
): CallToolResult {
  // A hashed_id's shape was also asked of Automate and App Automate.
  const builds = /^[0-9a-f]{40}$/.test(buildId)
    ? "Automated Tests (web), App Accessibility, Automate, App Automate"
    : "Automated Tests (web), App Accessibility";
  const where = scanList
    ? `No ${builds.replace(/, (?=[^,]*$)/, " or ")} build has id "${buildId}", and no Website Scanner run ${scanList.capped ? `among the most recent scans (${scanList.pages} pages)` : "in the scan list"} has it as its build id.`
    : `No ${builds} or Website Scanner build with id "${buildId}" is visible to this account.`;
  return createSuccessResponse([
    `${where} Check the id, or pass instead the report's dashboard link as reportUrl, a Website Scanner run's scanId and scanRunId, or the id the BrowserStack SDK printed as "testhub id" at the end of the run.`,
  ]);
}

/** How long a run can stay "running" before it is taken for stuck rather than slow. */
const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * A run or build still processing whose report could not be exported: it has no report yet.
 * Not an error, since nothing failed; one that started over a day ago is probably stuck, and
 * calling again will not change that.
 */
export async function noReportYetResponse(
  reportFetcher: AccessibilityReportFetcher,
  source: IssueSource,
  status: string,
  preface: string[],
): Promise<CallToolResult> {
  const started = await reportFetcher.reportStartedAt(source);
  const stuck =
    started !== undefined && Date.now() - Date.parse(started) > STUCK_AFTER_MS;
  const again =
    source.kind === "scan" || source.kind === "scanBuild"
      ? "scan the page again"
      : source.kind === "workflow"
        ? "run Workflow Analyzer again"
        : "run the tests again";
  return createSuccessResponse([
    ...preface,
    `⏳ ${describeSource(source)} is still running (status: ${status}${started ? `, started ${started}` : ""}) and has no report yet, so no issues were read: this is not a result.`,
    stuck
      ? `It started more than 24 hours ago, so it is probably stuck rather than still running: tell the user, and that they should ${again} and read the new one, instead of calling fetchAccessibilityIssues again for this one.`
      : "Tell the user it is still running and to ask again in a few minutes, once it finishes; do not call fetchAccessibilityIssues again in this turn.",
  ]);
}

/**
 * Pages that did not load: an error page (Chrome's, or BrowserStack Local's when the tunnel
 * is not connected) was scanned in their place, and its issues came back as theirs. The
 * report parser leaves them out of the issues and the total; this says so.
 */
export function errorPagesNote(pages: ErrorPage[], again: string): string[] {
  if (pages.length === 0) return [];
  const one = (n: number, singular: string, plural: string) =>
    n === 1 ? singular : plural;
  const n = pages.length;
  const issues = pages.reduce((sum, p) => sum + p.issues, 0);
  const counted =
    issues > 0
      ? ` The ${one(issues, "1 issue", `${issues} issues`)} found there ${one(issues, "is", "are")} from the error ${one(n, "page", "pages")}, not your ${one(n, "page", "pages")}, so ${one(issues, "it is", "they are")} left out of the issues and the total below.`
      : "";
  return [
    `⚠️ ${one(n, "1 page", `${n} pages`)} did not load; ${one(n, "an error page was", "error pages were")} scanned in ${one(n, "its", "their")} place.${counted} Check the ${one(n, "page is", "pages are")} reachable (and the Local tunnel, for localhost), then ${again}. ${wrapUntrusted("report page addresses", JSON.stringify(pages.map((p) => p.url)))}`,
  ];
}

/**
 * Why a run that failed has nothing to read, or undefined where "failed" is not about the
 * report: an app build's status is its tests' result, and its scans are read either way.
 */
export async function failedRunResponse(
  source: IssueSource,
  status: "failed" | "cancelled",
  config: BrowserStackConfig,
  preface: string[],
): Promise<CallToolResult | undefined> {
  switch (source.kind) {
    case "scan":
      return failedScanRunResponse(
        config,
        source.scanId,
        source.scanRunId,
        preface,
        (pages) =>
          `0 issues does not mean the ${pages > 1 ? "pages are" : "page is"} clean.`,
        status === "cancelled"
          ? "Scan again and read the new run."
          : "Fix the cause and scan again.",
        status,
      );
    // The API reads a build that completed with no test cases as failed.
    case "build":
      return createErrorResponse(
        [
          ...preface,
          `Build ${source.buildId} has no accessibility results (status: failed). This usually means no test ran through the BrowserStack SDK: a plain script instead of a test framework, or a session that failed to start. Run the tests again through the SDK and read the new build's testhub id.`,
        ].join("\n"),
      );
    // A report fails only when BrowserStack stops processing it.
    case "workflow":
      return createErrorResponse(
        [
          ...preface,
          `Workflow Analyzer report ${source.reportId} has no accessibility results (status: failed): its processing did not complete, so 0 issues would not mean the pages are clean. Scan the workflow again with Workflow Analyzer and read the new report.`,
        ].join("\n"),
      );
    default:
      return undefined;
  }
}

/** How many failed pages a failure result lists before summing up the rest. */
const FAILED_PAGES_LISTED = 10;

/**
 * "N pages <what>:" and a line per page with its reason, the first FAILED_PAGES_LISTED of
 * them. The lines are the scan logs' (the page's address, the site's HTTP status, where it
 * redirected), so they are quoted as data.
 */
export function pageReasons(
  pages: ScanFailureDetails["pages"],
  what: [one: string, several: string],
): string {
  const listed = pages.slice(0, FAILED_PAGES_LISTED);
  const more = pages.length - listed.length;
  return [
    `${pages.length} ${pages.length === 1 ? `page ${what[0]}` : `pages ${what[1]}`}:`,
    wrapUntrusted(
      "page scan log",
      listed.map((page) => `- ${page.pageUrl}: ${page.reason}`).join("\n"),
    ),
    ...(more > 0 ? [`And ${more} more ${more === 1 ? "page" : "pages"}.`] : []),
  ].join("\n");
}

/** Why a run failed, in the API's words (quoted as data): the run's own reason and each page's. */
export function failureReasons({
  reason,
  pages,
}: ScanFailureDetails): string[] {
  const why = [
    reason ? `Why: ${wrapUntrusted("scan failure reason", reason)}` : "",
    pages.length
      ? pageReasons(pages, ["could not be scanned", "could not be scanned"])
      : "",
  ].filter(Boolean);
  return why.length ? why : ["The dashboard says why."];
}

/**
 * A scan run that failed, read or compared. A run fails only when it scanned no page (or
 * the plan refused it), and its export is then an empty report: read as one, it said "0
 * issues ✅ All issues retrieved", and compared, every issue of the other run read as
 * resolved or new.
 */
export async function failedScanRunResponse(
  config: BrowserStackConfig,
  scanId: string,
  scanRunId: string,
  preface: string[],
  meaning: (pages: number) => string,
  next: string,
  status: "failed" | "cancelled" = "failed",
): Promise<CallToolResult> {
  const scanner = await initializeScanner(config);
  const cancelled = status === "cancelled";
  // A cancelled run has no failure to explain.
  const [dashboardLink, details] = await Promise.all([
    scanner.dashboardLink(scanId),
    cancelled
      ? Promise.resolve<ScanFailureDetails>({ pages: [] })
      : scanner.failureDetails(scanId, scanRunId),
  ]);
  return createErrorResponse(
    [
      ...preface,
      cancelled
        ? `Scan run ${scanRunId} of scan ${scanId} was cancelled, so it has no results: ${meaning(details.pages.length)}`
        : `Scan run ${scanRunId} of scan ${scanId} failed, so no pages were checked: ${meaning(details.pages.length)}`,
      ...(cancelled ? [] : failureReasons(details)),
      next,
      scanDashboardNote(dashboardLink, scanId),
    ].join("\n"),
  );
}
