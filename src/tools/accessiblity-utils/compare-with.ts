import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  AccessibilityReportFetcher,
  IssueSource,
} from "./report-fetcher.js";
import { asSentence } from "./error-messages.js";
import { createSuccessResponse, describeSource, sourceArgs } from "./shared.js";

/*
 * What fetchAccessibilityIssues's compareWith names: the Website Scanner run it resolves to,
 * the report before a Workflow Analyzer or manual app report ("previous"), or the answer
 * when there is nothing to compare yet or no built-in compare for the two reports.
 */

/** What a report compareWith has no compare for says first. */
export const NO_BUILT_IN_COMPARE = {
  workflow: "Workflow Analyzer reports have no built-in compare.",
  appReport: "App Accessibility manual reports have no built-in compare.",
} as const;

/**
 * Two reports compareWith has no compare for are compared by reading both. This is said as
 * guidance, not as an error, so the agent goes straight to the two reads. An app issue is
 * matched by its element, not its screen, as a fix can renumber the screens.
 */
export function readBothToCompare(
  lead: string,
  app: boolean,
  reads?: [string, string],
): CallToolResult {
  const match = app
    ? "rule and component (the element's id or class)"
    : "rule and CSS selector on each page";
  const calls = reads
    ? ` (one call with ${reads[0]}; the other with ${reads[1]})`
    : "";
  return createSuccessResponse([
    `${lead} Read both reports with fetchAccessibilityIssues${calls} and match issues by ${match}; an issue in the later report only is new, in the earlier only is fixed, in both is still open.`,
  ]);
}

/**
 * The answer when a run or build to compare is still processing: its issues are still being
 * added, so a comparison would count the ones not added yet as resolved or new, and read as
 * a clean result. Calling again at once gets the same answer, so it hands back to the user.
 */
export function notReadyToCompare(
  which: string,
  status: string,
  preface: string[] = [],
): CallToolResult {
  return createSuccessResponse([
    ...preface,
    `⏳ ${which} has not finished yet (status: ${status}), so nothing was compared: its issues are still being added, and a comparison now would count the ones not added yet as resolved or new. Tell the user it is still processing and to ask again in a few minutes; do not call fetchAccessibilityIssues again in this turn.`,
  ]);
}

/**
 * compareWith "previous" on a report with no built-in compare: the report before it is found
 * here (a Workflow Analyzer report's of the same page, or else the same site; a manual app
 * report's of the same app) and named with the call that reads it. Agents left to find it
 * searched for a way to list reports, and one gave no answer.
 */
export async function previousReportToCompare(
  reportFetcher: AccessibilityReportFetcher,
  source: { kind: "workflow" | "appReport"; reportId: string },
): Promise<CallToolResult> {
  const app = source.kind === "appReport";
  const earlier:
    | { reportId: string; time?: string; link: string; samePage?: boolean }
    | undefined = await (
    app
      ? reportFetcher.previousManualReport(source.reportId)
      : reportFetcher.previousWorkflowReport(source.reportId)
  ).catch(() => undefined);
  const lead = NO_BUILT_IN_COMPARE[source.kind];
  if (!earlier) {
    return readBothToCompare(
      `${lead} No earlier ${app ? "manual report of the same app" : "Workflow Analyzer report of the same page or site"} is among the account's newest reports, so ask the user which report to compare it with.`,
      app,
    );
  }
  const which = app
    ? "manual report of the same app"
    : earlier.samePage
      ? "report of the same page"
      : "report of the same site (no earlier one scanned the same page)";
  return readBothToCompare(
    `${lead} The newest ${which} before it is ${earlier.reportId}${earlier.time ? `, ${app ? "recorded" : "started"} ${earlier.time}` : ""}: ${earlier.link}`,
    app,
    [
      sourceArgs(source),
      sourceArgs({ kind: source.kind, reportId: earlier.reportId }),
    ],
  );
}

type ScanRunSource = { kind: "scan"; scanId: string; scanRunId: string };

/**
 * The run of this scan that compareWith names: its scanRunId, or its report link or build id,
 * which are resolved as a source is. A link or id that names anything else (another scan's
 * run, a build, a report) has no built-in compare with a Scanner run: that is answered with
 * how to compare them by reading both, naming each read's arguments.
 */
export async function scanRunToCompare(
  reportFetcher: AccessibilityReportFetcher,
  source: ScanRunSource,
  compareWith: string,
): Promise<{ scanRunId: string } | CallToolResult> {
  const link = /^https?:\/\//i.test(compareWith);
  if (!link && !/^[a-z0-9]{40}$/i.test(compareWith)) {
    return { scanRunId: compareWith };
  }
  let other: IssueSource;
  try {
    other = await reportFetcher.resolveBuild(
      link
        ? await reportFetcher.sourceFromReportUrl(compareWith)
        : { kind: "build", buildId: compareWith },
      { orScanRun: true },
    );
    // A run is compared by its scan's ids, which only the scan list maps a build id to.
    if (other.kind === "scanBuild") {
      other = await reportFetcher.findScanRun(other);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return createSuccessResponse([
      `compareWith could not be matched to a Website Scanner run: ${asSentence(reason)} To compare with another run of scan ${source.scanId}, pass its scanRunId or "previous". To compare with another scan's run, read both reports with fetchAccessibilityIssues and match issues by rule and CSS selector on each page; an issue in the later report only is new, in the earlier only is fixed, in both is still open.`,
    ]);
  }
  if (other.kind === "scan" && other.scanId === source.scanId) {
    return { scanRunId: other.scanRunId };
  }
  return readBothToCompare(
    `compareWith names ${describeSource(other)}, not a run of scan ${source.scanId}: only runs of one scan are compared here.`,
    false,
    [sourceArgs(source), sourceArgs(other)],
  );
}
