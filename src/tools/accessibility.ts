import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AccessibilityScanner } from "./accessiblity-utils/scanner.js";
import {
  AccessibilityReportFetcher,
  EXPORT_WAIT_MS,
  ExportPendingError,
  type IssueSource,
} from "./accessiblity-utils/report-fetcher.js";
import {
  compareAppIssues,
  type AppAccessibilityIssue,
  type AppBuildReport,
  type AppIssueSummary,
  type AppManualReport,
} from "./accessiblity-utils/app-report-fetcher.js";
import {
  AccessibilityAuthConfig,
  safeAuthConfigData,
} from "./accessiblity-utils/auth-config.js";
import { trackMCP } from "../lib/instrumentation.js";
import {
  compareIssues,
  loadMainIssues,
  parseAccessibilityReportFromCSV,
} from "./accessiblity-utils/report-parser.js";
import { wrapUntrusted } from "../lib/untrusted-content.js";
import { getBrowserStackAuth } from "../lib/get-auth.js";
import { BrowserStackConfig } from "../lib/types.js";
import { elicitCredentialsIfSupported } from "../lib/elicit-credentials.js";
import logger from "../logger.js";
import { NEEDS_A11Y_CONFIG_ID, NEEDS_A11Y_SCAN_ID } from "./tool-handoff.js";

interface AuthCredentials {
  username: string;
  password: string;
}

interface ScanProgressContext {
  sendNotification: (notification: any) => Promise<void>;
  _meta?: {
    progressToken?: string | number;
  };
}

interface FormAuthArgs {
  name: string;
  type: "form";
  url: string;
  username: string;
  password: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
}

interface BasicAuthArgs {
  name: string;
  type: "basic";
  url: string;
  username: string;
  password: string;
}

type AuthConfigArgs = FormAuthArgs | BasicAuthArgs;

function setupAuth(config: BrowserStackConfig): AuthCredentials {
  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");
  return { username, password };
}

function createErrorResponse(message: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    isError: true,
  };
}

/**
 * Each message ends with a newline: clients that join text blocks with no separator
 * would otherwise run a link at the end of one block into the next block's first word.
 */
function createSuccessResponse(messages: string[]): CallToolResult {
  return {
    content: messages.map((text) => ({
      type: "text" as const,
      text: `${text}\n`,
    })),
  };
}

function handleMCPError(
  toolName: string,
  server: McpServer,
  config: BrowserStackConfig,
  error: unknown,
): CallToolResult {
  trackMCP(toolName, server.server.getClientVersion()!, error, config);
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  return createErrorResponse(
    `Failed to ${toolName.replace(/([A-Z])/g, " $1").toLowerCase()}: ${errorMessage}. Please open an issue on GitHub if the problem persists`,
  );
}

async function notifyScanProgress(
  context: ScanProgressContext,
  message: string,
  progress = 0,
): Promise<void> {
  await context.sendNotification({
    method: "notifications/progress",
    params: {
      progressToken: context._meta?.progressToken?.toString() ?? "NOT_FOUND",
      message,
      progress,
      total: 100,
    },
  });
}

async function initializeScanner(
  config: BrowserStackConfig,
): Promise<AccessibilityScanner> {
  const scanner = new AccessibilityScanner();
  const auth = setupAuth(config);
  scanner.setAuth(auth);
  return scanner;
}

async function initializeReportFetcher(
  config: BrowserStackConfig,
): Promise<AccessibilityReportFetcher> {
  const reportFetcher = new AccessibilityReportFetcher();
  const auth = setupAuth(config);
  reportFetcher.setAuth(auth);
  return reportFetcher;
}

interface FetchIssuesArgs {
  scanId?: string;
  scanRunId?: string;
  buildId?: string;
  workflowReportId?: string;
  appReportId?: string;
  reportUrl?: string;
  cursor?: number;
  pageUrl?: string;
  compareWith?: string;
  exportTaskId?: string;
}

/** A source named by its ids, or a dashboard link still to be resolved to them. */
type RequestedSource = IssueSource | { kind: "link"; reportUrl: string };

/** The one source the arguments name, or why they do not name exactly one. */
function issueSourceFrom(args: FetchIssuesArgs): RequestedSource | string {
  const named = [
    Boolean(args.scanId || args.scanRunId),
    Boolean(args.buildId),
    Boolean(args.workflowReportId),
    Boolean(args.appReportId),
    Boolean(args.reportUrl),
  ].filter(Boolean).length;
  if (named !== 1) {
    return "Pass exactly one source: scanId with scanRunId (a Website Scanner run), buildId (an Automated Tests or App Accessibility build), workflowReportId (a Workflow Analyzer report), appReportId (an App Accessibility manual report) or reportUrl (a report's dashboard link).";
  }
  if (args.reportUrl) return { kind: "link", reportUrl: args.reportUrl };
  if (args.buildId) return { kind: "build", buildId: args.buildId };
  if (args.workflowReportId) {
    return { kind: "workflow", reportId: args.workflowReportId };
  }
  if (args.appReportId) {
    return { kind: "appReport", reportId: args.appReportId };
  }
  if (!args.scanId || !args.scanRunId) {
    return "A Website Scanner run needs both scanId and scanRunId.";
  }
  return { kind: "scan", scanId: args.scanId, scanRunId: args.scanRunId };
}

/** The arguments that name the same source again, for the next-page hint. */
function sourceArgs(source: IssueSource): string {
  switch (source.kind) {
    case "scan":
      return `scanId: "${source.scanId}", scanRunId: "${source.scanRunId}"`;
    case "build":
    case "appBuild":
      return `buildId: "${source.buildId}"`;
    case "workflow":
      return `workflowReportId: "${source.reportId}"`;
    case "appReport":
      return `appReportId: "${source.reportId}"`;
  }
}

/** What a dashboard link resolved to, in words. */
function describeSource(source: IssueSource): string {
  switch (source.kind) {
    case "scan":
      return `Website Scanner scan ${source.scanId}, run ${source.scanRunId}`;
    case "build":
      return `Automated Tests build ${source.buildId}`;
    case "workflow":
      return `Workflow Analyzer report ${source.reportId}`;
    case "appBuild":
      return `App Accessibility build ${source.buildId}`;
    case "appReport":
      return `App Accessibility manual report ${source.reportId}`;
  }
}

