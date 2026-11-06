import { HttpError } from "../../lib/error.js";
import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import { extractTestIds } from "../rca-agent-utils/get-failed-test-id.js";
import { TestRun } from "../rca-agent-utils/types.js";
import { getRegionalHost, sessionApiHost } from "../../lib/regional-host.js";

// Automate build ids are hex; TRA build ids are base-36 (older ones UUIDs). A TRA
// id can be all hex by chance, so hex only means "probably Automate".
const OBSERVABILITY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASHED_BUILD_ID_RE = /^[a-f0-9]{40}$/i;
const TRA_BUILD_ID_RE = /^[a-z0-9]{40}$/i;

export function isObservabilityBuildUuid(id: string): boolean {
  return OBSERVABILITY_UUID_RE.test(id.trim());
}

export function isHashedBuildId(id: string): boolean {
  return HASHED_BUILD_ID_RE.test(id.trim());
}

export function isTraBuildId(id: string): boolean {
  const trimmed = id.trim();
  if (OBSERVABILITY_UUID_RE.test(trimmed)) return true;
  return TRA_BUILD_ID_RE.test(trimmed) && !HASHED_BUILD_ID_RE.test(trimmed);
}

export function otherSessionType(sessionType: SessionType): SessionType {
  return sessionType === SessionType.Automate
    ? SessionType.AppAutomate
    : SessionType.Automate;
}

/** The first page of a build's tests has no session; later pages were not read. */
export class SessionNotOnFirstPageError extends Error {
  constructor(buildId: string) {
    super(
      `No test on the first page of TRA build "${buildId}" has a BrowserStack session, ` +
        "so its Automate build was not looked up further. Pass the Automate build " +
        "link from the dashboard (.../builds/<build id>) instead.",
    );
    this.name = "SessionNotOnFirstPageError";
  }
}

export class NoSessionsError extends Error {
  constructor(buildId: string) {
    super(
      `TRA build "${buildId}" has no BrowserStack sessions: its results were uploaded ` +
        "(e.g. a JUnit report), so it has no Automate sessions, logs or video. " +
        "Use listTestIds and fetchRCA for this build instead.",
    );
    this.name = "NoSessionsError";
  }
}

export function sessionDetailsUrl(
  sessionType: SessionType,
  sessionId: string,
  host = sessionApiHost(sessionType),
): string {
  const encoded = encodeURIComponent(sessionId);
  switch (sessionType) {
    case SessionType.Automate:
      return `${host}/automate/sessions/${encoded}.json`;
    case SessionType.AppAutomate:
      return `${host}/app-automate/sessions/${encoded}.json`;
    default: {
      const _exhaustive: never = sessionType;
      throw new Error(`Unsupported session type: ${_exhaustive}`);
    }
  }
}

export async function detectSession(
  sessionId: string,
  preferred: SessionType,
  config: BrowserStackConfig,
): Promise<{ sessionType: SessionType; hashedBuildId: string } | undefined> {
  for (const candidate of [preferred, otherSessionType(preferred)]) {
    const hashedBuildId = await resolveBuildIdFromSession(
      sessionId,
      candidate,
      config,
    );
    if (hashedBuildId) return { sessionType: candidate, hashedBuildId };
  }
  return undefined;
}

/**
 * Resolve the hashed build id that a session belongs to via the Automate /
 * App Automate session detail endpoint. Returns undefined when the product does
 * not know the session (404) or it reports no build; other failures throw.
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

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new HttpError(
      `Failed to read ${sessionType} session "${sessionId}": ${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }

  const session = (response.data as any)?.automation_session;
  const buildId = session?.build_hashed_id;
  return typeof buildId === "string" && buildId.trim()
    ? buildId.trim()
    : undefined;
}

/**
 * Session id of any test in the first page of a TRA build's test runs. Returns
 * undefined when the build has no sessions at all (uploaded results). Reads one
 * page only: if that page has no session but more exist, it throws rather than
 * paging on.
 */
export async function findSessionIdForObservabilityBuild(
  observabilityBuildId: string,
  config: BrowserStackConfig,
): Promise<string | undefined> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");
  const response = await apiClient.get<TestRun>({
    url: `${getRegionalHost("automationApi")}/ext/v1/builds/${encodeURIComponent(observabilityBuildId)}/testRuns`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    raise_error: false,
  });

  if (!response.ok) {
    throw new HttpError(
      `Failed to fetch test runs for observability build "${observabilityBuildId}": ` +
        `${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const data = response.data;
  const withSession = extractTestIds(data?.hierarchy ?? []).find(
    (test) => test.session_id,
  );
  if (withSession?.session_id) return withSession.session_id;
  if (data?.pagination?.has_next) {
    throw new SessionNotOnFirstPageError(observabilityBuildId);
  }
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
 * The given `sessionType` is tried first (Automate when omitted), then the other.
 */
export async function resolveHashedBuildId(
  observabilityBuildId: string,
  config: BrowserStackConfig,
  sessionType?: SessionType,
): Promise<ResolvedHashedBuildId> {
  const buildId = observabilityBuildId.trim();

  const sessionId = await findSessionIdForObservabilityBuild(buildId, config);
  if (!sessionId) {
    throw new NoSessionsError(buildId);
  }

  const first = sessionType ?? SessionType.Automate;
  const candidates: SessionType[] = [first, otherSessionType(first)];

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
