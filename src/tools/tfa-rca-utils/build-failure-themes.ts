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

// `ready: false` is not an error — clustering hasn't reached SUCCESS within the
// poll budget, or the trigger itself failed (`status: "trigger-unavailable"`).
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

// Minimal shape of one `/flat` entry — the wire may carry more, we only read these.
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
  /** Cursor for the next page, if any. */
  nextCursor?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeaders(config: BrowserStackConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: buildAuthHeader(config),
  };
}

// Normalize a response body to a plain object — a malformed 200 is treated as "no data".
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

// Same URL as the GET read, different verb — kicks off build-level theme computation.
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

// Fetch a build's server-computed failure-theme clusters, triggering computation
// if nothing has run yet. Triggers at most once per call, then polls until
// SUCCESS or BUILD_THEMES_POLL_MAX_WAIT_MS is spent — never blocks past that.
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