async function executeFetchAccessibilityIssues(
  args: FetchIssuesArgs,
  context: ScanProgressContext | undefined,
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "fetchAccessibilityIssues",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    const source = issueSourceFrom(args);
    if (typeof source === "string") return createErrorResponse(source);
    return await fetchAccessibilityIssues(
      source,
      config,
      args.cursor,
      context,
      {
        compareWith: args.compareWith,
        pageUrl: args.pageUrl,
        exportTaskId: args.exportTaskId,
      },
    );
  } catch (error) {
    return handleMCPError("fetchAccessibilityIssues", server, config, error);
  }
}

/**
 * What the total leaves out, as the dashboard's count does: duplicate occurrences (folded
 * into their main issue only where one could be matched) and issues hidden in the dashboard.
 */
function excludedIssuesNote(
  duplicates: number | null,
  unlinked: number,
  hidden: number | null,
): string[] {
  const notes: string[] = [];
  if (duplicates) {
    const folded = duplicates - unlinked;
    const how =
      unlinked === 0
        ? " are folded into their main issue (see duplicate_count) and are not included in the total."
        : folded > 0
          ? ` are not included in the total. ${folded} are folded into their main issue (see duplicate_count); ${unlinked} could not be matched to one.`
          : " are not included in the total.";
    notes.push(
      `This report groups repeated occurrences: ${duplicates} duplicate occurrences${how}`,
    );
  }
  if (hidden) {
    notes.push(
      `${hidden} issues hidden in the dashboard are not included, as the dashboard leaves them out of its count too.`,
    );
  }
  return notes;
}

/** How often, and for how long, a first read waits on a report that is still processing. */
export const REPORT_STATUS_POLL_MS = 10_000;
export const REPORT_STATUS_WAIT_MS = 5 * 60 * 1000;

/** Statuses during which a report's issues are still being added (`rule_processing`: an app build's). */
const PROCESSING_STATUSES = new Set([
  "queued",
  "running",
  "processing",
  "finalizing",
  "rule_processing",
  "in_progress",
]);

/**
 * Of those, the ones worth waiting on: the processing after the run (a web scan's advanced
 * issues, an app build's rules), which ends within minutes. A report whose scan or tests are still running is read as it is,
 * with a note, since that can last as long as the suite does.
 */
const WAIT_STATUSES = new Set(["finalizing", "rule_processing"]);

interface ProcessingState {
  /** The status when the issues were read; undefined when it could not be read. */
  status?: string;
  /** The status first seen, before any waiting. */
  firstStatus?: string;
  waitedMs: number;
}

/**
 * Where a report is in its processing before its issues are read. Issues keep being added
 * until it completes; an advanced scan adds its advanced-rule issues while "finalizing", for
 * minutes after the tests end, so a first read waits for that, reporting progress, for up to
 * REPORT_STATUS_WAIT_MS. A run still in progress is not waited on (it can take as long as
 * the suite), nor is a later page, nor a status that cannot be read.
 */
