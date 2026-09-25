import { z } from "zod";

import appConfig from "../../config.js";

export function getO11yBaseUrl(): string {
  return appConfig.O11Y_TFA_RCA_BASE_URL;
}

export function getO11yUiBaseUrl(): string {
  return appConfig.BROWSERSTACK_O11Y_UI_BASE_URL;
}

// TRA UI deep-link for a build's AI-TFA sub-tab.
export const O11Y_UI_BUILD_PATH =
  "/builds/{buildUuid}?tab=ai_report&subTab=aitfa";

/** Human-facing TRA UI link for one build's full report. */
export function getO11yUiBuildUrl(buildUuid: string): string {
  return (
    getO11yUiBaseUrl() +
    O11Y_UI_BUILD_PATH.replace("{buildUuid}", encodeURIComponent(buildUuid))
  );
}

// Generic TRA UI pointer for RESOLVED turns where only a testRunId is known.
export function getRcaViewGuidance(): string {
  return `${getO11yUiBaseUrl()} — open the build's AI report (tab=ai_report, subTab=aitfa) to view the full RCA`;
}

/** Trigger (or read, when already complete) a build's Release Readiness report. */
export const RELEASE_READINESS_TRIGGER_PATH =
  "/ext/v1/ai/builds/{buildUuid}/releaseReadiness/trigger";

/** Read a build's server-computed failure-theme clusters. */
export const AI_FAILURES_PATH = "/ext/v1/ai/failures/{buildUuid}";

/** Paginated test-run membership for one failure theme / workflow. */
export const AI_FAILURES_FLAT_PATH = "/ext/v1/ai/failures/{buildUuid}/flat";

export const BUILD_THEMES_SUCCESS_STATUS = "SUCCESS";
export const BUILD_THEMES_FAILURE_STATUSES = ["FAILED", "ERROR"];

/** Interval between in-call polls of the build-failure-themes readiness. */
export const BUILD_THEMES_POLL_INTERVAL_MS = 3000;

export const BUILD_THEMES_POLL_MAX_WAIT_MS = 90 * 1000;

export const GET_BUILD_FAILURE_THEMES_PARAMS = {
  buildUuid: z
    .string()
    .describe("Automate build UUID to fetch failure themes for."),
};

export const LIST_TESTS_IN_FAILURE_THEME_PARAMS = {
  buildUuid: z
    .string()
    .describe("Automate build UUID the theme/workflow belongs to."),
  themeId: z.number().optional().describe("buildFailureThemeId to filter by."),
  workflowId: z
    .number()
    .optional()
    .describe("buildFailureWorkflowId to filter by."),
  limit: z.number().optional().describe("Max tests to return, default 50."),
  cursor: z
    .string()
    .optional()
    .describe("searchAfter cursor from a prior call."),
};

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
  prDetails: z
    .array(
      z.object({
        repo: z.string().describe("owner/name, e.g. browserstack/ai-sdk."),
        number: z.number().describe("PR number (unique only within repo)."),
        title: z.string().describe("PR title."),
        author: z.string().describe("PR author."),
        link: z
          .string()
          .describe("Canonical URL: https://github.com/<repo>/pull/<number>."),
        tag: z.enum(["latent", "regression"]).describe("latent | regression."),
      }),
    )
    .optional()
    .describe(
      "Suspect PRs; identity is repo+number. Each needs repo, number, title, author, link, tag.",
    ),
};

export const GET_TFA_TURN_RESULT_PARAMS = {
  testRunId: z.string().describe("Test run id the turn was submitted on."),
  turnId: z.string().describe("Turn id returned by tfaRcaTurn."),
};

export const TRIGGER_RCA_REPORT_PARAMS = {
  buildUuid: z.string().describe("Automate build UUID to analyze."),
  force: z
    .boolean()
    .optional()
    .describe("Re-run even if a completed report exists."),
};
