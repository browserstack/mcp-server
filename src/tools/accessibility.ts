import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AccessibilityScanner } from "./accessiblity-utils/scanner.js";
import {
  AccessibilityReportFetcher,
  type IssueSource,
} from "./accessiblity-utils/report-fetcher.js";
import type { AppBuildReport } from "./accessiblity-utils/app-report-fetcher.js";
import {
  AccessibilityAuthConfig,
  safeAuthConfigData,
} from "./accessiblity-utils/auth-config.js";
import { trackMCP } from "../lib/instrumentation.js";
import { parseAccessibilityReportFromCSV } from "./accessiblity-utils/report-parser.js";
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
    return await queryAccessibilityRAG(args.query, config);
  } catch (error) {
    return handleMCPError("accessibilityExpert", server, config, error);
  }
}

interface FetchIssuesArgs {
  scanId?: string;
  scanRunId?: string;
  buildId?: string;
  workflowReportId?: string;
  reportUrl?: string;
  cursor?: number;
}

/** A source named by its ids, or a dashboard link still to be resolved to them. */
type RequestedSource = IssueSource | { kind: "link"; reportUrl: string };

/** The one source the arguments name, or why they do not name exactly one. */
function issueSourceFrom(args: FetchIssuesArgs): RequestedSource | string {
  const named = [
    Boolean(args.scanId || args.scanRunId),
    Boolean(args.buildId),
    Boolean(args.workflowReportId),
    Boolean(args.reportUrl),
  ].filter(Boolean).length;
  if (named !== 1) {
    return "Pass exactly one source: scanId with scanRunId (a Website Scanner run), buildId (an Automated Tests or App Accessibility build), workflowReportId (a Workflow Analyzer report) or reportUrl (a report's dashboard link).";
  }
  if (args.reportUrl) return { kind: "link", reportUrl: args.reportUrl };
  if (args.buildId) return { kind: "build", buildId: args.buildId };
  if (args.workflowReportId) {
    return { kind: "workflow", reportId: args.workflowReportId };
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
    return await fetchAccessibilityIssues(source, config, args.cursor, context);
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

/** How many issues the pages after this one still hold (an estimate past the first page). */
function remainingIssues(
  cursor: number,
  page_length: number,
  total_issues: number,
  records: unknown[],
): number {
  const currentlyShown =
    cursor === 0
      ? page_length
      : Math.floor(cursor / JSON.stringify(records[0] || {}).length) +
        page_length;
  return total_issues - currentlyShown;
}

/** The last line: how to get the next page, or that there is none. */
function closingMessage(
  next_page: number | null,
  remaining: number,
  source: IssueSource,
  stillProcessing: boolean,
): string {
  if (next_page !== null) {
    return `${remaining} more issues available. Use fetchAccessibilityIssues with ${sourceArgs(source)} and cursor: ${next_page} to get the next batch.`;
  }
  if (stillProcessing) {
    return `All issues found so far retrieved; the report is still processing.`;
  }
  return `✅ All issues retrieved.`;
}

/**
 * Why a finished app build has no scans. Each cause here produced a run that finished
 * green with nothing scanned and no warning; they are listed most likely first, with what
 * the build's own details say ahead of the rest.
 */
function noScansNote(report: AppBuildReport): string[] {
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
    `No accessibility scans were recorded for App Accessibility build "${report.build_name}" (status: ${report.status}), so there are no issues to list. The usual causes, most likely first:`,
    ...causes.map((cause, i) => `${i + 1}. ${cause}`),
  ];
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
  const link = report.dashboard_link
    ? [
        `View the report on the App Accessibility dashboard: ${report.dashboard_link}`,
      ]
    : [];
  if (report.scan_count === 0 && !stillProcessing) {
    return [
      ...preface,
      ...processingNote(processing),
      ...noScansNote(report),
      ...link,
    ];
  }
  const { records, page_length, total_issues, next_page } = report;
  const screens = `${report.scan_count} screen${report.scan_count === 1 ? "" : "s"} scanned`;
  return [
    ...preface,
    ...processingNote(processing),
    `Retrieved ${page_length} accessibility issues (Total: ${total_issues}) from App Accessibility build "${report.build_name}" (${screens})`,
    ...excludedIssuesNote(null, 0, report.hidden_issues),
    ...link,
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify(records, null, 2))}`,
    closingMessage(
      next_page,
      remainingIssues(cursor, page_length, total_issues, records),
      source,
      stillProcessing,
    ),
  ];
}

async function fetchAccessibilityIssues(
  requested: RequestedSource,
  config: BrowserStackConfig,
  cursor = 0,
  context?: ScanProgressContext,
): Promise<CallToolResult> {
  const reportFetcher = await initializeReportFetcher(config);
  const named =
    requested.kind === "link"
      ? await reportFetcher.sourceFromReportUrl(requested.reportUrl)
      : requested;
  // A build id names a web build or a mobile app build; the APIs tell which.
  const source = await reportFetcher.resolveBuild(named);
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

  const reportLink = await reportFetcher.getReportLink(source);

  const {
    records,
    page_length,
    total_issues,
    next_page,
    duplicate_issues,
    unlinked_duplicates,
    hidden_issues,
  } = await parseAccessibilityReportFromCSV(reportLink, { nextPage: cursor });

  return createSuccessResponse([
    ...preface,
    ...processingNote(processing),
    `Retrieved ${page_length} accessibility issues (Total: ${total_issues})`,
    ...excludedIssuesNote(duplicate_issues, unlinked_duplicates, hidden_issues),
    `You can also download the full report (CSV) from the following link, valid for about 12 hours: ${reportLink}`,
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify(records, null, 2))}`,
    closingMessage(
      next_page,
      remainingIssues(cursor, page_length, total_issues, records),
      source,
      stillProcessing,
    ),
  ]);
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
  const reportLink = await reportFetcher.getReportLink({
    kind: "scan",
    scanId,
    scanRunId,
  });

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
    "Fetch accessibility issues from one source: scanId+scanRunId, buildId (web or app build), workflowReportId or reportUrl." +
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
      reportUrl: z
        .string()
        .optional()
        .describe(
          "A Website Scanner, Automated Tests or App Accessibility report link, or an App Automate build or session link.",
        ),
      cursor: z
        .number()
        .optional()
        .describe("Character offset for pagination (default: 0)"),
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