async function waitForProcessing(
  reportFetcher: AccessibilityReportFetcher,
  source: IssueSource,
  wait: boolean,
  context: ScanProgressContext | undefined,
): Promise<ProcessingState> {
  const started = Date.now();
  const firstStatus = await reportFetcher.reportStatus(source);
  let status = firstStatus;
  while (
    wait &&
    status &&
    WAIT_STATUSES.has(status) &&
    Date.now() - started < REPORT_STATUS_WAIT_MS
  ) {
    const waited = Date.now() - started;
    if (context) {
      await notifyScanProgress(
        context,
        `The report is still ${status}; waiting for it to complete (${formatDuration(waited)} of up to ${formatDuration(REPORT_STATUS_WAIT_MS)}).`,
        Math.min(99, Math.round((waited / REPORT_STATUS_WAIT_MS) * 100)),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, REPORT_STATUS_POLL_MS));
    status = await reportFetcher.reportStatus(source);
  }
  return { status, firstStatus, waitedMs: Date.now() - started };
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** What the answer says about the report's processing, if anything. */
function processingNote({
  status,
  firstStatus,
  waitedMs,
}: ProcessingState): string[] {
  if (status && PROCESSING_STATUSES.has(status)) {
    const meaning =
      status === "finalizing"
        ? ", which on an advanced scan means advanced issue processing"
        : "";
    return [
      `⚠️ This report is still processing (status: ${status}${meaning}). The issues below are only those found so far: more will be added and the total will grow. Call fetchAccessibilityIssues again in a few minutes for the complete list.`,
    ];
  }
  if (firstStatus && PROCESSING_STATUSES.has(firstStatus)) {
    return [
      `The report was still processing (status: ${firstStatus}); waited ${formatDuration(waitedMs)} for it to complete before reading its issues.`,
    ];
  }
  return [];
}

/** Progress while a report's CSV export is generated, so clients see the call is alive. */
function exportProgress(
  context: ScanProgressContext | undefined,
): (waitedMs: number) => Promise<void> {
  return async (waitedMs) => {
    if (!context) return;
    await notifyScanProgress(
      context,
      `Generating the report's CSV export (large reports take longer): ${formatDuration(waitedMs)} so far.`,
      Math.min(99, Math.round((waitedMs / EXPORT_WAIT_MS) * 100)),
    );
  };
}

/** What to say of an export still being generated: how to continue it, not an error. */
function exportPendingMessages(
  source: IssueSource,
  error: ExportPendingError,
  extraArgs: string,
): string[] {
  return [
    `This report's CSV export is still being generated (waited ${formatDuration(error.waitedMs)}; large reports can take a few minutes). No issues have been read yet.`,
    `Call fetchAccessibilityIssues again with ${sourceArgs(source)}${extraArgs} and exportTaskId: "${error.taskId}" to continue this export instead of starting a new one.`,
  ];
}

/** The last line: how to get the next page, or that there is none. */
function closingMessage(
  next_page: number | null,
  remaining: number,
  source: IssueSource,
  stillProcessing: boolean,
  extraArgs = "",
): string {
  if (next_page !== null) {
    return `${remaining} more issues available. Use fetchAccessibilityIssues with ${sourceArgs(source)}${extraArgs} and cursor: ${next_page} to get the next batch.`;
  }
  if (stillProcessing) {
    return `All issues found so far retrieved; the report is still processing.`;
  }
  return `✅ All issues retrieved.`;
}

/**
 * An app build's name and dashboard link, as data: the name is the user's own (from their
 * CI or browserstack.yml), so it is quoted in an untrusted block rather than in our prose.
 */
function appBuildDetails(report: AppBuildReport): string {
  return `Build: ${wrapUntrusted(
    "App Accessibility build",
    JSON.stringify(
      {
        name: report.build_name,
        ...(report.dashboard_link
          ? { dashboard_link: report.dashboard_link }
          : {}),
      },
      null,
      2,
    ),
  )}`;
}

/**
 * Why a finished app build has no scans. Each cause here produced a run that finished
 * green with nothing scanned and no warning; they are listed most likely first, with what
 * the build's own details say ahead of the rest.
 */
/**
 * Why a native (Espresso, XCUITest) build recorded no scans. The build request's flag only
 * turns the checks on: the suite itself must carry BrowserStack's instrumentation.
 */
const NATIVE_NO_SCAN_CAUSES: Record<"espresso" | "xcuitest", string[]> = {
  espresso: [
    "The test suite was not built with BrowserStack's Gradle plugin and SDK: add classpath 'com.browserstack:gradle-tool:latest.release' to the root build.gradle, id 'com.browserstack.gradle-tool' to the app's plugins, and androidTestImplementation 'com.browserstack:browserstack-java-sdk:latest.release' (1.31.0 or newer), then rebuild the test APK.",
    "Test Observability was off for the build: Espresso's App Accessibility report needs `testObservability: true` in the build request alongside `accessibility: true` (runAppTestsOnBrowserStack sends both).",
    "The app cannot reach BrowserStack from the device: it needs internet permission, and cleartext traffic allowed (usesCleartextTraffic) if the network calls for it.",
    "No tests ran: check the build's sessions and test results on App Automate.",
  ],
  xcuitest: [
    "The UI test target does not embed and initialize the BrowserStack Swift SDK: add BrowserstackSwiftSDK.xcframework (or the Swift package) to the test target, and set NSPrincipalClass to BrowserstackSwiftSDK.BrowserstackSwiftSDK in its Info.plist or call BrowserstackSwiftSDK.init() in the test class's init().",
    "The device runs iOS older than 14, or the suite was built with Swift older than 5.4.",
    "No tests ran: check the build's sessions and test results on App Automate.",
  ],
};

/** Which native framework ran a build, when its details name one. */
function nativeFramework(
  framework: string | undefined,
): "espresso" | "xcuitest" | undefined {
  if (!framework) return undefined;
  if (/espresso/i.test(framework)) return "espresso";
  if (/xcui|xctest/i.test(framework)) return "xcuitest";
  return undefined;
}

function noScansNote(report: AppBuildReport): string[] {
  const native = nativeFramework(report.framework);
  if (native) {
    const causes = [
      ...(report.fup_capped
        ? [
            "This build hit the fair-usage cap (fup in the build details), which drops tests or scans.",
          ]
        : []),
      ...NATIVE_NO_SCAN_CAUSES[native],
    ];
    return [
      `No accessibility scans were recorded for the ${native === "espresso" ? "Espresso" : "XCUITest"} build below (status: ${report.status}), so there are no issues to list.`,
      appBuildDetails(report),
      "The usual causes for a native build, most likely first:",
      ...causes.map((cause, i) => `${i + 1}. ${cause}`),
    ];
  }
  const causes = [
    ...(report.fup_capped
      ? [
          "This build hit the fair-usage cap (fup in the build details), which drops tests or scans.",
        ]
      : []),
    ...(report.status === "timeout"
      ? [
          'The session timed out during initialization (status "timeout"): check the script and the config.',
        ]
      : []),
    "`accessibility: true` is not set in browserstack.yml (or the capabilities); the SDK defaults it to false.",
    'The platform entry in browserstack.yml does not use `osVersion`, unquoted: with `platformVersion` the SDK selects the device but App Accessibility records no scans, and a quoted "14.0" fails its number check and turns the checks off; neither says so. Write `osVersion: 14.0`.',
    'The device runs an OS App Accessibility does not support: Android 11 or newer, or iOS 14 or newer, is needed (an older Android reads "update_os_version").',
    "The driver was created inside the test body: the SDK decides per test, at its start, from the drivers that already exist. Create it in a fixture or setup hook.",
    "The test only read the screen (find_elements, page_source): scans run on interaction commands such as click/tap, send keys, actions and navigation. Interact with each screen you want scanned.",
    ...(report.status === "timeout"
      ? []
      : [
          'The session timed out during initialization (status "timeout"): check the script and the config.',
        ]),
  ];
  return [
    `No accessibility scans were recorded for the App Accessibility build below (status: ${report.status}), so there are no issues to list.`,
    appBuildDetails(report),
    "The usual causes, most likely first:",
    ...causes.map((cause, i) => `${i + 1}. ${cause}`),
  ];
}

const SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"];
/** How many screens the summary names; the rest are counted. */
const SUMMARY_SCREENS = 10;

/** An app report's issues at a glance: by severity, by rule, and by screen. */
function summaryNote(summary: AppIssueSummary, total: number): string[] {
  if (total === 0) return [];
  const rank = (severity: string) => {
    const i = SEVERITY_ORDER.indexOf(severity);
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  const severities = Object.entries(summary.by_severity)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([severity, n]) => `${n} ${severity}`)
    .join(", ");
  const rules = summary.by_rule
    .map((r) => `${r.issue_type} ${r.count}`)
    .join(", ");
  const shown = summary.by_screen.slice(0, SUMMARY_SCREENS);
  const more = summary.by_screen.length - shown.length;
  const screens = `${shown.map((s) => `${s.screen} ${s.count}`).join(", ")}${
    more > 0 ? `, and ${more} more screens` : ""
  }`;
  return [
    `Summary of the ${total} issues: ${severities}.`,
    wrapUntrusted(
      "accessibility issue counts",
      `By rule: ${rules}.\nBy screen: ${screens}.`,
    ),
  ];
}

/** How many new and resolved issues a comparison lists per page. */
const COMPARE_LIST_MAX = 50;

/** An issue as a comparison lists it: what and where, without the fix text. */
function compareRow(row: AppAccessibilityIssue) {
  const { issue_type, rule_id, severity, screen, component, element } = row;
  return { issue_type, rule_id, severity, screen, component, element };
}

/** One page of a comparison's list: the cursor counts the issues already listed. */
function issueList(
  label: string,
  rows: AppAccessibilityIssue[],
  cursor: number,
): string {
  if (cursor > 0 && cursor >= rows.length) {
    return `${label} (${rows.length}): all listed on earlier pages.`;
  }
  const shown = rows.slice(cursor, cursor + COMPARE_LIST_MAX).map(compareRow);
  const range =
    rows.length > COMPARE_LIST_MAX
      ? `, ${cursor + 1} to ${cursor + shown.length}`
      : "";
  return `${label} (${rows.length})${range}: ${wrapUntrusted("accessibility scan results", JSON.stringify(shown, null, 2))}`;
}

/** The build to compare with, or why there is none. */
async function baselineAppBuild(
  reportFetcher: AccessibilityReportFetcher,
  buildId: string,
  compareWith: string,
): Promise<
  { buildId: string; sameName?: boolean; searchedAll?: boolean } | string
> {
  let baseline: { buildId: string; sameName?: boolean; searchedAll?: boolean };
  if (compareWith === "previous") {
    const previous = await reportFetcher.previousAppBuild(buildId);
    if (!previous) {
      return "This is its project's first build, so there is nothing earlier to compare it with. Pass an earlier build's id or link as compareWith instead.";
    }
    baseline = {
      buildId: previous.buildId,
      sameName: previous.same_name,
      searchedAll: previous.searched_all,
    };
  } else {
    const named: IssueSource = /^https?:\/\//i.test(compareWith)
      ? await reportFetcher.sourceFromReportUrl(compareWith)
      : { kind: "build", buildId: compareWith };
    const source = await reportFetcher.resolveBuild(named);
    if (source.kind !== "appBuild") {
      return `compareWith names ${describeSource(source)}, which is not an App Accessibility build. Pass an earlier app build's id or link, or "previous".`;
    }
    baseline = { buildId: source.buildId };
  }
  if (baseline.buildId === buildId) {
    return `compareWith names this build itself. Pass an earlier build's id or link, or "previous".`;
  }
  return baseline;
}

/**
 * What changed between an earlier app build and this one: issues new in this build,
 * issues the earlier one had that this one does not, and how many it kept. An issue on a
 * screen this build did not reach also reads as resolved, so a build that scanned other
 * screens or ran other tests is called out.
 */
async function compareAppBuilds(
  reportFetcher: AccessibilityReportFetcher,
  source: { kind: "appBuild"; buildId: string },
  compareWith: string,
  cursor: number,
  preface: string[],
  processing: ProcessingState,
): Promise<CallToolResult> {
  const baseline = await baselineAppBuild(
    reportFetcher,
    source.buildId,
    compareWith,
  );
  if (typeof baseline === "string") return createErrorResponse(baseline);
  const [named, current] = await Promise.all([
    reportFetcher.appBuildIssues(baseline.buildId),
    reportFetcher.appBuildIssues(source.buildId),
  ]);
  // A comparison runs from the earlier build to the later; named the other way round, the
  // new issues would read as resolved and the resolved as new.
  const reversed =
    named.created_at !== undefined &&
    current.created_at !== undefined &&
    Date.parse(named.created_at) > Date.parse(current.created_at);
  const [before, after] = reversed ? [current, named] : [named, current];
  const { added, resolved, retained } = compareAppIssues(
    before.issues,
    after.issues,
  );
  const which =
    baseline.sameName === undefined
      ? ""
      : baseline.sameName
        ? ", the build before it"
        : baseline.searchedAll
          ? ", the build just before it in its project (no earlier build has this build's name)"
          : ", the build just before it in its project (none of the newest builds before it has this build's name)";
  const warnings: string[] = [];
  if (before.scan_count !== after.scan_count) {
    warnings.push(
      `⚠️ The builds scanned a different number of screens (${after.scan_count} in the later build, ${before.scan_count} in the earlier one): an issue on a screen the later build did not reach reads as resolved without having been fixed. Check the resolved issues' screens before calling them fixed.`,
    );
  }
  const notRun = before.tests.filter((t) => !after.tests.includes(t));
  if (notRun.length > 0) {
    warnings.push(
      `⚠️ Some tests had screens scanned in the earlier build but not in the later one; their issues read as resolved without having been checked again. ${wrapUntrusted("test names", JSON.stringify(notRun))}`,
    );
  }
  // Build names are the user's own (from their CI or browserstack.yml), so they are data.
  const builds = wrapUntrusted(
    "App Accessibility builds",
    JSON.stringify(
      {
        later: { build_number: after.build_number, name: after.build_name },
        earlier: { build_number: before.build_number, name: before.build_name },
      },
      null,
      2,
    ),
  );
  return createSuccessResponse([
    ...preface,
    ...processingNote(processing),
    ...(reversed
      ? [
          "compareWith names a build newer than this one, so the comparison runs from this build (the earlier) to that one (the later).",
        ]
      : []),
    `Compared App Accessibility build #${after.build_number} with build #${before.build_number}${which}: ${added.length} new, ${resolved.length} resolved, ${retained} still open.`,
    `Builds: ${builds}`,
    `Issues are matched one for one by rule and element: its id, or else its class and its text or label. New and still-open issues add up to the later build's ${after.issues.length}; resolved and still-open ones to the earlier build's ${before.issues.length}.`,
    ...warnings,
    issueList("New issues", added, cursor),
    issueList("Resolved issues", resolved, cursor),
    Math.max(added.length, resolved.length) > cursor + COMPARE_LIST_MAX
      ? `More to list: call fetchAccessibilityIssues with buildId: "${source.buildId}", compareWith: "${compareWith}" and cursor: ${cursor + COMPARE_LIST_MAX}.`
      : `Read the later build's open issues with fetchAccessibilityIssues with buildId: "${after.buildId}".`,
  ]);
}

/** An app build's issues come inline from its scanned screens; there is no CSV to link. */
async function appBuildMessages(
  reportFetcher: AccessibilityReportFetcher,
  source: { kind: "appBuild"; buildId: string },
  cursor: number,
  preface: string[],
  processing: ProcessingState,
  stillProcessing: boolean,
): Promise<string[]> {
  const report = await reportFetcher.appBuildReport(source.buildId, cursor);
  if (report.scan_count === 0 && !stillProcessing) {
    return [...preface, ...processingNote(processing), ...noScansNote(report)];
  }
  const { records, page_length, total_issues, next_page } = report;
  const screens = `${report.scan_count} screen${report.scan_count === 1 ? "" : "s"} scanned`;
  return [
    ...preface,
    ...processingNote(processing),
    `Retrieved ${page_length} accessibility issues (Total: ${total_issues}) from the App Accessibility build below (${screens})`,
    appBuildDetails(report),
    ...(cursor === 0 ? summaryNote(report.summary, total_issues) : []),
    ...excludedIssuesNote(null, 0, report.hidden_issues),
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify(records, null, 2))}`,
    closingMessage(next_page, report.remaining, source, stillProcessing),
  ];
}

/**
 * A manual report's issues come inline from its scanned screens. The API lists every
 * occurrence and does not mark the duplicates the dashboard folds, so the dashboard's
 * own count is stated next to the total rather than reproduced.
 */
async function appReportMessages(
  reportFetcher: AccessibilityReportFetcher,
  source: { kind: "appReport"; reportId: string },
  cursor: number,
  preface: string[],
  processing: ProcessingState,
  stillProcessing: boolean,
): Promise<string[]> {
  const report: AppManualReport = await reportFetcher.appReportIssues(
    source.reportId,
    cursor,
  );
  // The report's name is whatever its author typed, so it is quoted as data.
  const details = `Report: ${wrapUntrusted(
    "App Accessibility manual report",
    JSON.stringify(
      { name: report.report_name, dashboard_link: report.dashboard_link },
      null,
      2,
    ),
  )}`;
  if (report.scan_count === 0 && !stillProcessing) {
    return [
      ...preface,
      ...processingNote(processing),
      `No screens were scanned in the App Accessibility manual report below (status: ${report.status}), so there are no issues to list.`,
      details,
    ];
  }
  const { records, page_length, total_issues, next_page } = report;
  const where = `${report.scan_count} screen${report.scan_count === 1 ? "" : "s"} scanned${
    report.device ? ` on ${report.device}` : ""
  }`;
  const dashboardNote =
    report.duplicate_occurrences > 0
      ? [
          `The dashboard counts ${report.dashboard_count} issues for this report: ${report.duplicate_occurrences} of the occurrences are duplicates it folds, which the API does not mark.`,
        ]
      : [];
  return [
    ...preface,
    ...processingNote(processing),
    `Retrieved ${page_length} accessibility issue occurrences (Total: ${total_issues}) from the App Accessibility manual report below (${where})`,
    details,
    ...(cursor === 0 ? summaryNote(report.summary, total_issues) : []),
    ...dashboardNote,
    ...excludedIssuesNote(null, 0, report.hidden_issues),
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify(records, null, 2))}`,
    closingMessage(next_page, report.remaining, source, stillProcessing),
  ];
}

