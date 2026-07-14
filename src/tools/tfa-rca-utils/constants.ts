import { z } from "zod";

import appConfig from "../../config.js";

/**
 * O11y base for the `rcaChat` proxy. The MCP server talks ONLY to o11y-api
 * (boundary discipline, R9). The value is process-startup config resolved in
 * `src/config.ts` from `O11Y_TFA_RCA_BASE_URL` (default rengg-tfa) — never read
 * `process.env` here. Resolved per call so a config built per server instance
 * (multi-tenant) is honored.
 */
export function getO11yBaseUrl(): string {
  return appConfig.O11Y_TFA_RCA_BASE_URL;
}

/**
 * Test Observability (TRA) web UI base for human-facing "view report" links.
 * Startup config (`BROWSERSTACK_O11Y_UI_BASE_URL` in `src/config.ts`, default
 * observability.browserstack.com) — never read `process.env` here.
 */
export function getO11yUiBaseUrl(): string {
  return appConfig.BROWSERSTACK_O11Y_UI_BASE_URL;
}

/**
 * TRA UI deep-link for a build's AI report (confirmed shape, 2026-07-13):
 * `<UI_BASE>/builds/<buildUuid>?tab=ai_report&subTab=aitfa` — the AI-TFA
 * sub-tab of the build's AI report. `{buildUuid}` is replaced with the
 * caller-supplied build id.
 */
export const O11Y_UI_BUILD_PATH =
  "/builds/{buildUuid}?tab=ai_report&subTab=aitfa";

/** Human-facing TRA UI link for one build's full report. */
export function getO11yUiBuildUrl(buildUuid: string): string {
  return (
    getO11yUiBaseUrl() +
    O11Y_UI_BUILD_PATH.replace("{buildUuid}", encodeURIComponent(buildUuid))
  );
}

/**
 * Generic TRA UI pointer used on RESOLVED turns where only a testRunId is
 * known (no buildUuid to deep-link). The full RCA lives on the dashboard
 * (build page → AI report → AI TFA sub-tab).
 */
export function getRcaViewGuidance(): string {
  return `${getO11yUiBaseUrl()} — open the build's AI report (tab=ai_report, subTab=aitfa) to view the full RCA`;
}

/** Trigger (or read, when already complete) a build's Release Readiness report. */
export const RELEASE_READINESS_TRIGGER_PATH =
  "/ext/v1/ai/builds/{buildUuid}/releaseReadiness/trigger";

/** Submit one collaborative turn for a test run. */
export const RCA_CHAT_SUBMIT_PATH = "/ext/v1/testRuns/{testRunId}/rcaChat";

/** Poll a submitted turn to completion. */
export const RCA_CHAT_POLL_PATH =
  "/ext/v1/testRuns/{testRunId}/rcaChat/{turnId}";

/** Initial wait before the first poll GET. */
export const POLL_INITIAL_DELAY_MS = 2000;

/** Interval between poll GETs. */
export const POLL_INTERVAL_MS = 3000;

/** Wall-clock cap for the in-call poll; exceeding it yields a soft PENDING. */
export const POLL_MAX_WAIT_MS = 90 * 1000;

/** Max length of the digest message, matching o11y's request `@Size`. */
export const MESSAGE_MAX_LENGTH = 5000;

/** Max chars of `root_cause` surfaced in the RESOLVED glimpse. */
export const RCA_GLIMPSE_ROOT_CAUSE_MAX = 220;

/**
 * Zod param shapes for the `tfaRcaTurn` tool, exported as a
 * `Record<string, ZodType>` mirroring `rca-agent-utils/constants.ts`.
 * No credential fields (security rule). Each `.describe()` ≤ 60 chars.
 */
export const TFA_RCA_TURN_PARAMS = {
  testRunId: z.string().describe("Test run id to run RCA collaboration on."),
  message: z
    .string()
    .max(MESSAGE_MAX_LENGTH)
    .describe("Digested analysis to send this turn; no raw logs."),
  threadId: z
    .string()
    .optional()
    .describe("Thread id from prior turn; omit on first turn."),
  turnId: z
    .string()
    .optional()
    .describe("Turn id to resume a pending poll; usually omit."),
};

/**
 * Zod param shapes for the `triggerRcaReport` tool. No credential fields
 * (security rule). Each `.describe()` ≤ 60 chars.
 */
export const TRIGGER_RCA_REPORT_PARAMS = {
  buildUuid: z.string().describe("Automate build UUID to analyze."),
  force: z
    .boolean()
    .optional()
    .describe("Re-run even if a completed report exists."),
};
