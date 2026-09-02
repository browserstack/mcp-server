import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";

export const BUILD_LIST_PAGE_SIZE = 10;
export const BUILD_LIST_MAX_BUILDS = 100;

export interface ResolveHashedBuildIdArgs {
  observabilityId: string;
  sessionType?: SessionType;
}

export interface ResolvedHashedBuildId {
  hashedBuildId: string;
  sessionType: SessionType;
  name: string;
  observabilityId: string;
}

interface TraBuildPayload {
  name?: string;
  original_name?: string;
  duration?: number;
  started_at?: string;
  hashed_id?: string;
  automate_hashed_id?: string;
  hashedId?: string;
}

interface AutomationBuildPayload {
  hashed_id?: string;
  name?: string;
  duration?: number;
  started_at?: string;
  created_at?: string;
}

interface BuildListItem {
  automation_build?: AutomationBuildPayload;
}

interface RestBuildCandidate {
  hashedId: string;
  name: string;
  sessionType: SessionType;
  duration?: number;
  startedAtMs?: number;
}

export function parseObservabilityId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Observability ID is required");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) {
      throw new Error("Observability ID is required");
    }
    return last;
  }

  return trimmed;
}

export function buildsListUrl(sessionType: SessionType): string {
  switch (sessionType) {
    case SessionType.Automate:
      return "https://api.browserstack.com/automate/builds.json";
    case SessionType.AppAutomate:
      return "https://api-cloud.browserstack.com/app-automate/builds.json";
    default: {
      const _exhaustive: never = sessionType;
      throw new Error(`Unsupported session type: ${_exhaustive}`);
    }
  }
}

function authHeader(config: BrowserStackConfig): string {
  const authString = getBrowserStackAuth(config);
  return `Basic ${Buffer.from(authString).toString("base64")}`;
}

function looksLikeHashedId(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value.trim());
}

export function extractDirectHashedId(
  payload: TraBuildPayload,
): string | undefined {
  const candidates = [
    payload.hashed_id,
    payload.automate_hashed_id,
    payload.hashedId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && looksLikeHashedId(candidate)) {
      return candidate.trim();
    }
  }
  return undefined;
}

function parseTimestampMs(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function productsToSearch(sessionType?: SessionType): SessionType[] {
  if (!sessionType) {
    return [SessionType.Automate, SessionType.AppAutomate];
  }
  switch (sessionType) {
    case SessionType.Automate:
      return [SessionType.Automate];
    case SessionType.AppAutomate:
      return [SessionType.AppAutomate];
    default: {
      const _exhaustive: never = sessionType;
      throw new Error(`Unsupported session type: ${_exhaustive}`);
    }
  }
}

function namesMatch(buildName: string, expected?: string): boolean {
  if (!expected) {
    return false;
  }
  const build = buildName.trim();
  const needle = expected.trim();
  if (!needle) {
    return false;
  }
  if (build === needle) {
    return true;
  }
  return build.startsWith(`${needle} `) || build.startsWith(`${needle}\t`);
}

function matchKind(
  buildName: string,
  originalName?: string,
  derivedName?: string,
): "original" | "name" | undefined {
  if (namesMatch(buildName, originalName)) {
    return "original";
  }
  if (namesMatch(buildName, derivedName)) {
    return "name";
  }
  return undefined;
}

function pickByCloseness(
  candidates: RestBuildCandidate[],
  traDuration?: number,
  traStartedAtMs?: number,
): RestBuildCandidate | undefined {
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (traStartedAtMs !== undefined) {
    const withTime = candidates.filter((c) => c.startedAtMs !== undefined);
    if (withTime.length === candidates.length) {
      const ranked = [...withTime].sort(
        (a, b) =>
          Math.abs((a.startedAtMs as number) - traStartedAtMs) -
          Math.abs((b.startedAtMs as number) - traStartedAtMs),
      );
      const best = ranked[0];
      const bestDelta = Math.abs((best.startedAtMs as number) - traStartedAtMs);
      const tied = ranked.filter(
        (c) =>
          Math.abs((c.startedAtMs as number) - traStartedAtMs) === bestDelta,
      );
      if (tied.length === 1) {
        return tied[0];
      }
    }
  }

  if (traDuration !== undefined) {
    const withDuration = candidates.filter((c) => c.duration !== undefined);
    if (withDuration.length === candidates.length) {
      const ranked = [...withDuration].sort(
        (a, b) =>
          Math.abs((a.duration as number) - traDuration) -
          Math.abs((b.duration as number) - traDuration),
      );
      const best = ranked[0];
      const bestDelta = Math.abs((best.duration as number) - traDuration);
      const tied = ranked.filter(
        (c) => Math.abs((c.duration as number) - traDuration) === bestDelta,
      );
      if (tied.length === 1) {
        return tied[0];
      }
    }
  }

  return undefined;
}

function formatCandidates(candidates: RestBuildCandidate[]): string {
  return candidates.map((c) => `${c.hashedId} (${c.sessionType})`).join(", ");
}

async function fetchTraBuild(
  observabilityId: string,
  config: BrowserStackConfig,
): Promise<TraBuildPayload> {
  const response = await apiClient.get({
    url: `https://api-automation.browserstack.com/ext/v1/builds/${encodeURIComponent(observabilityId)}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(config),
    },
    raise_error: false,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Observability build "${observabilityId}" was not found. ` +
          "Use the UUID from getBuildId / listBuildId / fetchBuildInsights " +
          "(or an observability dashboard URL), not a hashed Automate dashboard build ID.",
      );
    }
    throw new Error(
      `Failed to fetch observability build: ${response.status} ${response.statusText}`,
    );
  }

  return (response.data ?? {}) as TraBuildPayload;
}