async function fetchAccessibilityIssues(
  requested: RequestedSource,
  config: BrowserStackConfig,
  cursor = 0,
  context?: ScanProgressContext,
  {
    compareWith,
    pageUrl,
    exportTaskId,
  }: { compareWith?: string; pageUrl?: string; exportTaskId?: string } = {},
): Promise<CallToolResult> {
  const reportFetcher = await initializeReportFetcher(config);
  const named =
    requested.kind === "link"
      ? await reportFetcher.sourceFromReportUrl(requested.reportUrl)
      : requested;
  // A build id names a web build or a mobile app build; the APIs tell which.
  const source = await reportFetcher.resolveBuild(named);
  // Website Scanner runs and App Accessibility builds can be compared, each in its own way.
  if (compareWith !== undefined && source.kind === "scan") {
    return compareScanRuns(
      requested.kind === "link" ? requested : source,
      compareWith,
      config,
      context,
    );
  }
  if (compareWith !== undefined && source.kind !== "appBuild") {
    return createErrorResponse(
      `compareWith compares Website Scanner runs and App Accessibility builds; ${describeSource(source)} is neither.`,
    );
  }
  const processing = await waitForProcessing(
    reportFetcher,
    source,
    cursor === 0,
    context,
  );
  const stillProcessing =
    processing.status !== undefined &&
    PROCESSING_STATUSES.has(processing.status);
  const preface =
    requested.kind === "link"
      ? [`Resolved the report link to ${describeSource(source)}.`]
      : [];

  if (source.kind === "appBuild" && compareWith !== undefined) {
    return compareAppBuilds(
      reportFetcher,
      source,
      compareWith,
      cursor,
      preface,
      processing,
    );
  }
  if (source.kind === "appBuild") {
    return createSuccessResponse(
      await appBuildMessages(
        reportFetcher,
        source,
        cursor,
        preface,
        processing,
        stillProcessing,
      ),
    );
  }
  if (source.kind === "appReport") {
    return createSuccessResponse(
      await appReportMessages(
        reportFetcher,
        source,
        cursor,
        preface,
        processing,
        stillProcessing,
      ),
    );
  }

  const pageArg = pageUrl ? `, pageUrl: "${pageUrl}"` : "";
  let reportLink: string;
  try {
    reportLink = await reportFetcher.getReportLink(source, {
      exportTaskId,
      onWait: exportProgress(context),
    });
  } catch (error) {
    if (error instanceof ExportPendingError) {
      return createSuccessResponse(
        exportPendingMessages(source, error, pageArg),
      );
    }
    throw error;
  }

  const {
    records,
    page_length,
    total_issues,
    next_page,
    remaining,
    duplicate_issues,
    unlinked_duplicates,
    hidden_issues,
    page,
  } = await parseAccessibilityReportFromCSV(reportLink, {
    nextPage: cursor,
    pageUrl,
  });

  return createSuccessResponse([
    ...preface,
    ...processingNote(processing),
    ...(page ? pageNote(page) : []),
    `Retrieved ${page_length} accessibility issues (Total: ${total_issues})`,
    ...excludedIssuesNote(duplicate_issues, unlinked_duplicates, hidden_issues),
    `You can also download the full report (CSV) from the following link, valid for about 12 hours: ${reportLink}`,
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify(records, null, 2))}`,
    closingMessage(next_page, remaining, source, stillProcessing, pageArg),
  ]);
}
/** What one page of a report holds, in the dashboard's page-view terms. */
function pageNote(page: {
  url: string;
  occurrences: number;
  distinct_issues: number;
  first_found_here: number;
  by_severity: Record<string, number>;
  similar_pages?: string[];
}): string[] {
  if (page.occurrences === 0) {
    const similar = page.similar_pages?.length
      ? ` Pages in this report with a similar address: ${wrapUntrusted("report page addresses", JSON.stringify(page.similar_pages))}`
      : "";
    return [`No issue in this report is on ${page.url}.${similar}`];
  }
  const severities = Object.entries(page.by_severity)
    .sort(([, a], [, b]) => b - a)
    .map(([severity, n]) => `${n} ${severity}`)
    .join(", ");
  return [
    `${page.occurrences} issue occurrences on ${page.url} (${severities}), as the dashboard's page view counts them: ${page.distinct_issues} distinct issues, ${page.first_found_here} of them first found on this page. Each issue below is listed once, with occurrences_on_page; first_found_on names the page an issue was first found on when it is another one.`,
  ];
}

