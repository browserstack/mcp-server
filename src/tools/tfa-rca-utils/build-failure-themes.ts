import { apiClient } from "../../lib/apiClient.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  AI_FAILURES_FLAT_PATH,
  AI_FAILURES_PATH,
  BUILD_THEMES_FAILURE_STATUSES,
  BUILD_THEMES_POLL_INTERVAL_MS,
  BUILD_THEMES_POLL_MAX_WAIT_MS,
  BUILD_THEMES_SUCCESS_STATUS,
  getO11yBaseUrl,
} from "./constants.js";
import { buildAuthHeader } from "./turn-result.js";

/**
 * Domain error carrying a client-safe message. The tool maps these to a
 * `{ isError: true }` envelope; the message never contains credentials.
 */
export class BuildFailureThemesError extends Error {}

export interface BuildFailureTheme {
  themeId: string;
  buildFailureThemeId: number;
  themeData: { name: string; description: string };
  affectedWorkflows: unknown[];
  affectedWorkflowCount?: number;
  testRunCount?: number;
  testPercentage?: number;
}

export interface BuildFailureWorkflow {
  workflowIdentifier: string;
  buildFailureWorkflowId: number;
  workflowData: { name: string; description: string };
  testRunCount?: number;
  testPercentage?: number;
  themesIdentified?: unknown[];
  themeIdentifiedCount?: number;
}

/**
 * Result of `fetchBuildFailureThemes`. `ready: false` is NOT an error — it
 * means the server-side clustering (triggered by this call if needed) hasn't
 * reached `SUCCESS` within the poll budget, OR the trigger endpoint itself
 * isn't available yet (`status: "trigger-unavailable"` — see
 * `fetchBuildFailureThemes`'s doc comment). Either way this util never blocks
 * past its budget and never throws for "not ready yet"; the caller
 * (`rca-build`) falls back to client-side clustering.
 */
export interface BuildFailureThemesResult {
  ready: boolean;
  /** Last observed `buildThemeWorkflow.status`, or "PENDING" if budget spent with no status yet. */
  status: string;
  buildId?: string;
  buildThemes?: BuildFailureTheme[];
  buildWorkflows?: BuildFailureWorkflow[];
  stats?: { totalThemes: number; newThemes: number; existingThemes: number };
}

export interface TestInFailureTheme {
  testRunId: string | number | undefined;
  title?: string;
  status?: string;
  raw: unknown;
}

/** Minimal shape of one `/flat` entry — the wire may carry more, we only read these. */
interface RawFlatTestRun {
  id?: string | number;
  title?: string;
  details?: { id?: string | number; status?: string };
}

export interface ListTestsInFailureThemeArgs {
  buildUuid: string;
  themeId?: number;
  workflowId?: number;
  limit?: number;
  cursor?: string;
}

export interface ListTestsInFailureThemeResult {
  tests: TestInFailureTheme[];
  /** Cursor for the next page, if any (field name unconfirmed against a real
   * paginated build — checked against every plausible key the wire might use). */
  nextCursor?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeaders(config: BrowserStackConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: buildAuthHeader(config),
  };
}

/** Normalize a response body to a plain object — a malformed 200 (empty
 * string, null, array) is treated as "no data", never accessed as if it were
 * the expected shape. */
function asObject(data: unknown): Record<string, any> {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, any>)
    : {};
}

function failuresUrl(buildUuid: string): string {
  return (
    getO11yBaseUrl() +
    AI_FAILURES_PATH.replace("{buildUuid}", encodeURIComponent(buildUuid))
  );
}

async function fetchFailuresOnce(
  buildUuid: string,
  config: BrowserStackConfig,
) {
  return apiClient.get({
    url: failuresUrl(buildUuid),
    headers: authHeaders(config),
    raise_error: false,
  });
}

/** Same URL as the GET read, different verb — the `/ext/v1/ai/failures/{buildUuid}`
 * mirror of `AIController.triggerBuildLevelAIRca`. Kicks off build-level theme
 * computation; a no-op (existing-report fast-path) if already
 * SUCCESS/RETRIED_AND_FAILED. */
async function triggerFailuresOnce(
  buildUuid: string,
  config: BrowserStackConfig,
) {
  return apiClient.post({
    url: failuresUrl(buildUuid),
    headers: authHeaders(config),
    body: {},
    raise_error: false,
  });
}

