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
    Boolean(args.reportUrl),
  ].filter(Boolean).length;
  if (named !== 1) {
    return "Pass exactly one source: scanId with scanRunId (a Website Scanner run), buildId (an Automated Tests build), workflowReportId (a Workflow Analyzer report) or reportUrl (a report's dashboard link).";
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
    if (args.compareWith) {
      return await compareScanRuns(source, args.compareWith, config, context);
    }
    return await fetchAccessibilityIssues(
      source,
      config,
      args.cursor,
      context,
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

/** How often, and for how long, a first read waits on a report that is still processing. */
export const REPORT_STATUS_POLL_MS = 10_000;
export const REPORT_STATUS_WAIT_MS = 5 * 60 * 1000;

/** Statuses during which a report's issues are still being added. */
const PROCESSING_STATUSES = new Set([
  "queued",
  "running",
  "processing",
  "finalizing",
]);

/**
 * Of those, the one worth waiting on: the advanced-issue processing after the run, which
 * ends within minutes. A report whose scan or tests are still running is read as it is,
 * with a note, since that can last as long as the suite does.
 */
const WAIT_STATUSES = new Set(["finalizing"]);

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

async function fetchAccessibilityIssues(
  requested: RequestedSource,
  config: BrowserStackConfig,
  cursor = 0,
  context?: ScanProgressContext,
  { pageUrl, exportTaskId }: { pageUrl?: string; exportTaskId?: string } = {},
): Promise<CallToolResult> {
  const reportFetcher = await initializeReportFetcher(config);
  const source =
    requested.kind === "link"
      ? await reportFetcher.sourceFromReportUrl(requested.reportUrl)
      : requested;
  const processing = await waitForProcessing(
    reportFetcher,
    source,
    cursor === 0,
    context,
  );
  const stillProcessing =
    processing.status !== undefined &&
    PROCESSING_STATUSES.has(processing.status);
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
    duplicate_issues,
    unlinked_duplicates,
    hidden_issues,
    page,
  } = await parseAccessibilityReportFromCSV(reportLink, {
    nextPage: cursor,
    pageUrl,
  });

  const currentlyShown =
    cursor === 0
      ? page_length
      : Math.floor(cursor / JSON.stringify(records[0] || {}).length) +
        page_length;
  const remainingIssues = total_issues - currentlyShown;

  const messages = [
    ...(requested.kind === "link"
      ? [`Resolved the report link to ${describeSource(source)}.`]
      : []),
    ...processingNote(processing),
    ...(page ? pageNote(page) : []),
    `Retrieved ${page_length} accessibility issues (Total: ${total_issues})`,
    ...excludedIssuesNote(duplicate_issues, unlinked_duplicates, hidden_issues),
    `You can also download the full report (CSV) from the following link, valid for about 12 hours: ${reportLink}`,
    `Issues: ${wrapUntrusted("accessibility scan results", JSON.stringify(records, null, 2))}`,
  ];

  if (next_page !== null) {
    messages.push(
      `${remainingIssues} more issues available. Use fetchAccessibilityIssues with ${sourceArgs(source)}${pageArg} and cursor: ${next_page} to get the next batch.`,
    );
  } else if (stillProcessing) {
    messages.push(
      `All issues found so far retrieved; the report is still processing.`,
    );
  } else {
    messages.push(`✅ All issues retrieved.`);
  }

  return createSuccessResponse(messages);
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
      ? ` Pages in this report with a similar address: ${page.similar_pages.join(", ")}.`
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
    "Start an accessibility scan via BrowserStack and retrieve a local CSV report path.",
    {
      name: z.string().describe("Name of the accessibility scan"),
      pageURL: z.string().describe("The URL to scan for accessibility issues"),
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
    "Fetch accessibility issues (paged by cursor) from one source: scanId+scanRunId, buildId, workflowReportId or reportUrl." +
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
          "Automated Tests: the thBuildId in the build's accessibility report link (not the Automate build id).",
        ),
      workflowReportId: z
        .string()
        .optional()
        .describe("Workflow Analyzer: the report's numeric id."),
      reportUrl: z
        .string()
        .optional()
        .describe(
          "A Website Scanner or Automated Tests report link: a dashboard link or a scanner share link.",
        ),
      cursor: z
        .number()
        .optional()
        .describe("Character offset for pagination (default: 0)"),
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
          'Website Scanner: "previous" or an older scanRunId of the same scan; returns new and resolved issues.',
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

  return tools;
}
