import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  AccessibilityScanner,
  ScanRefusedError,
  ScanTimeoutError,
  cleanScanName,
  samePage as sameScanPage,
  type ScanFailureDetails,
  type ScanSettings,
} from "./accessiblity-utils/scanner.js";
import {
  AccessibilityReportFetcher,
  ExportPendingError,
  ScanNotInListError,
  ScanRunNotFoundError,
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
  parseAccessibilityReportFromCSV,
  samePage,
  type IssueSummary as WebIssueSummary,
  type RunIssue,
} from "./accessiblity-utils/report-parser.js";
import { wrapUntrusted } from "../lib/untrusted-content.js";
import { isLocalURL } from "../lib/local.js";
import { queryAccessibilityRAG } from "./accessiblity-utils/accessibility-rag.js";
import { BrowserStackConfig } from "../lib/types.js";
import { elicitCredentialsIfSupported } from "../lib/elicit-credentials.js";
import logger from "../logger.js";
import { NEEDS_A11Y_CONFIG_ID, NEEDS_A11Y_SCAN_ID } from "./tool-handoff.js";
import {
  createErrorResponse,
  createSuccessResponse,
  describeSource,
  exportProgress,
  formatDuration,
  initializeScanner,
  notifyScanProgress,
  onOff,
  PROCESSING_STATUSES,
  scanDashboardNote,
  setupAuth,
  sourceArgs,
  wcagName,
  WCAG_VERSIONS,
  type ScanProgressContext,
} from "./accessiblity-utils/shared.js";
import {
  accountRefusal,
  asSentence,
} from "./accessiblity-utils/error-messages.js";
import {
  EXPERT_QUERY_MAX_CHARS,
  fitExpertQuery,
} from "./accessiblity-utils/expert-query.js";
import {
  buildIdNotFound,
  errorPagesNote,
  failedRunResponse,
  failedScanRunResponse,
  failureReasons,
  FINALIZING_STATUSES,
  noReportYetResponse,
  pageReasons,
  stillFinalizingResponse,
} from "./accessiblity-utils/report-answers.js";
import {
  NO_BUILT_IN_COMPARE,
  notReadyToCompare,
  previousReportToCompare,
  readBothToCompare,
  scanRunToCompare,
} from "./accessiblity-utils/compare-with.js";
import {
  comparedList,
  diffExports,
  pagesNotLoadedNote,
} from "./accessiblity-utils/compare-lists.js";
import { compareWebBuilds } from "./accessiblity-utils/web-build-compare.js";
import {
  compareHint,
  localRerunNote,
  localScanNotRerunNote,
  otherPageNote,
  rescanHint,
  savedSettingDifferences,
  uncheckedSettings,
  unusedLoginAndTunnel,
  withNotes,
  type ScanArgs,
} from "./accessiblity-utils/scan-rerun.js";

export { EXPERT_QUERY_MAX_CHARS };

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

function handleMCPError(
  toolName: string,
  server: McpServer,
  config: BrowserStackConfig,
  error: unknown,
): CallToolResult {
  trackMCP(toolName, server.server.getClientVersion()!, error, config);
  const errorMessage =
    (error instanceof Error && error.message.trim()) || "Unknown error";
  const refusal = accountRefusal(errorMessage);
  if (refusal) {
    return createErrorResponse(
      `${refusal}\nBrowserStack said: ${errorMessage}`,
    );
  }
  return createErrorResponse(
    `Failed to ${toolName.replace(/([A-Z])/g, " $1").toLowerCase()}: ${asSentence(errorMessage)} Please open an issue on GitHub if the problem persists`,
  );
}

async function initializeReportFetcher(
  config: BrowserStackConfig,
): Promise<AccessibilityReportFetcher> {
  const reportFetcher = new AccessibilityReportFetcher();
  const auth = setupAuth(config);
  reportFetcher.setAuth(auth);
  return reportFetcher;
}

