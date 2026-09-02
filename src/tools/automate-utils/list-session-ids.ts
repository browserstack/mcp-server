import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";

export const DEFAULT_SESSION_LIST_LIMIT = 10;

export interface ListSessionIdsArgs {
  sessionType: SessionType;
  buildId: string;
  limit?: number;
  offset?: number;
  status?: string;
}

export interface SessionIdRecord {
  sessionId: string;
  name?: string;
  status?: string;
  os?: string;
  osVersion?: string;
  browser?: string;
  device?: string | null;
  browserUrl?: string;
}

interface AutomationSessionPayload {
  hashed_id?: string;
  name?: string;
  status?: string;
  os?: string;
  os_version?: string;
  browser?: string;
  device?: string | null;
  browser_url?: string;
}

interface SessionListItem {
  automation_session?: AutomationSessionPayload;
}

export function sessionsListUrl(
  sessionType: SessionType,
  buildId: string,
): string {
  const encodedBuildId = encodeURIComponent(buildId);
  switch (sessionType) {
    case SessionType.Automate:
      return `https://api.browserstack.com/automate/builds/${encodedBuildId}/sessions.json`;
    case SessionType.AppAutomate:
      return `https://api-cloud.browserstack.com/app-automate/builds/${encodedBuildId}/sessions.json`;
    default: {
      const _exhaustive: never = sessionType;
      throw new Error(`Unsupported session type: ${_exhaustive}`);
    }
  }
}

export function mapSessionRecords(
  payload: unknown,
  statusFilter?: string,
): SessionIdRecord[] {
  const items = Array.isArray(payload) ? payload : [];
  const normalizedFilter = statusFilter?.trim().toLowerCase();

  const records: SessionIdRecord[] = [];
  for (const item of items) {
    const session = (item as SessionListItem)?.automation_session;
    if (!session) {
      continue;
    }
    const sessionId = session.hashed_id?.trim();
    if (!sessionId) {
      continue;
    }
    if (
      normalizedFilter &&
      (session.status ?? "").toLowerCase() !== normalizedFilter
    ) {
      continue;
    }
    records.push({
      sessionId,
      name: session.name,
      status: session.status,
      os: session.os,
      osVersion: session.os_version,
      browser: session.browser,
      device: session.device,
      browserUrl: session.browser_url,
    });
  }
  return records;
}

export async function listSessionIds(
  args: ListSessionIdsArgs,
  config: BrowserStackConfig,
): Promise<SessionIdRecord[]> {
  const buildId = args.buildId.trim();
  if (!buildId) {
    throw new Error("Hashed Automate/App Automate build ID is required");
  }

  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");
  const limit = args.limit ?? DEFAULT_SESSION_LIST_LIMIT;
  const params: Record<string, string | number> = { limit };
  if (args.offset !== undefined) {
    params.offset = args.offset;
  }

  const response = await apiClient.get({
    url: sessionsListUrl(args.sessionType, buildId),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    params,
    raise_error: false,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Invalid hashed build ID "${buildId}" for ${args.sessionType}. ` +
          "Use the Automate/App Automate dashboard hashed build id " +
          "(same family as App Automate getFailureLogs buildId), not the " +
          "observability UUID from getBuildId or listBuildId. " +
          "If you only have an observability UUID, call fetchBuildInsights and use hashed_id when present.",
      );
    }
    throw new Error(
      `Failed to list sessions: ${response.status} ${response.statusText}`,
    );
  }

  return mapSessionRecords(response.data, args.status);
}
