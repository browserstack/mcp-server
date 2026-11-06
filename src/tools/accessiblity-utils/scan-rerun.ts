import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SavedScan, ScanSettings } from "./scanner.js";
import { onOff, wcagName } from "./shared.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";

/*
 * Re-running a scan by its scanId: whether it is for the page asked for, how the settings
 * passed differ from its saved ones, and the notes and hints said with a scan's result.
 */

/** startAccessibilityScan's arguments, as the call passed them: a setting left out is undefined. */
export type ScanArgs = {
  name: string;
  pageURL: string;
  scanId?: string;
  authConfigId?: number;
  localIdentifier?: string;
} & ScanSettings;

/**
 * The result with lines said before and after it. Each text block is made to end in a
 * newline, as createSuccessResponse's do, so a link that ends one block is not run into
 * the next by a client that joins blocks with no separator.
 */
export function withNotes(
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
export function rescanHint(scanId: string): string {
  return `To scan this same page again later (e.g. after a fix), call startAccessibilityScan with scanId "${scanId}"; that adds a run to this scan so the runs can be compared with compareWith "previous".`;
}

export function compareHint(scanId: string, scanRunId: string): string {
  return `To see what changed since the previous run, call fetchAccessibilityIssues with scanId "${scanId}", scanRunId "${scanRunId}" and compareWith "previous".`;
}

/** Why a scan given by id is not re-run for this page: it was saved for another. */
export function otherPageNote(
  scanId: string,
  urlList: string[],
  pageURL: string,
): string {
  if (!urlList.length) {
    return `Scan ${scanId}'s pages could not be read, so it could not be checked to be for ${pageURL}; a new scan was started.`;
  }
  // The saved pages are the account's, which another user may have set: quoted as data.
  const pages = wrapUntrusted(
    "saved scan pages",
    JSON.stringify(urlList.slice(0, 3)),
  );
  if (urlList.length === 1) {
    return `Scan ${scanId} is for another page, not ${pageURL}, so a new scan was started. Its page: ${pages}`;
  }
  const more = urlList.length > 3 ? ` (the first 3 of ${urlList.length})` : "";
  return `Scan ${scanId} is for ${urlList.length} pages, not just ${pageURL}, so a new scan was started. Its pages${more}: ${pages}`;
}

/**
 * The settings a call passed that differ from the scan's saved ones. A re-run takes no
 * settings, so running it anyway would quietly drop what was asked for. Only settings the
 * call passed are compared (none has a default in the schema), and only against a saved
 * value the overview gives: it gives whether a login or Local is saved, not which one.
 */
export function savedSettingDifferences(
  args: ScanArgs,
  saved: SavedScan,
): string[] {
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
export function uncheckedSettings(args: ScanArgs, saved: SavedScan): string[] {
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
  ].filter(Boolean);
}

/**
 * A login or Local tunnel passed to a re-run, which the run cannot take: it logs in and
 * tunnels with the scan's saved ones, which the overview does not name. Said plainly, so a
 * run with the old login is not taken for one with the login passed.
 */
export function unusedLoginAndTunnel(
  args: ScanArgs,
  saved: SavedScan,
): string[] {
  return [
    // Which login is saved is not given: only whether one is.
    ...(args.authConfigId !== undefined && saved.authEnabled !== false
      ? [
          `authConfigId ${args.authConfigId} was not used: a re-run logs in with the scan's saved login, which the API does not name. To scan with login ${args.authConfigId}, call startAccessibilityScan without scanId (that starts a new scan).`,
        ]
      : []),
    // Said in the Local note when the scan is saved with a tunnel.
    ...(args.localIdentifier !== undefined &&
    saved.localTestingEnabled === undefined
      ? [
          `localIdentifier "${args.localIdentifier}" was not used: a re-run uses the scan's saved BrowserStack Local settings, which the API does not give back. To scan through that tunnel, call startAccessibilityScan without scanId (that starts a new scan).`,
        ]
      : []),
  ];
}

/**
 * Why a scan saved with BrowserStack Local is not re-run when no localIdentifier is passed:
 * its tunnel's identifier is not given back, and one this MCP started was never shown.
 */
export function localScanNotRerunNote(scanId: string): string {
  return `Scan ${scanId} reaches its page through BrowserStack Local under an identifier the API does not give back, so it can't be re-run from here: a new scan was started, whose runs can't be compared with scan ${scanId}'s. To re-run scan ${scanId}, start BrowserStack Local yourself with the identifier the scan was created with and pass it as localIdentifier.`;
}

/**
 * A re-run reaches a local page through the tunnel the scan was saved with, by its
 * identifier, which the overview does not give back: the tunnel has to be running under
 * that identifier, or the run cannot reach the page.
 */
export function localRerunNote(localIdentifier: string | undefined): string {
  return `This scan reaches its page through BrowserStack Local, and the run uses the scan's saved Local settings: a tunnel must be running with the same local identifier the scan was created with${
    localIdentifier
      ? ` (the API does not give the saved identifier back, so it could not be checked against "${localIdentifier}")`
      : " (the API does not give the saved identifier back)"
  }. If the run cannot reach the page, start that tunnel and re-run.`;
}