async function executeAccessibilityRAG(
  args: { query: string },
  server: McpServer,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    trackMCP(
      "accessibilityExpert",
      server.server.getClientVersion()!,
      undefined,
      config,
    );
    const { query, shortened, kept } = fitExpertQuery(args.query);
    const answer = await queryAccessibilityRAG(query, config);
    if (!shortened) return answer;
    return {
      ...answer,
      content: [
        {
          type: "text",
          text: `The question was ${args.query.length} characters; the knowledge base takes at most ${EXPERT_QUERY_MAX_CHARS}, so ${query.length} were sent: its ${kept ?? "opening"}. If the answer misses the point, ask again more briefly.`,
        },
        ...(answer.content ?? []),
      ],
    };
  } catch (error) {
    return handleMCPError("accessibilityExpert", server, config, error);
  }
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
      args.compareWith,
      {
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

interface ProcessingState {
  /** The report's status when its issues were read; undefined when it could not be read. */
  status?: string;
}

/** What the answer says about a report read while it is still processing, if anything. */
function processingNote({ status }: ProcessingState): string[] {
  if (!status || !PROCESSING_STATUSES.has(status)) return [];
  const meaning =
    status === "finalizing"
      ? ", which on an advanced scan means advanced issue processing"
      : "";
  return [
    `⚠️ This report is still processing (status: ${status}${meaning}). The issues below are only those found so far: more will be added and the total will grow. Call fetchAccessibilityIssues again in a few minutes for the complete list.`,
  ];
}

/**
 * The last line: how to get the next page, or that there is none. With pages that were not
 * scanned, the issues are all there are of the pages that were, not of the run's pages.
 */
function closingMessage(
  next_page: number | null,
  remaining: number,
  source: IssueSource,
  stillProcessing: boolean,
  extraArgs = "",
  pagesSkipped = false,
): string {
  if (next_page !== null) {
    return `${remaining} more issues available. Use fetchAccessibilityIssues with ${sourceArgs(source)}${extraArgs} and cursor: ${next_page} to get the next batch.`;
  }
  if (stillProcessing) {
    return `All issues found so far retrieved; the report is still processing.`;
  }
  if (pagesSkipped) {
    return `All issues retrieved for the pages that were scanned.`;
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

/**
 * Why a finished app build has no scans. Each cause here produced a run that finished
 * green with nothing scanned and no warning; they are listed most likely first, with what
 * the build's own details say ahead of the rest. A native build gets the native causes.
 */
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

/** How many rules and pages a web report's summary names; the rest are counted. */
const SUMMARY_RULES = 20;
const SUMMARY_PAGES = 10;

/**
 * A web report's issues at a glance, all of them rather than one page's: by severity, how
 * many a person still has to confirm, how many are best practices, by rule and by page.
 */
function webSummaryNote(
  summary: WebIssueSummary | undefined,
  total: number,
): string[] {
  if (!summary || total === 0) return [];
  const one = (n: number, singular: string, plural: string) =>
    n === 1 ? singular : plural;
  const rank = (severity: string) => {
    const i = SEVERITY_ORDER.indexOf(severity);
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  const severities = Object.entries(summary.by_severity)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([severity, n]) => `${n} ${severity}`)
    .join(", ");
  const review = summary.needs_review;
  const practice = summary.best_practice;
  const notes = [
    ...(review > 0
      ? [
          `${review} ${one(review, "needs", "need")} review (a person has to confirm ${one(review, "it", "them")})`,
        ]
      : []),
    ...(practice > 0
      ? [
          `${practice} ${one(practice, "is a best practice, not a WCAG failure", "are best practices, not WCAG failures")}`,
        ]
      : []),
  ];
  const listed = <T>(
    rows: T[],
    limit: number,
    label: (row: T) => string,
    rest: string,
  ) => {
    const more = rows.length - Math.min(rows.length, limit);
    return `${rows.slice(0, limit).map(label).join(", ")}${more > 0 ? `, and ${more} more ${rest}` : ""}.`;
  };
  const pages = summary.by_page ?? [];
  return [
    `Summary of the ${total} issues: ${severities}${notes.map((note) => `; ${note}`).join("")}.`,
    wrapUntrusted(
      "accessibility issue counts",
      [
        `By rule: ${listed(summary.by_rule, SUMMARY_RULES, (r) => `${r.issue_type} ${r.count}`, "rules")}`,
        ...(pages.length > 0
          ? [
              `By page: ${listed(pages, SUMMARY_PAGES, (p) => `${p.url} ${p.count}`, "pages")}`,
            ]
          : []),
      ].join("\n"),
    ),
  ];
}

const WEB_ISSUES_NOTE =
  "Each issue names its rule (issue_type): the rule's name, description, WCAG criteria and usual fix are under rules, and an issue has its own how_to_fix only when it differs. An issue with needs_review is one the engine could not decide, so a person confirms it: the value is its review status, and until it is confirmed it is not a confirmed failure. An issue with no needs_review, whose rule is not a best practice (best_practice under rules), is a confirmed WCAG failure.";

/** The CSV link, with what it is for: an answer gives a page of issues at a time. */
function fullReportLine(reportLink: string): string {
  return `The full list of issues is a CSV, valid for about 12 hours: download it when every issue is needed at once (this answer gives them a page at a time), from the following link: ${reportLink}`;
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

/** The build to compare with, or the answer to give when there is none. */
async function baselineAppBuild(
  reportFetcher: AccessibilityReportFetcher,
  buildId: string,
  compareWith: string,
): Promise<
  | { buildId: string; sameName?: boolean; searchedAll?: boolean }
  | CallToolResult
> {
  let baseline: { buildId: string; sameName?: boolean; searchedAll?: boolean };
  if (compareWith === "previous") {
    const previous = await reportFetcher.previousAppBuild(buildId);
    if (!previous) {
      return createErrorResponse(
        "This is its project's first build, so there is nothing earlier to compare it with. Pass an earlier build's id or link as compareWith instead.",
      );
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
      return readBothToCompare(
        `compareWith names ${describeSource(source)}, which is not an App Accessibility build; an app build is compared here only with another ("previous", or an earlier build's id or link).`,
        true,
      );
    }
    baseline = { buildId: source.buildId };
  }
  if (baseline.buildId === buildId) {
    return createErrorResponse(
      `compareWith names this build itself. Pass an earlier build's id or link, or "previous".`,
    );
  }
  return baseline;
}

/**
 * What changed between an earlier app build and this one: issues new in this build,
 * issues the earlier one had that this one does not, and how many it kept. An issue on a
 * screen this build did not reach also reads as resolved, so a build that scanned other
 * screens or ran other tests is called out. A build still running its tests or rules is not
 * compared.
 */
async function compareAppBuilds(
  reportFetcher: AccessibilityReportFetcher,
  source: { kind: "appBuild"; buildId: string },
  compareWith: string,
  cursor: number,
  preface: string[],
): Promise<CallToolResult> {
  const baseline = await baselineAppBuild(
    reportFetcher,
    source.buildId,
    compareWith,
  );
  if ("content" in baseline) return baseline;
  const [named, current] = await Promise.all([
    reportFetcher.appBuildIssues(baseline.buildId),
    reportFetcher.appBuildIssues(source.buildId),
  ]);
  const unfinished = [current, named].find((b) =>
    PROCESSING_STATUSES.has(b.status),
  );
  if (unfinished) {
    return notReadyToCompare(
      `App Accessibility build #${unfinished.build_number} (${unfinished.buildId})`,
      unfinished.status,
      preface,
    );
  }
  // Issues on screens past the read limit would read as resolved or new.
  const partial = [current, named].find((b) => b.screens_read !== undefined);
  if (partial) {
    return createErrorResponse(
      `Build #${partial.build_number} has more scanned screens than are read here (the first ${partial.screens_read} of ${partial.scan_count}), so a comparison would count the issues on the rest as resolved or new. Compare the builds on the App Accessibility dashboard instead.`,
    );
  }
  // A comparison runs from the earlier build to the later; named the other way round, the
  // new issues would read as resolved and the resolved as new.
  const reversed =
    named.created_at !== undefined &&
    current.created_at !== undefined &&
    Date.parse(named.created_at) > Date.parse(current.created_at);
  const [before, after] = reversed ? [current, named] : [named, current];
  const { added, first_scanned, resolved, unconfirmed, retained } =
    compareAppIssues(before.issues, after.issues, {
      sameScreens: before.scan_count === after.scan_count,
    });
  const screensOf = (rows: AppAccessibilityIssue[]) =>
    new Set(rows.map((r) => r.screen)).size;
  const unreached = screensOf(unconfirmed);
  const unseen = screensOf(first_scanned);
  const setApart = [
    ...(unreached > 0
      ? [
          unreached === 1
            ? `${unconfirmed.length} more issues of the earlier build are on 1 screen no screen of the later build resembles: the later build did not reach it, or the issues on it were fixed. They are not counted as resolved; scan that screen again to confirm.`
            : `${unconfirmed.length} more issues of the earlier build are on ${unreached} screens no screen of the later build resembles: the later build did not reach them, or the issues on them were fixed. They are not counted as resolved; scan those screens again to confirm.`,
        ]
      : []),
    ...(unseen > 0
      ? [
          `${first_scanned.length} more issues of the later build are on ${unseen === 1 ? "1 screen" : `${unseen} screens`} no screen of the earlier build resembles: not scanned before, so they are not counted as new.`,
        ]
      : []),
  ];
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
    ...(reversed
      ? [
          "compareWith names a build newer than this one, so the comparison runs from this build (the earlier) to that one (the later).",
        ]
      : []),
    `Compared App Accessibility build #${after.build_number} with build #${before.build_number}${which}: ${added.length} new, ${resolved.length} resolved, ${retained} still open.`,
    `Builds: ${builds}`,
    ...setApart,
    setApart.length > 0
      ? `Issues are matched one for one by rule and element: its id, or else its class and its text or label; screens, by the elements on them. New, first-scanned and still-open issues add up to the later build's ${after.issues.length}; resolved, not-confirmed and still-open ones to the earlier build's ${before.issues.length}.`
      : `Issues are matched one for one by rule and element: its id, or else its class and its text or label. New and still-open issues add up to the later build's ${after.issues.length}; resolved and still-open ones to the earlier build's ${before.issues.length}.`,
    ...warnings,
    issueList("New issues", added, cursor),
    issueList("Resolved issues", resolved, cursor),
    ...(unconfirmed.length > 0
      ? [issueList("Not confirmed resolved", unconfirmed, cursor)]
      : []),
    ...(first_scanned.length > 0
      ? [
          issueList(
            "On screens first scanned in the later build",
            first_scanned,
            cursor,
          ),
        ]
      : []),
    Math.max(
      added.length,
      resolved.length,
      unconfirmed.length,
      first_scanned.length,
    ) >
    cursor + COMPARE_LIST_MAX
      ? `More to list: call fetchAccessibilityIssues with buildId: "${source.buildId}", compareWith: "${compareWith}" and cursor: ${cursor + COMPARE_LIST_MAX}.`
      : `Read the later build's open issues with fetchAccessibilityIssues with buildId: "${after.buildId}".`,
  ]);
}

/** How an app page's issues name what they share, which the page says once. */
const APP_ISSUES_SHAPE =
  "Each issue names its rule (rule_id) and screen: the rule's name, description, WCAG criteria and usual fix are under rules, each screen's screenshot under screens, and measured holds what the rule measured on the element.";

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
    ...(report.screens_read !== undefined
      ? [
          `Only the first ${report.screens_read} of the build's ${report.scan_count} scanned screens were read; the total counts the issues on those. The dashboard report has them all.`,
        ]
      : []),
    ...excludedIssuesNote(null, 0, report.hidden_issues),
    APP_ISSUES_SHAPE,
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify({ issues: records, rules: report.rules, screens: report.screens }, null, 2))}`,
    closingMessage(next_page, report.remaining, source, stillProcessing),
  ];
}

/**
 * A manual report's issues come inline from its scanned screens: the dashboard's own, with
 * its duplicates left out, when its route takes the access key; else every occurrence the
 * Manual Reports API lists, which does not mark duplicates, so the dashboard's count is
 * stated next to the total rather than reproduced.
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
    report.duplicate_occurrences === 0
      ? []
      : report.deduplicated
        ? [
            `${report.duplicate_occurrences} duplicate occurrences are left out, as the dashboard leaves them out of its count.`,
          ]
        : [
            `The dashboard counts ${report.dashboard_count} issues for this report: ${report.duplicate_occurrences} of the occurrences are duplicates it folds, which the API does not mark.`,
          ];
  const counted = report.deduplicated ? "issues" : "issue occurrences";
  return [
    ...preface,
    ...processingNote(processing),
    `Retrieved ${page_length} accessibility ${counted} (Total: ${total_issues}) from the App Accessibility manual report below (${where})`,
    details,
    ...(cursor === 0 ? summaryNote(report.summary, total_issues) : []),
    ...(report.screens_read !== undefined
      ? [
          `Only the first ${report.screens_read} of the report's ${report.scan_count} scanned screens were read; the total counts the issues on those. The dashboard report has them all.`,
        ]
      : []),
    ...dashboardNote,
    ...excludedIssuesNote(null, 0, report.hidden_issues),
    APP_ISSUES_SHAPE,
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify({ issues: records, rules: report.rules, screens: report.screens }, null, 2))}`,
    closingMessage(next_page, report.remaining, source, stillProcessing),
  ];
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

async function fetchAccessibilityIssues(
  requested: RequestedSource,
  config: BrowserStackConfig,
  cursor = 0,
  context?: ScanProgressContext,
  compareWith?: string,
  { pageUrl, exportTaskId }: { pageUrl?: string; exportTaskId?: string } = {},
): Promise<CallToolResult> {
  const reportFetcher = await initializeReportFetcher(config);
  const named =
    requested.kind === "link"
      ? await reportFetcher.sourceFromReportUrl(requested.reportUrl)
      : requested;
  // A build id names a web build, a mobile app build, or a Website Scanner run (a scanner
  // link's thBuildId); the APIs tell which. An Automate or App Automate build's own id
  // (hashed_id) resolves to the accessibility build its sessions ran in.
  let source = await reportFetcher.resolveBuild(named, { orScanRun: true });
  const mapped =
    named.kind === "build" &&
    (source.kind === "build" || source.kind === "appBuild") &&
    source.buildId !== named.buildId
      ? [
          `Build id ${named.buildId} is ${source.kind === "build" ? "an Automate" : "an App Automate"} build's own id (hashed_id); its accessibility results are in ${describeSource(source)}.`,
        ]
      : [];
  // Two scan runs are compared through their CSV exports; two web builds through the compare
  // API or their exports; two app builds, here below.
  if (compareWith !== undefined) {
    // Comparing runs needs the scan's ids, which only the scan list maps a build id to.
    if (source.kind === "scanBuild") {
      source = await reportFetcher.findScanRun(source);
    }
    if (source.kind === "scan") {
      return compareScanRuns(source, compareWith, config, context);
    }
    if (source.kind === "build") {
      return compareWebBuilds(
        reportFetcher,
        source,
        compareWith,
        requested.kind === "link"
          ? [`Resolved the report link to ${describeSource(source)}.`]
          : mapped,
        context,
      );
    }
    if (
      (source.kind === "workflow" || source.kind === "appReport") &&
      compareWith === "previous"
    ) {
      return previousReportToCompare(reportFetcher, source);
    }
    if (source.kind !== "appBuild") {
      return readBothToCompare(
        NO_BUILT_IN_COMPARE[source.kind],
        source.kind === "appReport",
      );
    }
  }
  const pageArg = pageUrl ? `, pageUrl: "${pageUrl}"` : "";
  const notes: string[] = [...mapped];
  // A run named by its build id is read by it, which works however old the scan is. If the
  // API does not know it by that id, the scan list is searched as before.
  let reportLink: string | undefined;
  if (source.kind === "scanBuild") {
    try {
      reportLink = await reportFetcher.getReportLink(source, {
        exportTaskId,
        onWait: exportProgress(context),
      });
      if (named.kind === "build") {
        notes.push(
          `Build id ${source.thBuildId} is a Website Scanner run's build id; read it as one.`,
        );
      }
      if (cursor === 0) {
        notes.push(
          "Read by the run's build id, so its processing status was not checked: a scan that finished in the last few minutes may still be adding issues.",
        );
      }
    } catch (error) {
      if (error instanceof ExportPendingError) {
        return createSuccessResponse(
          exportPendingMessages(source, error, pageArg),
        );
      }
      if (!(error instanceof ScanRunNotFoundError)) throw error;
      // A bare build id (no link) that no build API knows: where the API reads runs by build
      // id, it knows no such run; where it cannot yet, the scan list is searched, as for a link.
      const bare = source.scanName === undefined;
      const thBuildId = source.thBuildId;
      if (bare && !error.routeMissing) return buildIdNotFound(thBuildId);
      const why = error.routeMissing
        ? "This API does not read a run by its build id yet"
        : "The API could not read this run by the link's build id (not found, or not visible to this account)";
      try {
        source = await reportFetcher.findScanRun(source);
      } catch (searchError) {
        if (bare && searchError instanceof ScanNotInListError) {
          return buildIdNotFound(thBuildId, searchError);
        }
        throw new Error(
          `${why}, and searching the scan list found nothing either: ${
            searchError instanceof Error
              ? searchError.message
              : String(searchError)
          }`,
        );
      }
      if (bare) {
        notes.push(
          `Build id ${thBuildId} is the build id of ${describeSource(source)}.`,
        );
      }
      notes.push(`${why}, so it was found in the scan list instead.`);
    }
  }
  const preface = [
    ...(requested.kind === "link"
      ? [`Resolved the report link to ${describeSource(source)}.`]
      : []),
    ...notes,
  ];
  // Two app builds are compared once both have finished; the comparison reads their statuses.
  if (source.kind === "appBuild" && compareWith !== undefined) {
    return compareAppBuilds(
      reportFetcher,
      source,
      compareWith,
      cursor,
      preface,
    );
  }
  const processing: ProcessingState = {
    status: await reportFetcher.reportStatus(source),
  };
  const stillProcessing =
    processing.status !== undefined &&
    PROCESSING_STATUSES.has(processing.status);

  // A failed run has nothing to read, and its export said so badly: an empty report for a
  // scan ("0 issues ✅"), "Failed to fetch report: null" for a build. Neither is exported.
  // A cancelled scan run leaves the same empty report.
  if (
    processing.status === "failed" ||
    (source.kind === "scan" && processing.status === "cancelled")
  ) {
    const failed = await failedRunResponse(
      source,
      processing.status,
      config,
      preface,
    );
    if (failed) return failed;
  }
  if (
    cursor === 0 &&
    processing.status &&
    FINALIZING_STATUSES.has(processing.status)
  ) {
    return stillFinalizingResponse(source, processing.status, preface, pageArg);
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

  // The pages a completed run could not scan are simply absent from its report; its scan
  // logs say which, read alongside the export. A run still going has not logged them all.
  const unscanned =
    source.kind === "scan" && processing.status === "completed"
      ? (await initializeScanner(config)).unscannedPages(
          source.scanId,
          source.scanRunId,
        )
      : Promise.resolve([]);
  try {
    reportLink ??= await reportFetcher.getReportLink(source, {
      exportTaskId,
      onWait: exportProgress(context),
      stillProcessing,
    });
  } catch (error) {
    if (error instanceof ExportPendingError) {
      return createSuccessResponse(
        exportPendingMessages(source, error, pageArg),
      );
    }
    // A run or build still going may have no report to export yet: the export fails, which
    // its words ("Failed to fetch report: null") make read like a fault.
    if (stillProcessing) {
      return noReportYetResponse(
        reportFetcher,
        source,
        processing.status ?? "processing",
        preface,
      );
    }
    throw error;
  }

  const {
    records,
    rules,
    summary,
    page_length,
    total_issues,
    next_page,
    remaining,
    duplicate_issues,
    unlinked_duplicates,
    hidden_issues,
    page,
    error_pages = [],
  } = await parseAccessibilityReportFromCSV(reportLink, {
    nextPage: cursor,
    pageUrl,
  });
  // A redirected page was scanned, where it redirected to; a page that showed an error page
  // is said once, with the error page's issues.
  const errorPageUrls = new Set(error_pages.map((p) => samePage(p.url)));
  const notScanned = (await unscanned).filter(
    (p) => p.status !== "redirect" && !errorPageUrls.has(samePage(p.pageUrl)),
  );

  return createSuccessResponse([
    ...preface,
    ...processingNote(processing),
    // What the run did not check, said on the first page with the whole report's counts.
    ...(cursor
      ? []
      : [
          ...errorPagesNote(
            error_pages,
            source.kind === "build" ? "run the tests again" : "scan again",
          ),
          ...(notScanned.length
            ? [
                `⚠️ ${pageReasons(notScanned, ["was not scanned, so its issues are not in this report", "were not scanned, so their issues are not in this report"])}`,
              ]
            : []),
        ]),
    // A page that did not load has no issues of its own to count.
    ...(page && error_pages.length === 0 ? pageNote(page) : []),
    `Retrieved ${page_length} accessibility issues (Total: ${total_issues})`,
    // The whole report's counts, said on its first page.
    ...(cursor ? [] : webSummaryNote(summary, total_issues)),
    ...excludedIssuesNote(duplicate_issues, unlinked_duplicates, hidden_issues),
    fullReportLine(reportLink),
    WEB_ISSUES_NOTE,
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify({ issues: records, rules }))}`,
    closingMessage(
      next_page,
      remaining,
      source,
      stillProcessing,
      pageArg,
      error_pages.length > 0 || notScanned.length > 0,
    ),
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

/**
 * A Website Scanner run against another run of the same scan: the run before it
 * ("previous"), or one named by its scanRunId, report link or build id. The older run is
 * "before", whichever was passed as compareWith. Issues are matched by rule, element and
 * page; against the run just before, the dashboard's own counts (the run's
 * changesSinceLastRun) are given too.
 */
async function compareScanRuns(
  requested: RequestedSource,
  compareWith: string,
  config: BrowserStackConfig,
  context?: ScanProgressContext,
): Promise<CallToolResult> {
  const reportFetcher = await initializeReportFetcher(config);
  const named =
    requested.kind === "link"
      ? await reportFetcher.sourceFromReportUrl(requested.reportUrl)
      : requested;
  // Runs are compared by their scan's ids, which only the scan list maps a build id to.
  const source =
    named.kind === "scanBuild" ? await reportFetcher.findScanRun(named) : named;
  if (source.kind !== "scan") {
    return createErrorResponse(
      'compareWith compares Website Scanner runs: pass the newer run (scanId and scanRunId, or its report link) and compareWith: "previous" or the older run\'s scanRunId.',
    );
  }
  const preface =
    requested.kind === "link"
      ? [`Resolved the report link to ${describeSource(source)}.`]
      : [];

  let after = source.scanRunId;
  let before: string;
  let beforeDate: string | undefined;
  let againstPrevious: boolean;
  let reversed = false;
  if (compareWith === "previous") {
    const previous = await reportFetcher.previousScanRun(
      source.scanId,
      source.scanRunId,
    );
    if (!previous) {
      return createErrorResponse(
        `Run ${source.scanRunId} is the first run of scan ${source.scanId}; there is no earlier run to compare it with.`,
      );
    }
    before = String(previous.id);
    beforeDate = previous.scanDate;
    againstPrevious = true;
  } else {
    const other = await scanRunToCompare(reportFetcher, source, compareWith);
    if ("content" in other) return other;
    if (other.scanRunId === source.scanRunId) {
      return createErrorResponse(
        `compareWith names this run itself. Pass another run's scanRunId or link, or "previous".`,
      );
    }
    const { runs, complete } = await reportFetcher.scanRuns(source.scanId);
    const at = (id: string) => runs.findIndex((run) => String(run.id) === id);
    // A run id the scan's whole run list does not hold is another scan's run: the API would
    // refuse it with "Scan logs not found", which reads like a fault.
    if (complete && at(other.scanRunId) < 0) {
      return readBothToCompare(
        `Run ${other.scanRunId} is not a run of scan ${source.scanId}, so it is another scan's run: only runs of one scan are compared here.`,
        false,
        [
          sourceArgs(source),
          `scanRunId: "${other.scanRunId}" and its own scan's scanId`,
        ],
      );
    }
    // The older run is "before": by the run list's order, or by id when either is not in it.
    const [selfAt, otherAt] = [at(source.scanRunId), at(other.scanRunId)];
    reversed =
      selfAt >= 0 && otherAt >= 0
        ? otherAt < selfAt
        : Number(other.scanRunId) > Number(source.scanRunId);
    [after, before] = reversed
      ? [other.scanRunId, source.scanRunId]
      : [source.scanRunId, other.scanRunId];
    againstPrevious = at(after) >= 0 && at(before) === at(after) + 1;
    beforeDate = runs[at(before)]?.scanDate;
  }
  const run = (scanRunId: string): IssueSource => ({ ...source, scanRunId });

  // A failed or cancelled run has no results and exports an empty report: compared with it,
  // every issue of the other run would read as resolved (or new).
  const [status, beforeStatus] = await Promise.all([
    reportFetcher.reportStatus(run(after)),
    reportFetcher.reportStatus(run(before)),
  ]);
  const noResults = (runStatus: string | undefined) =>
    runStatus === "failed" || runStatus === "cancelled";
  if (noResults(status) || noResults(beforeStatus)) {
    const [failedRun, otherRun, failedStatus] = noResults(status)
      ? [after, before, status]
      : [before, after, beforeStatus];
    return failedScanRunResponse(
      config,
      source.scanId,
      failedRun,
      preface,
      () =>
        `compared with it, every issue of run ${otherRun} would read as ${failedRun === after ? "resolved" : "new"}, so the runs were not compared.`,
      "Compare two runs that completed, or fix the cause and scan again.",
      failedStatus === "cancelled" ? "cancelled" : "failed",
    );
  }
  for (const [id, runStatus] of [
    [after, status],
    [before, beforeStatus],
  ] as const) {
    if (runStatus && PROCESSING_STATUSES.has(runStatus)) {
      return notReadyToCompare(
        `Run ${id} of Website Scanner scan ${source.scanId}`,
        runStatus,
        preface,
      );
    }
  }

  const read = await diffExports(
    reportFetcher,
    run(after),
    run(before),
    "runs",
    context,
  );
  if ("content" in read) return read;
  const { links, diff } = read;
  const changes = againstPrevious
    ? await reportFetcher.changesSinceLastRun(source.scanId, after)
    : undefined;

  const baseLabel = againstPrevious
    ? `the run before it, run ${before}${beforeDate ? ` (${beforeDate})` : ""}`
    : `run ${before}`;
  const matched = `${diff.added.length} new, ${diff.resolved.length} resolved, ${diff.retained} still open`;
  const listed = (issues: RunIssue[]) =>
    comparedList(issues, issues.length, "; see the CSV links");
  return createSuccessResponse([
    ...preface,
    `Compared Website Scanner scan ${source.scanId}: run ${after} with ${baseLabel}.`,
    ...(reversed
      ? ["compareWith was the newer run, so it is used as 'after'."]
      : []),
    changes
      ? `The dashboard's comparison: ${changes.newIssues} new, ${changes.resolvedIssues} resolved, ${changes.retainedIssues} still open. Matching the issues by rule, element and page gives ${matched}.`
      : `Matching the issues by rule, element and page: ${matched}.`,
    ...pagesNotLoadedNote(diff, `run ${after}`, `run ${before}`, "run"),
    `New issues: ${listed(diff.added)}`,
    `Resolved issues: ${listed(diff.resolved)}`,
    ...(diff.not_checked?.length
      ? [`Not checked (page did not load): ${listed(diff.not_checked)}`]
      : []),
    ...(diff.not_checked_earlier?.length
      ? [
          `Not checked against the earlier run (page did not load in run ${before}): ${listed(diff.not_checked_earlier)}`,
        ]
      : []),
    `CSV of each run, valid for about 12 hours: newer ${links[0]} , older ${links[1]}`,
  ]);
}