/** At most this many new and resolved issues are listed in a comparison. */
const COMPARE_LIST_LIMIT = 50;

/**
 * A Website Scanner run against an earlier run of the same scan: the run before it
 * ("previous") or a given scanRunId. Issues are matched by rule, element and page; against
 * the previous run, the dashboard's own counts (the run's changesSinceLastRun) are given too.
 */
async function compareScanRuns(
  requested: RequestedSource,
  compareWith: string,
  config: BrowserStackConfig,
  context?: ScanProgressContext,
): Promise<CallToolResult> {
  const reportFetcher = await initializeReportFetcher(config);
  const source =
    requested.kind === "link"
      ? await reportFetcher.sourceFromReportUrl(requested.reportUrl)
      : requested;
  if (source.kind !== "scan") {
    return createErrorResponse(
      'compareWith compares Website Scanner runs: pass the newer run (scanId and scanRunId, or its report link) and compareWith: "previous" or the older run\'s scanRunId.',
    );
  }
  const previous = await reportFetcher.previousScanRun(
    source.scanId,
    source.scanRunId,
  );
  const baseRunId =
    compareWith === "previous" ? previous && String(previous.id) : compareWith;
  if (!baseRunId) {
    return createErrorResponse(
      `Run ${source.scanRunId} is the first run of scan ${source.scanId}; there is no earlier run to compare it with.`,
    );
  }
  const base: IssueSource = { ...source, scanRunId: baseRunId };
  const againstPrevious =
    previous !== undefined && String(previous.id) === baseRunId;

  let links: [string, string];
  try {
    links = await Promise.all([
      reportFetcher.getReportLink(source, { onWait: exportProgress(context) }),
      reportFetcher.getReportLink(base, {}),
    ]);
  } catch (error) {
    if (error instanceof ExportPendingError) {
      return createSuccessResponse([
        `The CSV exports of these runs are still being generated (waited ${formatDuration(error.waitedMs)}). Call fetchAccessibilityIssues again with the same arguments in about a minute; the exports continue where they are.`,
      ]);
    }
    throw error;
  }
  const [after, before] = await Promise.all(links.map(loadMainIssues));
  const diff = compareIssues(before, after);
  const changes = againstPrevious
    ? await reportFetcher.changesSinceLastRun(source.scanId, source.scanRunId)
    : undefined;

  const baseLabel = againstPrevious
    ? `the run before it, run ${baseRunId}${previous?.scanDate ? ` (${previous.scanDate})` : ""}`
    : `run ${baseRunId}`;
  const matched = `${diff.added.length} new, ${diff.resolved.length} resolved, ${diff.retained} still open`;
  const listed = (issues: typeof diff.added) =>
    wrapUntrusted(
      "accessibility comparison",
      JSON.stringify(issues.slice(0, COMPARE_LIST_LIMIT), null, 2),
    ) +
    (issues.length > COMPARE_LIST_LIMIT
      ? `\n(${issues.length - COMPARE_LIST_LIMIT} more not listed; see the CSV links.)`
      : "");
  return createSuccessResponse([
    ...(requested.kind === "link"
      ? [`Resolved the report link to ${describeSource(source)}.`]
      : []),
    `Compared Website Scanner scan ${source.scanId}: run ${source.scanRunId} with ${baseLabel}.`,
    changes
      ? `The dashboard's comparison: ${changes.newIssues} new, ${changes.resolvedIssues} resolved, ${changes.retainedIssues} still open. Matching the issues by rule, element and page gives ${matched}.`
      : `Matching the issues by rule, element and page: ${matched}.`,
    `New issues: ${listed(diff.added)}`,
    `Resolved issues: ${listed(diff.resolved)}`,
    `CSV of each run, valid for about 12 hours: newer ${links[0]} , older ${links[1]}`,
  ]);
}

