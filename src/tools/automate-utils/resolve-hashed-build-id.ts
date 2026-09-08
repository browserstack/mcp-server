import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import logger from "../../logger.js";
import { getAutomationBaseUrl } from "../rca-agent-utils/constants.js";
import { extractTestIds } from "../rca-agent-utils/get-failed-test-id.js";
import { TestRun } from "../rca-agent-utils/types.js";

// Observability (Test Reporting & Analytics) build ids are UUIDs; Automate and
// App Automate REST build ids are 40-char hex "hashed ids". The two are not
// interchangeable, and the observability build API does not expose the hashed
// id. The deterministic bridge is any BrowserStack session that belongs to the
// build: the session detail endpoint reports its parent `build_hashed_id`.
const OBSERVABILITY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASHED_BUILD_ID_RE = /^[a-f0-9]{40}$/i;

// Only the first session id is needed; most builds surface one on page one.
const MAX_TEST_RUN_PAGES = 5;

export function isObservabilityBuildUuid(id: string): boolean {
  return OBSERVABILITY_UUID_RE.test(id.trim());
}

export function isHashedBuildId(id: string): boolean {
  return HASHED_BUILD_ID_RE.test(id.trim());
}

export function sessionDetailsUrl(
  sessionType: SessionType,
  sessionId: string,
): string {
  const encoded = encodeURIComponent(sessionId);
  switch (sessionType) {
    case SessionType.Automate:
      return `https://api.browserstack.com/automate/sessions/${encoded}.json`;
    case SessionType.AppAutomate:
      return `https://api.browserstack.com/app-automate/sessions/${encoded}.json`;
    default: {
      const _exhaustive: never = sessionType;
      throw new Error(`Unsupported session type: ${_exhaustive}`);
    }
  }
}

/**
 * Resolve the hashed build id that a session belongs to via the Automate /
 * App Automate session detail endpoint. Returns undefined when the session
 * cannot be fetched or does not report a build.
 */
export async function resolveBuildIdFromSession(
  sessionId: string,
  sessionType: SessionType,
  config: BrowserStackConfig,
): Promise<string | undefined> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.get({
    url: sessionDetailsUrl(sessionType, sessionId),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    raise_error: false,
  });

  if (!response.ok) {
    logger.warn(
      `Could not resolve build id for ${sessionType} session ${sessionId}: ${response.status}`,
    );
    return undefined;
  }

  const session = (response.data as any)?.automation_session;
  const buildId = session?.build_hashed_id;
  return typeof buildId === "string" && buildId.trim()
    ? buildId.trim()
    : undefined;
}

/**
 * Find any BrowserStack session id attached to an observability build by
 * walking its test runs. Returns undefined when no test reports a session
 * (e.g. JUnit-uploaded builds that never ran on BrowserStack).
 */
export async function findSessionIdForObservabilityBuild(
  observabilityBuildId: string,
  config: BrowserStackConfig,
): Promise<string | undefined> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");
  const baseUrl = `${getAutomationBaseUrl()}/ext/v1/builds/${encodeURIComponent(observabilityBuildId)}/testRuns`;

  let nextPage: string | undefined;
  for (let page = 0; page < MAX_TEST_RUN_PAGES; page++) {
    const response = await apiClient.get<TestRun>({
      url: baseUrl,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      ...(nextPage ? { params: { next_page: nextPage } } : {}),
      raise_error: false,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch test runs for observability build "${observabilityBuildId}": ` +
          `${response.status} ${response.statusText}`,
      );
    }

    const data = response.data;
    const withSession = extractTestIds(data?.hierarchy ?? []).find(
      (test) => test.session_id,
    );
    if (withSession?.session_id) {
      return withSession.session_id;
    }

    if (!data?.pagination?.has_next || !data.pagination.next_page) {
      return undefined;
    }
    nextPage = data.pagination.next_page;
  }

  logger.warn(
    `resolveHashedBuildId: no session id in first ${MAX_TEST_RUN_PAGES} pages of build ${observabilityBuildId}`,
  );
  return undefined;
}

export interface ResolvedHashedBuildId {
  hashedBuildId: string;
  sessionId: string;
  sessionType: SessionType;
}

/**
 * Convert an observability build UUID into the Automate / App Automate hashed
 * build id in two deterministic API calls: pick any session of the build from
 * its test runs, then read `build_hashed_id` from that session's details.
 *
 * When `sessionType` is omitted, Automate is tried first, then App Automate.
 */
export async function resolveHashedBuildId(
  observabilityBuildId: string,
  config: BrowserStackConfig,
  sessionType?: SessionType,
): Promise<ResolvedHashedBuildId> {
  const buildId = observabilityBuildId.trim();

  const sessionId = await findSessionIdForObservabilityBuild(buildId, config);
  if (!sessionId) {
    throw new Error(
      `No BrowserStack sessions found for observability build "${buildId}". ` +
        "Only builds that ran on Automate or App Automate have sessions to list; " +
        "uploaded-report builds (e.g. JUnit) do not.",
    );
  }

  const candidates: SessionType[] = sessionType
    ? [sessionType]
    : [SessionType.Automate, SessionType.AppAutomate];

  for (const candidate of candidates) {
    const hashedBuildId = await resolveBuildIdFromSession(
      sessionId,
      candidate,
      config,
    );
    if (hashedBuildId) {
      return { hashedBuildId, sessionId, sessionType: candidate };
    }
  }

  throw new Error(
    `Could not resolve the hashed build id for observability build "${buildId}" ` +
      `from session "${sessionId}" (tried: ${candidates.join(", ")}).`,
  );
}