/**
 * Why advanced or experimental rules came back off when they were not asked off. Both are
 * on unless turned off, and on an API scan a plan without them turns them off instead of
 * refusing the scan, so the settings line alone reads as if the scan ran as asked. Asked
 * off, or not read back, there is nothing to explain.
 */
function planDowngradeNote(asked: ScanSettings, applied: ScanSettings): string {
  const off = [
    {
      name: "advanced rules",
      asked: asked.advancedRules,
      ran: applied.advancedRules,
    },
    {
      name: "experimental rules",
      asked: asked.experimentalRules,
      ran: applied.experimentalRules,
    },
  ].filter((rules) => rules.asked !== false && rules.ran === false);
  if (!off.length) return "";
  const names = (wanted: boolean | undefined) =>
    off
      .filter((rules) => rules.asked === wanted)
      .map((rules) => rules.name)
      .join(" and ");
  const askedFor = names(true);
  const byDefault = names(undefined);
  const expected = [
    askedFor ? `${askedFor} were asked for` : "",
    byDefault ? `${byDefault} are on by default` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return (
    `${expected[0].toUpperCase()}${expected.slice(1)}, but this scan ran without them, ` +
    "most likely because this account's Accessibility plan does not include them: " +
    "BrowserStack then runs the scan at the plan's level instead of refusing it. " +
    "The issues found do not include those rules."
  );
}

/**
 * What the scan ran with, read back from the run, since an unset setting takes the API's
 * default and the plan can turn advanced rules off. When it cannot be read, only what was
 * asked for is said: a guessed default would be stated as fact.
 */
function scanSettingsNote(
  asked: ScanSettings,
  applied: ScanSettings | undefined,
): string {
  const describe = (settings: ScanSettings) =>
    [
      settings.wcagVersion !== undefined ? wcagName(settings.wcagVersion) : "",
      settings.bestPractices !== undefined
        ? `best practices ${onOff(settings.bestPractices)}`
        : "",
      settings.needsReview !== undefined
        ? `needs review ${onOff(settings.needsReview)}`
        : "",
      settings.advancedRules !== undefined
        ? `advanced rules ${onOff(settings.advancedRules)}`
        : "",
      settings.experimentalRules !== undefined
        ? `experimental rules ${onOff(settings.experimentalRules)}`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
  if (applied && describe(applied)) {
    return [
      `Scan settings, as the scan ran: ${describe(applied)}.`,
      planDowngradeNote(asked, applied),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return describe(asked)
    ? `Scan settings asked for: ${describe(asked)}; anything not asked for takes the scan's default.`
    : "No scan settings were asked for, so the scan's defaults apply.";
}

async function executeAccessibilityScan(
  args: ScanArgs,
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
    if (args.scanId !== undefined) {
      return await rerunAccessibilityScan(
        { ...args, scanId: args.scanId },
        context,
        config,
      );
    }
    return await startNewScan(args, context, config);
  } catch (error) {
    // An expected limit, such as a local URL the hosted MCP cannot reach, the plan's scan
    // limit, or a re-run that cannot start: its message says what to do instead, so it is a
    // plain result, not an error to report.
    if (error instanceof ScanRefusedError) {
      trackMCP(
        "startAccessibilityScan",
        server.server.getClientVersion()!,
        error,
        config,
      );
      return { content: [{ type: "text", text: error.message }] };
    }
    return handleMCPError("startAccessibilityScan", server, config, error);
  }
}

function startNewScan(
  args: ScanArgs,
  context: ScanProgressContext,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  return runAccessibilityScan(
    args.name,
    args.pageURL,
    context,
    config,
    args.authConfigId,
    {
      wcagVersion: args.wcagVersion,
      bestPractices: args.bestPractices,
      needsReview: args.needsReview,
      advancedRules: args.advancedRules,
      experimentalRules: args.experimentalRules,
    },
    args.localIdentifier,
  );
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

/** Why the scan's name differs from the one asked for, as the start of a sentence. */
function renameReason(
  name: string,
  changes: ("characters" | "taken")[],
): string {
  const characters = changes.includes("characters");
  const taken = changes.includes("taken");
  if (characters && taken)
    return `The name "${name}" has characters scan names can't contain, and the cleaned name was already taken`;
  if (characters)
    return `The name "${name}" has characters scan names can't contain`;
  return `A scan named "${name}" already exists on this account`;
}

/**
 * A failed run, with the reason the API gives for it: the run's own and each page's. It used
 * to say only "The dashboard says why", which left an agent nothing to tell the user.
 */
function createScanFailureResponse(
  name: string,
  status: string,
  scanId: string,
  scanRunId: string,
  dashboardLink: string | undefined,
  details: ScanFailureDetails = { pages: [] },
): CallToolResult {
  return createErrorResponse(
    [
      `❌ Accessibility scan "${name}" failed with status: ${status}. Scan ID: ${scanId} and Scan Run ID: ${scanRunId}.`,
      ...failureReasons(details),
      scanDashboardNote(dashboardLink, scanId),
    ].join("\n"),
  );
}

/**
 * The wait ran out, not the scan: it carries on server-side and its issues can be read once
 * it finishes. Not an error, so an agent comes back for the results instead of reporting a
 * failure, as it did when this read "Failed to start accessibility scan" with no ids.
 */
function createScanStillRunningResponse(
  name: string,
  scanId: string,
  scanRunId: string,
  dashboardLink: string | undefined,
  waitedMs: number,
  rerun = false,
): CallToolResult {
  return createSuccessResponse([
    `Accessibility scan "${name}" is still running after ${Math.round(waitedMs / 60000)} minutes, so this call stopped waiting for it. The scan was not cancelled: it carries on, and its issues can be read once it finishes. ${scanDashboardNote(dashboardLink, scanId)}`,
    `Scan ID: ${scanId} and Scan Run ID: ${scanRunId}`,
    `To read its issues, call fetchAccessibilityIssues with scanId "${scanId}" and scanRunId "${scanRunId}" once it has finished. ${rerun ? "Do not re-run the scan before this run finishes." : "Do not start the scan again: that starts a second scan."}`,
  ]);
}

function createScanSuccessResponse(
  name: string,
  report: Awaited<ReturnType<typeof parseAccessibilityReportFromCSV>>,
  scanId: string,
  scanRunId: string,
  reportUrl: string,
  dashboardLink: string | undefined,
  settings: ScanSettings = {},
  applied?: ScanSettings,
): CallToolResult {
  const cursor = report.next_page;
  const messages = [
    `Accessibility scan "${name}" completed. ${scanDashboardNote(dashboardLink, scanId)}`,
    `Scan ID: ${scanId} and Scan Run ID: ${scanRunId}`,
    // The parser leaves an error page's rows out of the count; this says why.
    ...errorPagesNote(report.error_pages ?? [], "scan again"),
    scanSettingsNote(settings, applied),
    fullReportLine(reportUrl),
    `We found ${report.total_issues} issues. Below are the details of the ${report.page_length} most critical issues.`,
    ...webSummaryNote(report.summary, report.total_issues),
    ...excludedIssuesNote(
      report.duplicate_issues,
      report.unlinked_duplicates,
      report.hidden_issues,
    ),
    WEB_ISSUES_NOTE,
    `Scan results: ${wrapUntrusted("accessibility scan results", JSON.stringify({ issues: report.records, rules: report.rules }))}`,
  ];

  if (cursor !== null) {
    messages.push(
      `More issues available. Use fetchAccessibilityIssues tool with scanId: "${scanId}", scanRunId: "${scanRunId}", and cursor: ${cursor} to get the next batch.`,
    );
  }

  return createSuccessResponse(messages);
}

type ScanOutcome = "completed" | "still running" | "failed";

/**
 * Waits for a run that has started and gives its result: its issues, a failure with the
 * reasons the API gives, or its ids once the wait runs out. The same for a new scan and a
 * re-run, so a re-run reads like the scan it repeats.
 */
async function scanOutcome(
  scanner: AccessibilityScanner,
  config: BrowserStackConfig,
  context: ScanProgressContext,
  scan: {
    name: string;
    scanId: string;
    scanRunId: string;
    settings: ScanSettings;
    rerun?: boolean;
  },
): Promise<[CallToolResult, ScanOutcome]> {
  const { name: scanName, scanId, scanRunId, settings } = scan;
  let status: string;
  try {
    status = await scanner.waitUntilComplete(scanId, scanRunId, context);
  } catch (error) {
    if (!(error instanceof ScanTimeoutError)) throw error;
    return [
      createScanStillRunningResponse(
        scanName,
        scanId,
        scanRunId,
        await scanner.dashboardLink(scanId),
        error.waitedMs,
        scan.rerun,
      ),
      "still running",
    ];
  }
  if (status !== "completed") {
    const [dashboardLink, details] = await Promise.all([
      scanner.dashboardLink(scanId),
      scanner.failureDetails(scanId, scanRunId),
    ]);
    return [
      createScanFailureResponse(
        scanName,
        status,
        scanId,
        scanRunId,
        dashboardLink,
        details,
      ),
      "failed",
    ];
  }

  const [applied, dashboardLink] = await Promise.all([
    scanner.runSettings(scanId, scanRunId),
    scanner.dashboardLink(scanId),
  ]);
  const reportFetcher = await initializeReportFetcher(config);
  let reportLink: string;
  try {
    reportLink = await reportFetcher.getReportLink(
      { kind: "scan", scanId, scanRunId },
      { onWait: exportProgress(context) },
    );
  } catch (error) {
    if (error instanceof ExportPendingError) {
      return [
        createSuccessResponse([
          `Accessibility scan "${scanName}" completed. ${scanDashboardNote(dashboardLink, scanId)}`,
          `Scan ID: ${scanId} and Scan Run ID: ${scanRunId}`,
          scanSettingsNote(settings, applied),
          ...exportPendingMessages(
            {
              kind: "scan",
              scanId: String(scanId),
              scanRunId: String(scanRunId),
            },
            error,
            "",
          ),
        ]),
        "completed",
      ];
    }
    throw error;
  }

  return [
    createScanSuccessResponse(
      scanName,
      await parseAccessibilityReportFromCSV(reportLink),
      scanId,
      scanRunId,
      reportLink,
      dashboardLink,
      settings,
      applied,
    ),
    "completed",
  ];
}

async function runAccessibilityScan(
  name: string,
  pageURL: string,
  context: ScanProgressContext,
  config: BrowserStackConfig,
  authConfigId?: number,
  settings: ScanSettings = {},
  localIdentifier?: string,
): Promise<CallToolResult> {
  const scanner = await initializeScanner(config);

  const startResp = await scanner.startScan(
    name,
    [pageURL],
    authConfigId,
    settings,
    localIdentifier,
  );
  const scanId = startResp.data!.id;
  const scanRunId = startResp.data!.scanRunId;
  const scanName = startResp.scanName ?? name;

  await notifyScanProgress(
    context,
    `Accessibility scan "${scanName}" started`,
    0,
  );

  const [result] = await scanOutcome(scanner, config, context, {
    name: scanName,
    scanId,
    scanRunId,
    settings,
  });
  // The rename is said first, so the name asked for is not taken for the scan's.
  return withNotes(
    result,
    scanName === name
      ? []
      : [
          `${renameReason(name, startResp.nameChanges ?? ["taken"])}, so this scan was started as "${scanName}".`,
        ],
    // A local page this MCP tunnelled itself is saved with an identifier nobody was shown,
    // so a re-run could not reach it: no hint to re-run it.
    isLocalURL(pageURL) && !localIdentifier ? [] : [rescanHint(String(scanId))],
  );
}

/**
 * A re-run of the scan the caller names, when it is for this same page: a new run of that
 * scan, with its saved settings, which can be compared with its earlier runs. A scan for
 * another page gets a new scan, as without scanId, and settings passed that the saved ones
 * do not match stop the run, since a re-run cannot take them.
 */
async function rerunAccessibilityScan(
  args: ScanArgs & { scanId: string },
  context: ScanProgressContext,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const scanner = await initializeScanner(config);
  const { scanId, pageURL } = args;
  const saved = await scanner.savedScan(scanId);
  if (saved.urlList.length !== 1 || !sameScanPage(saved.urlList[0], pageURL)) {
    return withNotes(await startNewScan(args, context, config), [
      otherPageNote(scanId, saved.urlList, pageURL),
    ]);
  }

  // The saved scan reaches its page through a tunnel whose identifier the API does not give
  // back: without one passed, the re-run could not reach the page.
  if (saved.localTestingEnabled && args.localIdentifier === undefined) {
    return withNotes(await startNewScan(args, context, config), [
      localScanNotRerunNote(scanId),
    ]);
  }

  const name = saved.name ?? args.name;
  // The saved name is the account's, which another user may have set: quoted, not inlined.
  const nameLine = saved.name
    ? [`Scan name: ${wrapUntrusted("saved scan name", saved.name)}`]
    : [];
  const differences = savedSettingDifferences(args, saved);
  if (differences.length) {
    const one = differences.length === 1;
    // A plain result: nothing failed, and the call only has to be made again one way or
    // the other.
    return createSuccessResponse([
      [
        `Scan ${scanId} was not re-run: a re-run uses the scan's saved settings, and ${one ? "this one differs" : "these differ"} from what was passed:`,
        ...nameLine,
        ...differences.map((difference) => `- ${difference}`),
        `To re-run it with its saved settings, call startAccessibilityScan again with scanId "${scanId}" and without ${one ? "that setting" : "those settings"}. To scan with the settings passed, call it without scanId: that starts a new scan, whose runs can't be compared with this scan's.`,
      ].join("\n"),
    ]);
  }

  const { scanRunId } = await scanner.rerunScan(scanId);
  const passedName = args.name.trim();
  const unchecked = uncheckedSettings(args, saved);
  const lead = [
    `Started a new run (${scanRunId}) of scan ${scanId} with its saved settings.`,
    ...nameLine,
    ...(passedName &&
    passedName !== name &&
    cleanScanName(passedName, "") !== name
      ? [
          `The scan keeps its saved name; the name "${passedName}" was not used.`,
        ]
      : []),
    ...(saved.localTestingEnabled
      ? [localRerunNote(args.localIdentifier)]
      : []),
    ...(unchecked.length
      ? [
          `${unchecked.join(", ")} could not be checked against the scan's saved settings, which the API does not give back; the run uses the saved ones.`,
        ]
      : []),
    ...unusedLoginAndTunnel(args, saved),
  ];
  await notifyScanProgress(
    context,
    `Run ${scanRunId} of accessibility scan "${name}" started`,
    0,
  );
  const [result, outcome] = await scanOutcome(scanner, config, context, {
    name,
    scanId,
    scanRunId,
    settings: saved.settings,
    rerun: true,
  });
  const compare = compareHint(scanId, scanRunId);
  return withNotes(
    result,
    lead,
    outcome === "completed"
      ? [compare]
      : outcome === "still running"
        ? [`Once it finishes: ${compare[0].toLowerCase()}${compare.slice(1)}`]
        : [],
  );
}

export default function addAccessibilityTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.accessibilityExpert = server.tool(
    "accessibilityExpert",
    "Answer accessibility, a11y, and WCAG questions using BrowserStack's accessibility knowledge base.",
    {
      query: z
        .string()
        .describe(
          "Any accessibility, a11y, WCAG, or web accessibility question",
        ),
    },
    {
      title: "Accessibility Expert",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      return await executeAccessibilityRAG(args, server, config);
    },
  );

  tools.startAccessibilityScan = server.tool(
    "startAccessibilityScan",
    "Scan a web page URL for accessibility issues and get a CSV report. For a mobile app, run it on App Automate with accessibility on (setupBrowserStackAppAutomateTests), then fetchAccessibilityIssues.",
    {
      name: z.string().describe("Name of the scan"),
      pageURL: z.string().describe("URL of the page to scan"),
      scanId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Only to re-run an earlier scan of this same page (e.g. after a fix), with its saved settings, so runs can be compared.",
        ),
      authConfigId: z
        .number()
        .optional()
        .describe("Auth config ID, for a page behind a login"),
      localIdentifier: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "ID of a BrowserStack Local tunnel you started, for localhost or internal URLs.",
        ),
      advancedRules: z
        .boolean()
        .optional()
        .describe(
          "Run advanced rules (default true; off if the plan lacks them).",
        ),
      wcagVersion: z
        .enum(Object.keys(WCAG_VERSIONS) as [keyof typeof WCAG_VERSIONS])
        .optional()
        .describe(
          'WCAG level, e.g. "wcag22aa" or "rgaa41" (default "wcag21aa").',
        ),
      bestPractices: z
        .boolean()
        .optional()
        .describe("Also report best-practice issues (default false)."),
      needsReview: z
        .boolean()
        .optional()
        .describe(
          'Also report "needs review" issues to check by hand (default true).',
        ),
      experimentalRules: z
        .boolean()
        .optional()
        .describe(
          "Run experimental rules (default true; off if the plan lacks them).",
        ),
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
      name: z.string().describe("Name for the auth config"),
      type: z
        .enum(["form", "basic"])
        .describe("'form' for a login form, 'basic' for HTTP basic auth"),
      url: z.string().describe("URL of the login page"),
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
    "Get an accessibility auth config by ID." + NEEDS_A11Y_CONFIG_ID,
    {
      configId: z.number().describe("ID of the auth config"),
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
        .describe(
          "Website Scanner scan id (startAccessibilityScan or searchCapability).",
        ),
      scanRunId: z
        .string()
        .optional()
        .describe(
          "Website Scanner run id (startAccessibilityScan or searchCapability).",
        ),
      buildId: z
        .string()
        .regex(/^[a-z0-9]{40}$/, "40 lowercase letters and digits")
        .optional()
        .describe(
          "Web/App Accessibility build id: SDK testhub id or a link's thBuildId.",
        ),
      workflowReportId: z
        .string()
        .optional()
        .describe(
          "Workflow Analyzer report id, from its link or searchCapability.",
        ),
      appReportId: z
        .string()
        .regex(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          "A manual report id is a UUID",
        )
        .optional()
        .describe(
          "Manual App Accessibility report UUID, from its /report/ link.",
        ),
      reportUrl: z
        .string()
        .optional()
        .describe(
          "Any web/app accessibility report, scanner share, or Automate link.",
        ),
      cursor: z
        .number()
        .optional()
        .describe(
          "The next_page value from the previous answer (default 0), not an issue index.",
        ),
      pageUrl: z
        .string()
        .optional()
        .describe("Only the issues on this page URL."),
      compareWith: z
        .string()
        .optional()
        .describe(
          '"previous" (any report), or a run of the same scan or a web/app build: its id or link.',
        ),
      exportTaskId: z
        .string()
        .optional()
        .describe("Continue a CSV export that is still being generated."),
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

  return tools;
}
