import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  AccessibilityScanner,
  ScanRefusedError,
  ScanTimeoutError,
  cleanScanName,
  samePage as sameScanPage,
  type SavedScan,
  type ScanFailureDetails,
  type ScanSettings,
} from "./accessiblity-utils/scanner.js";
import {
  AccessibilityReportFetcher,
  EXPORT_WAIT_MS,
  ExportPendingError,
  ScanNotInListError,
  ScanRunNotFoundError,
  scanRunLink,
  type IssueSource,
  type WebBuild,
  type WebBuildComparison,
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
import { NO_FEEDBACK_HINT } from "../lib/feedback-hint.js";
import { trackMCP } from "../lib/instrumentation.js";
import {
  compareIssues,
  loadMainIssues,
  parseAccessibilityReportFromCSV,
  samePage,
  type ErrorPage,
  type IssueSummary as WebIssueSummary,
  type RunIssue,
} from "./accessiblity-utils/report-parser.js";
import { wrapUntrusted } from "../lib/untrusted-content.js";
import { queryAccessibilityRAG } from "./accessiblity-utils/accessibility-rag.js";
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

/**
 * The message as a sentence: a full stop is added only when it does not already end in
 * one (or in "!", "?" or "…", before any closing quote or bracket), so a message that
 * ends in a full stop does not end in "..".
 */
function asSentence(message: string): string {
  const text = message.trim();
  return /[.!?…]["'”’)\]]*$/.test(text) ? text : `${text}.`;
}

/**
 * Refusals the user resolves on their own account, with what to tell them. The API's own
 * words ("You do not have access to External APIs", "user info missing") read like faults,
 * so agents retried, renamed the scan, or reported them with submitFeedback. Each pattern
 * is the API's message as logged in telemetry.
 */
function accountRefusal(message: string): string | undefined {
  const scanLimit = message.match(/make over (\d+) scans/i);
  if (scanLimit) {
    return `This account has reached its plan's limit of ${scanLimit[1]} saved Website Scanner scans, so no new scan can be started. To scan again, delete scans that are no longer needed under Website Scanner in the Accessibility dashboard (https://accessibility.browserstack.com/site-scanner), or upgrade the plan. This is a plan limit, not a fault: tell the user, and do not retry or start the scan under another name.`;
  }
  if (/access to External APIs/i.test(message)) {
    return "This account's BrowserStack plan does not include the External APIs add-on, which the MCP's accessibility tools need: they work through the Accessibility API. Scans can still be run and read in the Accessibility dashboard (https://accessibility.browserstack.com). To use them from here, the account admin can add External APIs to the plan through BrowserStack sales. This is a plan limit, not a fault: tell the user, and do not retry.";
  }
  if (/user info missing/i.test(message)) {
    return "Website Scanner has not set this user up yet: it does that the first time they open Website Scanner in the Accessibility dashboard, and refuses its API until then. Ask the user to open https://accessibility.browserstack.com/site-scanner once while signed in to BrowserStack, then start the scan again.";
  }
  return undefined;
}

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
    return Object.assign(
      createErrorResponse(`${refusal}\nBrowserStack said: ${errorMessage}`),
      { [NO_FEEDBACK_HINT]: true },
    );
  }
  return createErrorResponse(
    `Failed to ${toolName.replace(/([A-Z])/g, " $1").toLowerCase()}: ${asSentence(errorMessage)} Please open an issue on GitHub if the problem persists`,
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

/** The longest question the accessibility knowledge base takes; longer ones are refused. */
export const EXPERT_QUERY_MAX_CHARS = 500;

/** The opening of `text` within `max` characters, cut at a word break when one is near. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text.trimEnd();
  const head = text.slice(0, max);
  const lastBreak = head.search(/\s\S*$/);
  return (lastBreak > max * 0.6 ? head.slice(0, lastBreak) : head).trimEnd();
}

/**
 * A question the knowledge base will take. It refuses anything over 500 characters
 * ("Query is too long"), and agents writing a detailed question hit that: two refusals on
 * 4 Nov alone. Agents put the question itself last, after the context, so a longer one
 * keeps its last sentence and as much of its opening as fits around it.
 */
function fitExpertQuery(query: string): { query: string; shortened: boolean } {
  if (query.length <= EXPERT_QUERY_MAX_CHARS)
    return { query, shortened: false };
  const text = query.trim();
  const sentences = text.match(/[^.?!]+(?:[.?!]+["')\]]*\s*|$)/g) ?? [text];
  const last = sentences[sentences.length - 1].trim();
  const gap = " … ";
  if (sentences.length < 2 || last.length > EXPERT_QUERY_MAX_CHARS * 0.6) {
    return { query: cutAtWord(text, EXPERT_QUERY_MAX_CHARS), shortened: true };
  }
  const opening = text.slice(0, text.length - last.length);
  const room = EXPERT_QUERY_MAX_CHARS - last.length - gap.length;
  return { query: `${cutAtWord(opening, room)}${gap}${last}`, shortened: true };
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
    const { query, shortened } = fitExpertQuery(args.query);
    const answer = await queryAccessibilityRAG(query, config);
    if (!shortened) return answer;
    return {
      ...answer,
      content: [
        {
          type: "text",
          text: `The question was ${args.query.length} characters; the knowledge base takes at most ${EXPERT_QUERY_MAX_CHARS}, so ${query.length} were sent: its opening and its last sentence. If the answer misses the point, ask again more briefly.`,
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

/** The arguments that name the same source again, for the next-page hint. */
function sourceArgs(source: IssueSource): string {
  switch (source.kind) {
    case "scan":
      return `scanId: "${source.scanId}", scanRunId: "${source.scanRunId}"`;
    // A run read by its build id is named by its link again, or, given as a build id, by that.
    case "scanBuild":
      return source.scanName !== undefined
        ? `reportUrl: "${scanRunLink(source)}"`
        : `buildId: "${source.thBuildId}"`;
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
    case "scanBuild":
      return `Website Scanner run with build id ${source.thBuildId}`;
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
 * Of those, the processing after the run: a web report's advanced issues while "finalizing",
 * an app build's rules while "rule_processing". It usually ends within a few minutes, but a
 * first read no longer waits for it inside the call. It used to wait up to five minutes and
 * then read the export, and a client cuts off a call that long: the claude.ai connector
 * aborts a tool call silent for 305 s, progress notifications or not. Every such call left
 * the agent with nothing, and one reported a fix as verified that had added 26 issues. So
 * the read says the report is not ready, and to call again, which any client handles.
 */
const FINALIZING_STATUSES = new Set(["finalizing", "rule_processing"]);

interface ProcessingState {
  /** The report's status when its issues were read; undefined when it could not be read. */
  status?: string;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
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
 * The answer for a first read of a report still finalizing: not ready yet, and when to come
 * back. Not an error, since nothing failed, but it says outright that no issues were read,
 * so an empty answer cannot be taken for a clean page.
 */
function stillFinalizingResponse(
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

/** What a report compareWith has no compare for says first. */
const NO_BUILT_IN_COMPARE = {
  workflow: "Workflow Analyzer reports have no built-in compare.",
  appReport: "App Accessibility manual reports have no built-in compare.",
} as const;

/**
 * Two reports compareWith has no compare for are compared by reading both. This is said as
 * guidance, not as an error, so the agent goes straight to the two reads. An app issue is
 * matched by its element, not its screen, as a fix can renumber the screens.
 */
function readBothToCompare(
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
function notReadyToCompare(
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
async function previousReportToCompare(
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

/**
 * A build id no API knows, after the scan list was searched for it (`scanList`) or the API
 * that reads runs by build id said it has none. The id is the user's to check, so this is a
 * plain answer naming what to pass instead, not a fault to report.
 */
function buildIdNotFound(
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
async function noReportYetResponse(
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

/**
 * Pages that did not load: an error page (Chrome's, or BrowserStack Local's when the tunnel
 * is not connected) was scanned in their place, and its issues came back as theirs. The
 * report parser leaves them out of the issues and the total; this says so.
 */
function errorPagesNote(pages: ErrorPage[], again: string): string[] {
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
async function failedRunResponse(
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
 * The pages of the newer run that did not load (an error page was scanned in their place),
 * or whose earlier issues all gave way to new ones. Neither the scan nor the dashboard says
 * so, and their real issues would otherwise read as fixed.
 */
function pagesNotLoadedNote(
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
const COMPARE_LIST_LIMIT = 50;

/**
 * One list of a comparison, at most COMPARE_LIST_LIMIT of it, quoted as data: its rows come
 * from the reports. `total` counts the whole list where only its first issues were read;
 * `rest` says where the ones not listed are.
 */
function comparedList(
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
async function diffExports(
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

type ScanRunSource = { kind: "scan"; scanId: string; scanRunId: string };

/**
 * The run of this scan that compareWith names: its scanRunId, or its report link or build id,
 * which are resolved as a source is. A link or id that names anything else (another scan's
 * run, a build, a report) has no built-in compare with a Scanner run: that is answered with
 * how to compare them by reading both, naming each read's arguments.
 */
async function scanRunToCompare(
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

  // A failed run scanned no page and exports an empty report: compared with it, every issue
  // of the other run would read as resolved (or new).
  const [status, beforeStatus] = await Promise.all([
    reportFetcher.reportStatus(run(after)),
    reportFetcher.reportStatus(run(before)),
  ]);
  if (status === "failed" || beforeStatus === "failed") {
    const [failedRun, otherRun] =
      status === "failed" ? [after, before] : [before, after];
    return failedScanRunResponse(
      config,
      source.scanId,
      failedRun,
      preface,
      () =>
        `compared with it, every issue of run ${otherRun} would read as ${failedRun === after ? "resolved" : "new"}, so the runs were not compared.`,
      "Compare two runs that completed, or fix the cause and scan again.",
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

/** A web build in prose: its number and id. Its name is the user's own, so it goes in data. */
function webBuildRef(build: WebBuild): string {
  return `build ${build.buildNumber !== undefined ? `#${build.buildNumber} ` : ""}(${build.buildId}${build.startedAt ? `, started ${build.startedAt}` : ""})`;
}

/** Web builds' names, projects, numbers, ids and starts, quoted as data. */
function webBuildsData(builds: Record<string, WebBuild>): string {
  const data = Object.fromEntries(
    Object.entries(builds).map(([role, b]) => [
      role,
      {
        name: b.name,
        project: b.projectName,
        build_number: b.buildNumber,
        id: b.buildId,
        started: b.startedAt,
      },
    ]),
  );
  return `Builds: ${wrapUntrusted("Automated Tests builds", JSON.stringify(data, null, 2))}`;
}

/**
 * A build the build list calls `failed` completed with no test cases, so it has no
 * accessibility results: there is nothing to compare it with, which is said as guidance.
 */
function noResultsToCompare(
  build: WebBuild,
  builds: Record<string, WebBuild>,
  previous = false,
): CallToolResult {
  const ref = webBuildRef(build);
  const which = previous
    ? `The run before this build with the same build name and project ("previous") is ${ref}, which`
    : `${ref[0].toUpperCase()}${ref.slice(1)}`;
  return createSuccessResponse([
    `${which} has no accessibility results: its status is failed, which Automated Tests gives a build that completed with no test cases. There is nothing to compare; compare with another build, or run the tests again with accessibility on.`,
    webBuildsData(builds),
  ]);
}

/** The three lists of a web build comparison, and what is set apart from them. */
interface WebCompareLists {
  counts: { new: number; fixed: number; open: number };
  new: RunIssue[];
  fixed: RunIssue[];
  open: RunIssue[];
  /** Where only the first issues of a list were read: its count, to say how many more. */
  totals?: { new: number; fixed: number; open: number };
  /** What did not load, said before the lists. */
  warnings: string[];
  /** The issues set apart because their page did not load, listed after them. */
  setApart: string[];
  /** Where the issues not listed are. */
  rest: string;
  closing: string[];
}

function webComparisonMessages(
  head: string[],
  lists: WebCompareLists,
): CallToolResult {
  const { counts, totals = lists.counts } = lists;
  return createSuccessResponse([
    ...head,
    `${counts.new} new, ${counts.fixed} fixed, ${counts.open} still open.`,
    ...lists.warnings,
    `New (only in the later build) (${counts.new}): ${comparedList(lists.new, totals.new, lists.rest)}`,
    `Fixed (only in the earlier build) (${counts.fixed}): ${comparedList(lists.fixed, totals.fixed, lists.rest)}`,
    `Still open (in both) (${counts.open}): ${comparedList(lists.open, totals.open, lists.rest)}`,
    ...lists.setApart,
    ...lists.closing,
  ]);
}

/**
 * The compare API's comparison as lists. Issues found on an error page are set apart: the
 * page did not load, so they say nothing about the page. The API counts them in its lists.
 */
function apiComparisonLists(comparison: WebBuildComparison): WebCompareLists {
  const { counts, issues } = comparison;
  const loaded = (rows: RunIssue[]) => rows.filter((r) => !r.on_error_page);
  // A list's issues not read count as more; those set apart are listed below.
  const more = (rows: RunIssue[], count: number) =>
    loaded(rows).length + Math.max(0, count - rows.length);
  const apart = [
    ...issues.new.map((r) => ({ ...r, list: "new" })),
    ...issues.resolved.map((r) => ({ ...r, list: "fixed" })),
    ...issues.retained.map((r) => ({ ...r, list: "still open" })),
  ].filter((r) => r.on_error_page);
  return {
    counts: {
      new: counts.new,
      fixed: counts.resolved,
      open: counts.retained,
    },
    new: loaded(issues.new),
    fixed: loaded(issues.resolved),
    open: loaded(issues.retained),
    totals: {
      new: more(issues.new, counts.new),
      fixed: more(issues.resolved, counts.resolved),
      open: more(issues.retained, counts.retained),
    },
    warnings:
      apart.length > 0
        ? [
            `⚠️ ${apart.length === 1 ? "1 issue listed was" : `${apart.length} issues listed were`} found on an error page (BrowserStack Local's connection page or Chrome's network error page) scanned in place of a page that did not load. ${apart.length === 1 ? "It is" : "They are"} set apart below as "page did not load", not listed as new, fixed or still open; the counts above include ${apart.length === 1 ? "it" : "them"}. Run the tests again once the page loads.`,
          ]
        : [],
    setApart:
      apart.length > 0
        ? [`Page did not load (${apart.length}): ${comparedList(apart)}`]
        : [],
    rest: "",
    closing: [],
  };
}

/** Two web builds' CSV exports matched by rule, element and page, as lists. */
function diffComparisonLists(
  {
    links,
    diff,
  }: { links: [string, string]; diff: ReturnType<typeof compareIssues> },
  before: WebBuild,
  after: WebBuild,
): WebCompareLists {
  // Two builds of different names can share a number, so the id is said too.
  const label = (b: WebBuild) =>
    `build ${b.buildNumber !== undefined ? `#${b.buildNumber} ` : ""}(${b.buildId})`;
  return {
    counts: {
      new: diff.added.length,
      fixed: diff.resolved.length,
      open: diff.still_open.length,
    },
    new: diff.added,
    fixed: diff.resolved,
    open: diff.still_open,
    warnings: pagesNotLoadedNote(diff, label(after), label(before), "build"),
    setApart: [
      ...(diff.not_checked.length
        ? [
            `Not checked (page did not load in ${label(after)}): ${comparedList(diff.not_checked)}`,
          ]
        : []),
      ...(diff.not_checked_earlier.length
        ? [
            `Not checked against the earlier build (page did not load in ${label(before)}): ${comparedList(diff.not_checked_earlier)}`,
          ]
        : []),
    ],
    rest: "; see the CSV links",
    closing: [
      `CSV of each build, valid for about 12 hours: later ${links[0]} , earlier ${links[1]}`,
    ],
  };
}

/** How an issue list is matched when the compare API does not compare the two builds. */
const MATCHED_BY_ELEMENT =
  "so the issue lists were matched by rule, element and page.";

/**
 * An Automated Tests build against another (its id or report link) or "previous", from the
 * older build ("before") to the newer ("after"), whichever order they were passed in. Two
 * builds of one build name and project are compared by the Automated Tests compare API, as
 * the dashboard compares them; any other pair, or one the API refuses or does not answer in
 * time, by matching their issue exports by rule, element and page, as Scanner runs are.
 */
async function compareWebBuilds(
  reportFetcher: AccessibilityReportFetcher,
  source: { kind: "build"; buildId: string },
  compareWith: string,
  preface: string[],
  context?: ScanProgressContext,
): Promise<CallToolResult> {
  const self = await reportFetcher.webBuild(source.buildId);
  if (!self) {
    throw new Error(`Could not read Automated Tests build ${source.buildId}`);
  }
  let other: WebBuild | undefined;
  if (compareWith !== "previous") {
    let named: IssueSource;
    try {
      named = await reportFetcher.resolveBuild(
        /^https?:\/\//i.test(compareWith)
          ? await reportFetcher.sourceFromReportUrl(compareWith)
          : { kind: "build", buildId: compareWith },
      );
    } catch (error) {
      return createErrorResponse(
        `compareWith: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
    if (named.kind !== "build") {
      return readBothToCompare(
        `compareWith names ${describeSource(named)}, which is not an Automated Tests build; an Automated Tests build is compared here only with another ("previous", or another build's id or link).`,
        false,
      );
    }
    if (named.buildId === source.buildId) {
      return createErrorResponse(
        `compareWith names this build itself. Pass another build's id or link, or "previous".`,
      );
    }
    other = await reportFetcher.webBuild(named.buildId);
    if (!other) {
      throw new Error(`Could not read Automated Tests build ${named.buildId}`);
    }
  }

  const [selfStatus, otherStatus] = await Promise.all([
    reportFetcher.reportStatus(source),
    other
      ? reportFetcher.reportStatus({ kind: "build", buildId: other.buildId })
      : undefined,
  ]);
  // The older build is "before": by start, whichever was passed as compareWith.
  const started = (b: WebBuild) => Date.parse(b.startedAt ?? "");
  const reversed = other !== undefined && started(other) > started(self);
  let before = reversed ? self : other;
  const after = reversed ? other! : self;
  const pair = (b: WebBuild | undefined): Record<string, WebBuild> =>
    b ? { before: b, after } : { after };
  for (const [build, status] of [
    [self, selfStatus],
    [other, otherStatus],
  ] as const) {
    if (build && status === "failed") {
      return noResultsToCompare(build, pair(before));
    }
  }
  const notReady = (build: WebBuild, status: string | undefined) =>
    status && PROCESSING_STATUSES.has(status)
      ? notReadyToCompare(
          `Automated Tests ${webBuildRef(build)}`,
          status,
          preface,
        )
      : undefined;
  const unfinished =
    notReady(self, selfStatus) ?? (other && notReady(other, otherStatus));
  if (unfinished) return unfinished;

  const head = (base: WebBuild, lines: string[]) => [
    ...preface,
    `Compared Automated Tests builds: before ${webBuildRef(base)}, after ${webBuildRef(after)}.`,
    ...(reversed
      ? ["compareWith was the newer build, so it is used as 'after'."]
      : []),
    ...lines,
    webBuildsData({ before: base, after }),
  ];

  let method: string;
  if (
    !before ||
    (before.name === after.name && before.projectName === after.projectName)
  ) {
    const compared = await reportFetcher.compareWebBuilds(
      after.buildId,
      before?.buildId,
      COMPARE_LIST_LIMIT,
    );
    if (!("refused" in compared)) {
      // The API's summary leaves the project out; the overview has it, and the status check
      // below reads the overview anyway.
      const base: WebBuild =
        before ??
        (await reportFetcher.webBuild(compared.base.buildId)) ??
        compared.base;
      if (!before) {
        const baseStatus = await reportFetcher.reportStatus({
          kind: "build",
          buildId: base.buildId,
        });
        if (baseStatus === "failed") {
          return noResultsToCompare(base, pair(base), true);
        }
        const baseUnfinished = notReady(base, baseStatus);
        if (baseUnfinished) return baseUnfinished;
      }
      return webComparisonMessages(
        head(base, [
          ...(before
            ? []
            : [
                `compareWith "previous": the compare API used the run before it with the same build name and project, ${webBuildRef(base)}.`,
              ]),
          "Same build name and project, so this is the Automated Tests compare API's comparison, as the dashboard shows it: issues are matched by the dashboard's own issue key (key below), not by rule, element and page alone.",
        ]),
        apiComparisonLists(compared),
      );
    }
    if (compared.noPrevious) {
      return createErrorResponse(
        `${webBuildRef(after)} is the first completed run of its build name in its project, so there is nothing earlier to compare it with. Pass another build's id or link as compareWith instead.`,
      );
    }
    if (!before) {
      const previous = await reportFetcher.previousWebBuild(after);
      if (!previous) {
        return createErrorResponse(
          `The compare API gave no comparison (${compared.refused}), and no earlier completed run of this build's name is among its project's newest builds. Pass the earlier build's id or link as compareWith instead.`,
        );
      }
      if (previous.status === "failed") {
        return noResultsToCompare(previous, pair(previous), true);
      }
      before = previous;
    }
    method = `The compare API gave no comparison (${compared.refused}), ${MATCHED_BY_ELEMENT}`;
  } else {
    method =
      before.name !== after.name
        ? `Different build names, ${MATCHED_BY_ELEMENT}`
        : `Different projects, ${MATCHED_BY_ELEMENT}`;
  }

  const read = await diffExports(
    reportFetcher,
    { kind: "build", buildId: after.buildId },
    { kind: "build", buildId: before.buildId },
    "builds",
    context,
  );
  if ("content" in read) return read;
  return webComparisonMessages(
    head(before, [
      ...(compareWith === "previous"
        ? [
            `compareWith "previous": the run before it with the same build name and project, ${webBuildRef(before)}.`,
          ]
        : []),
      method,
    ]),
    diffComparisonLists(read, before, after),
  );
}

/** The WCAG versions and levels Website Scanner checks against, and RGAA 4.1, by name. */
const WCAG_VERSIONS = {
  wcag2a: "WCAG 2.0 A",
  wcag2aa: "WCAG 2.0 AA",
  wcag2aaa: "WCAG 2.0 AAA",
  wcag21a: "WCAG 2.1 A",
  wcag21aa: "WCAG 2.1 AA",
  wcag21aaa: "WCAG 2.1 AAA",
  wcag22a: "WCAG 2.2 A",
  wcag22aa: "WCAG 2.2 AA",
  wcag22aaa: "WCAG 2.2 AAA",
  rgaa41: "RGAA 4.1",
} as const;

const wcagName = (value: string) =>
  WCAG_VERSIONS[value as keyof typeof WCAG_VERSIONS] ?? value;
const onOff = (value: boolean) => (value ? "on" : "off");

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

/** startAccessibilityScan's arguments, as the call passed them: a setting left out is undefined. */
type ScanArgs = {
  name: string;
  pageURL: string;
  scanId?: string;
  authConfigId?: number;
  localIdentifier?: string;
} & ScanSettings;

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

/**
 * Where to see a scan in the dashboard: its own page, as the scans list links it. A scan's
 * page is named by its build, so a link made from the scan's name does not open it.
 */
function scanDashboardNote(
  dashboardLink: string | undefined,
  scanId: string,
): string {
  return dashboardLink
    ? `Its page in the Accessibility dashboard: ${dashboardLink}`
    : `See it under Website Scanner in the Accessibility dashboard (scan ID ${scanId}).`;
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

/** How many failed pages a failure result lists before summing up the rest. */
const FAILED_PAGES_LISTED = 10;

/**
 * "N pages <what>:" and a line per page with its reason, the first FAILED_PAGES_LISTED of
 * them. The lines are the scan logs' (the page's address, the site's HTTP status, where it
 * redirected), so they are quoted as data.
 */
function pageReasons(
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
function failureReasons({ reason, pages }: ScanFailureDetails): string[] {
  const why = [
    reason ? `Why: ${wrapUntrusted("scan failure reason", reason)}` : "",
    pages.length
      ? pageReasons(pages, ["could not be scanned", "could not be scanned"])
      : "",
  ].filter(Boolean);
  return why.length ? why : ["The dashboard says why."];
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
 * A scan run that failed, read or compared. A run fails only when it scanned no page (or
 * the plan refused it), and its export is then an empty report: read as one, it said "0
 * issues ✅ All issues retrieved", and compared, every issue of the other run read as
 * resolved or new.
 */
async function failedScanRunResponse(
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

/**
 * The result with lines said before and after it. Each text block is made to end in a
 * newline, as createSuccessResponse's do, so a link that ends one block is not run into
 * the next by a client that joins blocks with no separator.
 */
function withNotes(
  result: CallToolResult,
  lead: string[],
  tail: string[] = [],
): CallToolResult {
  if (!lead.length && !tail.length) return result;
  const block = (text: string) => ({
    type: "text" as const,
    text: text.endsWith("\n") ? text : `${text}\n`,
  });
  return {
    ...result,
    content: [
      ...lead.map(block),
      ...result.content.map((c) => (c.type === "text" ? block(c.text) : c)),
      ...tail.map(block),
    ],
  };
}

/**
 * Said with every new scan. Re-scanning a page used to start another scan, and runs of two
 * scans cannot be compared; a run added to this scan can.
 */
function rescanHint(scanId: string): string {
  return `To scan this same page again later (e.g. after a fix), call startAccessibilityScan with scanId "${scanId}"; that adds a run to this scan so the runs can be compared with compareWith "previous".`;
}

function compareHint(scanId: string, scanRunId: string): string {
  return `To see what changed since the previous run, call fetchAccessibilityIssues with scanId "${scanId}", scanRunId "${scanRunId}" and compareWith "previous".`;
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
    [rescanHint(String(scanId))],
  );
}

/** Why a scan given by id is not re-run for this page: it was saved for another. */
function otherPageNote(
  scanId: string,
  urlList: string[],
  pageURL: string,
): string {
  if (!urlList.length) {
    return `Scan ${scanId}'s pages could not be read, so it could not be checked to be for ${pageURL}; a new scan was started.`;
  }
  if (urlList.length === 1) {
    return `Scan ${scanId} is for ${urlList[0]}, not ${pageURL}, so a new scan was started.`;
  }
  const shown = urlList.slice(0, 3).join(", ");
  const more = urlList.length > 3 ? `, and ${urlList.length - 3} more` : "";
  return `Scan ${scanId} is for ${urlList.length} pages (${shown}${more}), not just ${pageURL}, so a new scan was started.`;
}

/**
 * The settings a call passed that differ from the scan's saved ones. A re-run takes no
 * settings, so running it anyway would quietly drop what was asked for. Only settings the
 * call passed are compared (none has a default in the schema), and only against a saved
 * value the overview gives: it gives whether a login or Local is saved, not which one.
 */
function savedSettingDifferences(args: ScanArgs, saved: SavedScan): string[] {
  const differ = <T>(
    label: string,
    passed: T | undefined,
    savedValue: T | undefined,
    show: (value: T) => string,
  ) =>
    passed !== undefined && savedValue !== undefined && passed !== savedValue
      ? [`${label}: saved ${show(savedValue)}, passed ${show(passed)}`]
      : [];
  const { settings } = saved;
  return [
    ...differ("WCAG version", args.wcagVersion, settings.wcagVersion, wcagName),
    ...differ(
      "advanced rules",
      args.advancedRules,
      settings.advancedRules,
      onOff,
    ),
    ...differ(
      "experimental rules",
      args.experimentalRules,
      settings.experimentalRules,
      onOff,
    ),
    ...differ(
      "best practices",
      args.bestPractices,
      settings.bestPractices,
      onOff,
    ),
    ...differ("needs review", args.needsReview, settings.needsReview, onOff),
    ...(args.authConfigId !== undefined && saved.authEnabled === false
      ? [
          `login: the scan has no auth config saved, passed authConfigId ${args.authConfigId}`,
        ]
      : []),
    ...(args.localIdentifier !== undefined &&
    saved.localTestingEnabled === false
      ? [
          `BrowserStack Local: the scan is saved without a tunnel, passed localIdentifier "${args.localIdentifier}"`,
        ]
      : []),
  ];
}

/** Settings a call passed that the overview gives no saved value to check them against. */
function uncheckedSettings(args: ScanArgs, saved: SavedScan): string[] {
  const { settings } = saved;
  return [
    args.wcagVersion !== undefined && settings.wcagVersion === undefined
      ? "wcagVersion"
      : "",
    args.advancedRules !== undefined && settings.advancedRules === undefined
      ? "advancedRules"
      : "",
    args.experimentalRules !== undefined &&
    settings.experimentalRules === undefined
      ? "experimentalRules"
      : "",
    args.bestPractices !== undefined && settings.bestPractices === undefined
      ? "bestPractices"
      : "",
    args.needsReview !== undefined && settings.needsReview === undefined
      ? "needsReview"
      : "",
    // Which login is saved is not given: only whether one is.
    args.authConfigId !== undefined && saved.authEnabled !== false
      ? `authConfigId ${args.authConfigId}`
      : "",
    // Said in the Local note when the scan is saved with a tunnel.
    args.localIdentifier !== undefined &&
    saved.localTestingEnabled === undefined
      ? `localIdentifier "${args.localIdentifier}"`
      : "",
  ].filter(Boolean);
}

/**
 * A re-run reaches a local page through the tunnel the scan was saved with, by its
 * identifier, which the overview does not give back: the tunnel has to be running under
 * that identifier, or the run cannot reach the page.
 */
function localRerunNote(localIdentifier: string | undefined): string {
  return `This scan reaches its page through BrowserStack Local, and the run uses the scan's saved Local settings: a tunnel must be running with the same local identifier the scan was created with${
    localIdentifier
      ? ` (the API does not give the saved identifier back, so it could not be checked against "${localIdentifier}")`
      : " (the API does not give the saved identifier back)"
  }. If the run cannot reach the page, start that tunnel and re-run.`;
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

  const name = saved.name ?? args.name;
  const differences = savedSettingDifferences(args, saved);
  if (differences.length) {
    const one = differences.length === 1;
    // A plain result: nothing failed, and the call only has to be made again one way or
    // the other.
    return createSuccessResponse([
      [
        `Scan ${scanId} "${name}" was not re-run: a re-run uses the scan's saved settings, and ${one ? "this one differs" : "these differ"} from what was passed:`,
        ...differences.map((difference) => `- ${difference}`),
        `To re-run it with its saved settings, call startAccessibilityScan again with scanId "${scanId}" and without ${one ? "that setting" : "those settings"}. To scan with the settings passed, call it without scanId: that starts a new scan, whose runs can't be compared with this scan's.`,
      ].join("\n"),
    ]);
  }

  const { scanRunId } = await scanner.rerunScan(scanId);
  const passedName = args.name.trim();
  const unchecked = uncheckedSettings(args, saved);
  const lead = [
    `Started a new run (${scanRunId}) of scan ${scanId} "${name}" with its saved settings.`,
    ...(passedName &&
    passedName !== name &&
    cleanScanName(passedName, "") !== name
      ? [
          `The scan keeps its name "${name}"; the name "${passedName}" was not used.`,
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
          'Runs of one scan, web/app builds: "previous", scanRunId, build id/link. Others: read both.',
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