interface ListAppReportsArgs {
  kind?: "automated" | "manual";
  projectName?: string;
  name?: string;
  limit?: number;
}

/**
 * What App Accessibility has on record, newest first, with the ids the issues are read by.
 * Without a project name, the automated listing shows the projects: a build list needs one.
 */
async function listAppAccessibilityReports(
  args: ListAppReportsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const reportFetcher = await initializeReportFetcher(config);
  const limit = args.limit ?? 10;
  const filtered = (what: string) =>
    args.name ? ` whose ${what} contains "${args.name}"` : "";
  if (args.kind === "manual") {
    const { total, reports } = await reportFetcher.listAppManualReports(
      args.name,
      limit,
    );
    if (reports.length === 0) {
      return createSuccessResponse([
        `No App Accessibility manual reports${filtered("name")}. Drop the name filter to list the newest reports.`,
      ]);
    }
    return createSuccessResponse([
      `${total} App Accessibility manual reports (newest first)${filtered("name")}${
        total > reports.length ? `, showing ${reports.length}` : ""
      }:`,
      wrapUntrusted(
        "app accessibility reports",
        JSON.stringify(reports, null, 2),
      ),
      `Read a report's issues with fetchAccessibilityIssues with appReportId: <reportId>; its dashboard_link opens it on the dashboard.`,
    ]);
  }
  if (!args.projectName) {
    const { total, projects } = await reportFetcher.listAppProjects(limit);
    return createSuccessResponse([
      `${total} App Accessibility projects (newest first)${
        total > projects.length ? `, showing ${projects.length}` : ""
      }:`,
      wrapUntrusted(
        "app accessibility projects",
        JSON.stringify(projects, null, 2),
      ),
      `A build list needs a project: call listAppAccessibilityReports again with projectName: <name> (exact) to list its builds.`,
    ]);
  }
  const { project, total, builds } = await reportFetcher.listAppBuilds(
    args.projectName,
    args.name,
    limit,
  );
  if (builds.length === 0) {
    return createSuccessResponse([
      `No builds of App Accessibility project "${project.name}"${filtered("name")}${
        args.name
          ? ". Drop the name filter to list the project's newest builds"
          : ": nothing has run with accessibility on in it yet"
      }.`,
    ]);
  }
  return createSuccessResponse([
    `${total} builds of App Accessibility project "${project.name}" (newest first)${filtered("name")}${
      total > builds.length ? `, showing ${builds.length}` : ""
    }:`,
    wrapUntrusted("app accessibility builds", JSON.stringify(builds, null, 2)),
    `Read a build's issues with fetchAccessibilityIssues with buildId: <buildId>; it waits while a build is still processing. report_status "failed" with scan_count 0 means the run recorded no scans.`,
  ]);
}

