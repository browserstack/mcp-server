import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AccessibilityScanner } from "./scanner.js";
import {
  EXPORT_WAIT_MS,
  scanRunLink,
  type IssueSource,
} from "./report-fetcher.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";

/*
 * Helpers of accessibility.ts that the answer and compare modules beside this file use too:
 * the response builders, how a report source is named, progress notifications, the scanner
 * client and the scan-settings names. They are moved here unchanged, so that those modules
 * and accessibility.ts do not import each other.
 */

interface AuthCredentials {
  username: string;
  password: string;
}

export interface ScanProgressContext {
  sendNotification: (notification: any) => Promise<void>;
  _meta?: {
    progressToken?: string | number;
  };
}

export function setupAuth(config: BrowserStackConfig): AuthCredentials {
  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");
  return { username, password };
}

export function createErrorResponse(message: string): CallToolResult {
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
export function createSuccessResponse(messages: string[]): CallToolResult {
  return {
    content: messages.map((text) => ({
      type: "text" as const,
      text: `${text}\n`,
    })),
  };
}

export async function notifyScanProgress(
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

export async function initializeScanner(
  config: BrowserStackConfig,
): Promise<AccessibilityScanner> {
  const scanner = new AccessibilityScanner();
  const auth = setupAuth(config);
  scanner.setAuth(auth);
  return scanner;
}

/** The arguments that name the same source again, for the next-page hint. */
export function sourceArgs(source: IssueSource): string {
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
export function describeSource(source: IssueSource): string {
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

/** Statuses during which a report's issues are still being added (`rule_processing`: an app build's). */
export const PROCESSING_STATUSES = new Set([
  "queued",
  "running",
  "processing",
  "finalizing",
  "rule_processing",
  "in_progress",
]);

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Progress while a report's CSV export is generated, so clients see the call is alive. */
export function exportProgress(
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

/** The WCAG versions and levels Website Scanner checks against, and RGAA 4.1, by name. */
export const WCAG_VERSIONS = {
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

export const wcagName = (value: string) =>
  WCAG_VERSIONS[value as keyof typeof WCAG_VERSIONS] ?? value;
export const onOff = (value: boolean) => (value ? "on" : "off");

/**
 * Where to see a scan in the dashboard: its own page, as the scans list links it. A scan's
 * page is named by its build, so a link made from the scan's name does not open it.
 */
export function scanDashboardNote(
  dashboardLink: string | undefined,
  scanId: string,
): string {
  return dashboardLink
    ? `Its page in the Accessibility dashboard: ${dashboardLink}`
    : `See it under Website Scanner in the Accessibility dashboard (scan ID ${scanId}).`;
}