async function listRestBuilds(
  sessionType: SessionType,
  config: BrowserStackConfig,
): Promise<RestBuildCandidate[]> {
  const candidates: RestBuildCandidate[] = [];
  let offset = 0;

  while (candidates.length < BUILD_LIST_MAX_BUILDS) {
    const remaining = BUILD_LIST_MAX_BUILDS - candidates.length;
    const limit = Math.min(BUILD_LIST_PAGE_SIZE, remaining);
    const response = await apiClient.get({
      url: buildsListUrl(sessionType),
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(config),
      },
      params: { limit, offset },
      raise_error: false,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list ${sessionType} builds: ${response.status} ${response.statusText}`,
      );
    }

    const items = Array.isArray(response.data) ? response.data : [];
    if (items.length === 0) {
      break;
    }

    for (const item of items as BuildListItem[]) {
      const build = item.automation_build;
      if (!build) {
        continue;
      }
      const hashedId = build.hashed_id?.trim();
      const name = build.name?.trim();
      if (!hashedId || !name) {
        continue;
      }
      candidates.push({
        hashedId,
        name,
        sessionType,
        duration:
          typeof build.duration === "number" ? build.duration : undefined,
        startedAtMs: parseTimestampMs(build.started_at ?? build.created_at),
      });
    }

    if (items.length < limit) {
      break;
    }
    offset += items.length;
  }

  return candidates;
}

function selectByName(
  candidates: RestBuildCandidate[],
  originalName?: string,
  derivedName?: string,
  traDuration?: number,
  traStartedAtMs?: number,
): RestBuildCandidate {
  const originalMatches = originalName
    ? candidates.filter((c) => matchKind(c.name, originalName, undefined))
    : [];
  const nameMatches = derivedName
    ? candidates.filter((c) => matchKind(c.name, undefined, derivedName))
    : [];
  const matches = originalMatches.length > 0 ? originalMatches : nameMatches;

  if (matches.length === 0) {
    throw new Error(
      `No Automate/App Automate hashed build ID matched observability build ` +
        `"${originalName ?? derivedName ?? "unknown"}".`,
    );
  }

  const products = new Set(matches.map((c) => c.sessionType));
  if (products.size > 1) {
    throw new Error(
      "Matched the same build name in both automate and app-automate. " +
        `Pass sessionType to disambiguate. Candidates: ${formatCandidates(matches)}`,
    );
  }

  const picked = pickByCloseness(matches, traDuration, traStartedAtMs);
  if (!picked) {
    throw new Error(
      `Multiple hashed builds share this name. Candidates: ${formatCandidates(matches)}`,
    );
  }
  return picked;
}

export async function resolveHashedBuildId(
  args: ResolveHashedBuildIdArgs,
  config: BrowserStackConfig,
): Promise<ResolvedHashedBuildId> {
  const observabilityId = parseObservabilityId(args.observabilityId);
  const tra = await fetchTraBuild(observabilityId, config);
  const directHashedId = extractDirectHashedId(tra);
  const products = productsToSearch(args.sessionType);

  const listed: RestBuildCandidate[] = [];
  for (const product of products) {
    listed.push(...(await listRestBuilds(product, config)));
  }

  if (directHashedId) {
    const byHash = listed.filter((c) => c.hashedId === directHashedId);
    if (byHash.length === 1) {
      return {
        hashedBuildId: directHashedId,
        sessionType: byHash[0].sessionType,
        name: byHash[0].name || tra.original_name || tra.name || "",
        observabilityId,
      };
    }
    if (byHash.length > 1) {
      const productsFound = new Set(byHash.map((c) => c.sessionType));
      if (productsFound.size > 1) {
        throw new Error(
          "Hashed build ID appears in both automate and app-automate. " +
            `Pass sessionType to disambiguate. Candidates: ${formatCandidates(byHash)}`,
        );
      }
      return {
        hashedBuildId: directHashedId,
        sessionType: byHash[0].sessionType,
        name: byHash[0].name || tra.original_name || tra.name || "",
        observabilityId,
      };
    }
    if (args.sessionType) {
      return {
        hashedBuildId: directHashedId,
        sessionType: args.sessionType,
        name: tra.original_name || tra.name || "",
        observabilityId,
      };
    }
  }

  const selected = selectByName(
    listed,
    tra.original_name,
    tra.name,
    typeof tra.duration === "number" ? tra.duration : undefined,
    parseTimestampMs(tra.started_at),
  );

  return {
    hashedBuildId: selected.hashedId,
    sessionType: selected.sessionType,
    name: selected.name,
    observabilityId,
  };
}