async function executeListAppAccessibilityReports(
  args: ListAppReportsArgs,
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "listAppAccessibilityReports",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await listAppAccessibilityReports(args, config);
  } catch (error) {
    return handleMCPError("listAppAccessibilityReports", server, config, error);
  }
}

async function executeAccessibilityScan(
  args: {
    name: string;
    pageURL: string;
    authConfigId?: number;
    advancedRules?: boolean;
  },
  context: ScanProgressContext,
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "startAccessibilityScan",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    return await runAccessibilityScan(
      args.name,
      args.pageURL,
      context,
      config,
      args.authConfigId,
      args.advancedRules,
    );
  } catch (error) {
    return handleMCPError("startAccessibilityScan", server, config, error);
  }
}

function validateFormAuthArgs(args: AuthConfigArgs): args is FormAuthArgs {
  return (
    args.type === "form" &&
    "usernameSelector" in args &&
    "passwordSelector" in args &&
    "submitSelector" in args &&
    !!args.usernameSelector &&
    !!args.passwordSelector &&
    !!args.submitSelector
  );
}

async function createAuthConfig(
  args: AuthConfigArgs,
  config: BrowserStackConfig,
): Promise<any> {
  const authConfig = new AccessibilityAuthConfig();
  const auth = setupAuth(config);
  authConfig.setAuth(auth);

  if (args.type === "form") {
    if (!validateFormAuthArgs(args)) {
      throw new Error(
        "Form authentication requires usernameSelector, passwordSelector, and submitSelector",
      );
    }
    return await authConfig.createFormAuthConfig(args.name, {
      username: args.username,
      usernameSelector: args.usernameSelector,
      password: args.password,
      passwordSelector: args.passwordSelector,
      submitSelector: args.submitSelector,
      url: args.url,
    });
  } else {
    return await authConfig.createBasicAuthConfig(args.name, {
      url: args.url,
      username: args.username,
      password: args.password,
    });
  }
}

async function executeCreateAuthConfig(
  args: AuthConfigArgs,
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "createAccessibilityAuthConfig",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    logger.info(
      `Creating auth config: ${JSON.stringify({ ...args, password: "***" })}`,
    );

    const result = await createAuthConfig(args, config);

    return createSuccessResponse([
      `✅ Auth config "${args.name}" created successfully with ID: ${result.data?.id}`,
      `Auth config details: ${JSON.stringify(
        safeAuthConfigData(result),
        null,
        2,
      )}`,
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Form authentication requires")
    ) {
      return createErrorResponse(error.message);
    }
    return handleMCPError(
      "createAccessibilityAuthConfig",
      server,
      config,
      error,
    );
  }
}

async function executeGetAuthConfig(
  args: { configId: number },
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "getAccessibilityAuthConfig",
      server.server.getClientVersion()!,
      undefined,
      config,
    );

    const authConfig = new AccessibilityAuthConfig();
    const auth = setupAuth(config);
    authConfig.setAuth(auth);

    const result = await authConfig.getAuthConfig(args.configId);

    return createSuccessResponse([
      `✅ Auth config retrieved successfully`,
      `Auth config details: ${JSON.stringify(
        safeAuthConfigData(result),
        null,
        2,
      )}`,
    ]);
  } catch (error) {
    return handleMCPError("getAccessibilityAuthConfig", server, config, error);
  }
}

function createScanFailureResponse(
  name: string,
  status: string,
): CallToolResult {
  return createErrorResponse(
    `❌ Accessibility scan "${name}" failed with status: ${status} , check the BrowserStack dashboard for more details [https://scanner.browserstack.com/site-scanner/scan-details/${name}].`,
  );
}

function createScanSuccessResponse(
  name: string,
  totalIssues: number,
  pageLength: number,
  records: any[],
  scanId: string,
  scanRunId: string,
  reportUrl: string,
  cursor: number | null,
  duplicates: string[] = [],
): CallToolResult {
  const messages = [
    `Accessibility scan "${name}" completed. check the BrowserStack dashboard for more details [https://scanner.browserstack.com/site-scanner/scan-details/${name}].`,
    `Scan ID: ${scanId} and Scan Run ID: ${scanRunId}`,
    `You can also download the full report from the following link: ${reportUrl}`,
    `We found ${totalIssues} issues. Below are the details of the ${pageLength} most critical issues.`,
    ...duplicates,
    `Scan results: ${wrapUntrusted("accessibility scan results", JSON.stringify(records, null, 2))}`,
  ];

  if (cursor !== null) {
    messages.push(
      `More issues available. Use fetchAccessibilityIssues tool with scanId: "${scanId}", scanRunId: "${scanRunId}", and cursor: ${cursor} to get the next batch.`,
    );
  }

  return createSuccessResponse(messages);
}

async function runAccessibilityScan(
  name: string,
  pageURL: string,
  context: ScanProgressContext,
  config: BrowserStackConfig,
  authConfigId?: number,
  advancedRules?: boolean,
): Promise<CallToolResult> {
  const scanner = await initializeScanner(config);

  const startResp = await scanner.startScan(
    name,
    [pageURL],
    authConfigId,
    advancedRules,
  );
  const scanId = startResp.data!.id;
  const scanRunId = startResp.data!.scanRunId;

  await notifyScanProgress(context, `Accessibility scan "${name}" started`, 0);

  const status = await scanner.waitUntilComplete(scanId, scanRunId, context);
  if (status !== "completed") {
    return createScanFailureResponse(name, status);
  }

  const reportFetcher = await initializeReportFetcher(config);
  let reportLink: string;
  try {
    reportLink = await reportFetcher.getReportLink(
      { kind: "scan", scanId, scanRunId },
      { onWait: exportProgress(context) },
    );
  } catch (error) {
    if (error instanceof ExportPendingError) {
      return createSuccessResponse([
        `Accessibility scan "${name}" completed. Scan ID: ${scanId} and Scan Run ID: ${scanRunId}`,
        ...exportPendingMessages(
          {
            kind: "scan",
            scanId: String(scanId),
            scanRunId: String(scanRunId),
          },
          error,
          "",
        ),
      ]);
    }
    throw error;
  }

  const {
    records,
    page_length,
    total_issues,
    next_page,
    duplicate_issues,
    unlinked_duplicates,
    hidden_issues,
  } = await parseAccessibilityReportFromCSV(reportLink);

  return createScanSuccessResponse(
    name,
    total_issues,
    page_length,
    records,
    scanId,
    scanRunId,
    reportLink,
    next_page,
    excludedIssuesNote(duplicate_issues, unlinked_duplicates, hidden_issues),
  );
}