/**
 * Fetch a build's server-computed failure-theme clusters (`buildThemes` +
 * `buildWorkflows`), triggering computation if nothing has ever run for this
 * build. Polls until `buildThemeWorkflow.status` reaches `SUCCESS` or the
 * wall-clock budget is spent (`BUILD_THEMES_POLL_MAX_WAIT_MS`).
 *
 * Triggers (POST, same URL as the GET) at most ONCE per call — on a 404, a
 * missing `buildThemeWorkflow`, or a terminal failure status — never on an
 * in-progress status (PENDING/PROCESSING), since someone/something else's
 * computation may already be running. After a trigger that SUCCEEDS, a
 * still-not-ready result is treated as "waiting on the async computation to
 * start," not a reason to give up — it keeps polling within budget same as
 * any other in-progress state. A trigger that FAILS (for any reason — a
 * missing route, a permission error, a server error) returns immediately with
 * `ready: false, status: "trigger-unavailable"` rather than throwing or
 * entering the poll loop at all: the caller (`rca-build`) has a client-side
 * clustering fallback for exactly this case, so failing fast beats failing
 * slow.
 */
export async function fetchBuildFailureThemes(
  buildUuid: string,
  config: BrowserStackConfig,
): Promise<BuildFailureThemesResult> {
  const startTime = Date.now();
  let lastStatus: string | undefined;
  let triggered = false;

  /** Attempts the one-time trigger POST; returns whether it succeeded. */
  const triggerOnce = async (): Promise<boolean> => {
    triggered = true;
    const triggerResponse = await triggerFailuresOnce(buildUuid, config);
    return triggerResponse.ok;
  };

  while (true) {
    const response = await fetchFailuresOnce(buildUuid, config);

    if (response.ok) {
      const data = asObject(response.data);
      const status: string | undefined = data.buildThemeWorkflow?.status;

      if (status === BUILD_THEMES_SUCCESS_STATUS) {
        return {
          ready: true,
          status,
          buildId: data.buildId,
          buildThemes: data.buildThemes ?? [],
          buildWorkflows: data.buildWorkflows ?? [],
          stats: data.stats,
        };
      }

      if (status && BUILD_THEMES_FAILURE_STATUSES.includes(status)) {
        if (triggered) {
          // Already retried once and it failed again — a real failure, not
          // async lag. Nothing left to do but report it.
          return { ready: false, status };
        }
        if (!(await triggerOnce())) {
          return { ready: false, status: "trigger-unavailable" };
        }
      } else {
        // status undefined (never computed) — trigger once. An in-progress
        // value (PENDING/PROCESSING) just keeps polling either way.
        if (!status && !triggered && !(await triggerOnce())) {
          return { ready: false, status: "trigger-unavailable" };
        }
        lastStatus = status ?? lastStatus;
      }
    } else if (response.status === 404) {
      if (!triggered && !(await triggerOnce())) {
        return { ready: false, status: "trigger-unavailable" };
      }
    } else {
      throw new BuildFailureThemesError(
        `failed to fetch build failure themes (status ${response.status})`,
      );
    }

    if (Date.now() - startTime >= BUILD_THEMES_POLL_MAX_WAIT_MS) {
      return { ready: false, status: lastStatus ?? "PENDING" };
    }

    await delay(BUILD_THEMES_POLL_INTERVAL_MS);
  }
}

/** Paginated test-run membership for one failure theme or workflow. */
export async function fetchTestsInFailureTheme(
  args: ListTestsInFailureThemeArgs,
  config: BrowserStackConfig,
): Promise<ListTestsInFailureThemeResult> {
  const params: Record<string, string | number> = {
    limit: args.limit ?? 50,
  };
  if (args.themeId !== undefined) params.buildFailureThemeId = args.themeId;
  if (args.workflowId !== undefined)
    params.buildFailureWorkflowId = args.workflowId;
  if (args.cursor) params.searchAfter = args.cursor;

  const url =
    getO11yBaseUrl() +
    AI_FAILURES_FLAT_PATH.replace(
      "{buildUuid}",
      encodeURIComponent(args.buildUuid),
    );

  const response = await apiClient.get({
    url,
    headers: authHeaders(config),
    params,
    raise_error: false,
  });

  if (!response.ok) {
    throw new BuildFailureThemesError(
      `failed to list tests in failure theme (status ${response.status})`,
    );
  }

  const data = asObject(response.data);
  const testRuns: RawFlatTestRun[] = data.testRuns ?? [];

  return {
    tests: testRuns.map((t) => ({
      testRunId: t?.details?.id ?? t?.id,
      title: t?.title,
      status: t?.details?.status,
      raw: t,
    })),
    nextCursor: data.nextCursor ?? data.searchAfter ?? data.next_search_after,
  };
}