export default function addAccessibilityTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.startAccessibilityScan = server.tool(
    "startAccessibilityScan",
    "Scan a web page URL for accessibility issues and get a CSV report. For a mobile app, run it on App Automate with accessibility on (setupBrowserStackAppAutomateTests), then fetchAccessibilityIssues.",
    {
      name: z.string().describe("Name of the accessibility scan"),
      pageURL: z
        .string()
        .describe("The web page URL to scan for accessibility issues"),
      authConfigId: z
        .number()
        .optional()
        .describe("Optional auth config ID for authenticated scans"),
      advancedRules: z
        .boolean()
        .optional()
        .describe("Enable advanced accessibility rules in the scan settings"),
    },
    {
      title: "Start Accessibility Scan",
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
    async (args, context) => {
      return await executeAccessibilityScan(args, context, server, config);
    },
  );

  tools.createAccessibilityAuthConfig = server.tool(
    "createAccessibilityAuthConfig",
    "Create an authentication configuration for accessibility scans. Supports both form-based and basic authentication.",
    {
      name: z.string().describe("Name for the auth configuration"),
      type: z
        .enum(["form", "basic"])
        .describe(
          "Authentication type: 'form' for form-based auth, 'basic' for HTTP basic auth",
        ),
      url: z.string().describe("URL of the authentication page"),
      username: z
        .string()
        .optional()
        .describe("Site username; omit to have it requested from the user."),
      password: z
        .string()
        .optional()
        .describe("Site password; omit to have it requested from the user."),
      usernameSelector: z
        .string()
        .optional()
        .describe("CSS selector for username field (required for form auth)"),
      passwordSelector: z
        .string()
        .optional()
        .describe("CSS selector for password field (required for form auth)"),
      submitSelector: z
        .string()
        .optional()
        .describe("CSS selector for submit button (required for form auth)"),
    },
    {
      title: "Create Accessibility Auth Config",
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    async (args) => {
      try {
        const creds = await elicitCredentialsIfSupported(
          server,
          { username: args.username, password: args.password },
          [
            {
              key: "username",
              title: "Site username",
              description: `Username for the login being configured ("${args.name}")`,
            },
            {
              key: "password",
              title: "Site password",
              description: `Password for the login being configured ("${args.name}")`,
            },
          ],
          `Enter the login credentials for accessibility auth config "${args.name}".`,
        );

        if (!creds.username || !creds.password) {
          const error = new Error(
            "Username and password are required to create an auth config. Provide them when prompted, or pass them as arguments.",
          );
          trackMCP(
            "createAccessibilityAuthConfig",
            server.server.getClientVersion()!,
            error,
            config,
          );
          return createErrorResponse(error.message);
        }

        return await executeCreateAuthConfig(
          {
            ...args,
            username: creds.username,
            password: creds.password,
          } as AuthConfigArgs,
          server,
          config,
        );
      } catch (error) {
        return handleMCPError(
          "createAccessibilityAuthConfig",
          server,
          config,
          error,
        );
      }
    },
  );

  tools.getAccessibilityAuthConfig = server.tool(
    "getAccessibilityAuthConfig",
    "Retrieve an existing authentication configuration by ID." +
      NEEDS_A11Y_CONFIG_ID,
    {
      configId: z.number().describe("ID of the auth configuration to retrieve"),
    },
    {
      title: "Get Accessibility Auth Config",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      return await executeGetAuthConfig(args, server, config);
    },
  );

  tools.fetchAccessibilityIssues = server.tool(
    "fetchAccessibilityIssues",
    "Fetch accessibility issues from one source: scanId+scanRunId, buildId, workflowReportId, appReportId or reportUrl." +
      NEEDS_A11Y_SCAN_ID,
    {
      scanId: z
        .string()
        .optional()
        .describe("Website Scanner: the scan id from startAccessibilityScan."),
      scanRunId: z
        .string()
        .optional()
        .describe(
          "Website Scanner: the scan run id from startAccessibilityScan.",
        ),
      buildId: z
        .string()
        .regex(/^[a-z0-9]{40}$/, "40 lowercase letters and digits")
        .optional()
        .describe(
          "Automated Tests or App Accessibility build id: the SDK's testhub id, or the thBuildId in a web report link.",
        ),
      workflowReportId: z
        .string()
        .optional()
        .describe("Workflow Analyzer: the report's numeric id."),
      appReportId: z
        .string()
        .regex(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          "A manual report id is a UUID",
        )
        .optional()
        .describe(
          "Manual App Accessibility report id (a UUID), from listAppAccessibilityReports or its /report/ link.",
        ),
      reportUrl: z
        .string()
        .optional()
        .describe(
          "A web or app report link (dashboard, scanner share link, manual report), or an Automate or App Automate link.",
        ),
      cursor: z
        .number()
        .optional()
        .describe(
          "Character offset for pagination (default: 0); with compareWith, how many issues are already listed.",
        ),
      pageUrl: z
        .string()
        .optional()
        .describe(
          "Only the issues on this page URL, counted as the dashboard's page view counts them.",
        ),
      compareWith: z
        .string()
        .optional()
        .describe(
          `"previous", an older scanRunId (Website Scanner), or an earlier app build's id or link; lists new and resolved issues.`,
        ),
      exportTaskId: z
        .string()
        .optional()
        .describe(
          "Continue a CSV export that an earlier call said is still being generated.",
        ),
    },
    {
      title: "Fetch Accessibility Issues",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args, context) => {
      return await executeFetchAccessibilityIssues(
        args,
        context as ScanProgressContext,
        server,
        config,
      );
    },
  );

  tools.listAppAccessibilityReports = server.tool(
    "listAppAccessibilityReports",
    "List App Accessibility work newest first, with the ids fetchAccessibilityIssues reads: a project's builds (automated; omit projectName to list projects) or manual reports.",
    {
      kind: z
        .enum(["automated", "manual"])
        .optional()
        .default("automated")
        .describe(
          "automated (App Automate builds, default) or manual (Workflow Analyzer reports).",
        ),
      projectName: z
        .string()
        .optional()
        .describe(
          "Automated only: the exact App Accessibility project name; omit to list the projects.",
        ),
      name: z
        .string()
        .optional()
        .describe("Partial build or report name to filter by."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .default(10)
        .describe("Rows to return, newest first (1 to 30, default 10)."),
    },
    {
      title: "List App Accessibility Reports",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      return await executeListAppAccessibilityReports(args, server, config);
    },
  );

  return tools;
}
