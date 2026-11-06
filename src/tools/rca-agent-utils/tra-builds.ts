import { apiClient } from "../../lib/apiClient.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getAutomationBaseUrl } from "./constants.js";

/**
 * Thin wrappers over the public Test Reporting & Analytics (TRA) build routes.
 *
 * Two names exist for every TRA build, and each route matches only one of them:
 *  - `original_name` is what the SDK sent (browserstack.yml `buildName`). Only
 *    `/builds/latest` matches it.
 *  - `name` is the normalised label the dashboard shows, with dynamic parts
 *    stripped ("patc204-junit-105mb" is shown as "junit"). Only the project build
 *    listing's `unique_build_names` filter matches it.
 */

export interface TraBuildRow {
  buildId: string;
  name?: string;
  originalName?: string;
  buildNumber?: number;
  status?: string;
  user?: string;
  startedAt?: string;
  observabilityUrl?: string;
}

export interface TraProject {
  id: number;
  name: string;
}

// Builds older than this are not searched by the fallback lookups.
export const BUILD_LOOKUP_WINDOW_DAYS = 365;

// Project pages hold at most 10 rows; this bounds the walk at ~500 projects.
const MAX_PROJECT_PAGES = 50;

function authHeaders(config: BrowserStackConfig): Record<string, string> {
  const auth = Buffer.from(getBrowserStackAuth(config)).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };
}

/** Transport failures (no HTTP status) are retried once; HTTP errors are not. */
async function getWithRetry(
  url: string,
  config: BrowserStackConfig,
  params?: Record<string, string | number>,
) {
  const request = () =>
    apiClient.get({
      url,
      headers: authHeaders(config),
      ...(params ? { params } : {}),
      raise_error: false,
    });
  try {
    return await request();
  } catch {
    return await request();
  }
}

function httpError(what: string, status: number, statusText: string): Error {
  return new Error(`Failed to ${what}: ${status} ${statusText}`.trim());
}

/** Normalise a name for comparison: case, surrounding space, and "+" for space. */
export function normaliseName(value: string | undefined): string {
  return (value ?? "").replace(/\+/g, " ").trim().toLowerCase();
}

/**
 * Latest build whose SDK-sent name matches exactly. Returns undefined on 404 so
 * callers can fall back to the other lookups.
 */
export async function fetchLatestBuildId(
  projectName: string,
  buildName: string,
  config: BrowserStackConfig,
  userName?: string,
): Promise<string | undefined> {
  const params: Record<string, string> = {
    project_name: projectName,
    build_name: buildName,
  };
  if (userName) params.user_name = userName;

  const response = await getWithRetry(
    `${getAutomationBaseUrl()}/ext/v1/builds/latest`,
    config,
    params,
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw httpError(
      "look up the latest build",
      response.status,
      response.statusText,
    );
  }
  const buildId = response.data?.build_id;
  return typeof buildId === "string" && buildId ? buildId : undefined;
}

/**
 * Find a TRA project by name. Returns the exact (case-insensitive) match, or the
 * projects whose names contain the term when there is none.
 */
export async function findProject(
  projectName: string,
  config: BrowserStackConfig,
): Promise<{ project?: TraProject; similar: TraProject[] }> {
  const wanted = normaliseName(projectName);
  const similar: TraProject[] = [];
  let nextPage: string | undefined;

  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const response = await getWithRetry(
      `${getAutomationBaseUrl()}/ext/v1/projects`,
      config,
      nextPage ? { next_page: nextPage } : undefined,
    );
    if (!response.ok) {
      throw httpError("list projects", response.status, response.statusText);
    }
    const projects: any[] = response.data?.projects ?? [];
    // The last full page still reports has_next; an empty page is the real end.
    if (projects.length === 0) break;

    for (const row of projects) {
      if (typeof row?.id !== "number" || typeof row?.name !== "string")
        continue;
      const project = { id: row.id, name: row.name };
      const name = normaliseName(row.name);
      if (name === wanted) return { project, similar };
      if (name.includes(wanted) || wanted.includes(name)) similar.push(project);
    }

    const cursor = response.data?.pagination?.next_page;
    if (!response.data?.pagination?.has_next || !cursor) break;
    nextPage = cursor;
  }
  return { similar };
}

function toRow(raw: any): TraBuildRow | undefined {
  if (typeof raw?.build_id !== "string" || !raw.build_id) return undefined;
  return {
    buildId: raw.build_id,
    name: raw.name ?? undefined,
    originalName: raw.original_name ?? undefined,
    buildNumber:
      typeof raw.build_number === "number" ? raw.build_number : undefined,
    status: raw.status ?? undefined,
    user: raw.user ?? undefined,
    startedAt: raw.started_at ?? undefined,
    observabilityUrl: raw.observability_url ?? undefined,
  };
}

/**
 * A project's builds from the last BUILD_LOOKUP_WINDOW_DAYS, newest pages first.
 * `dashboardName` filters on the dashboard label (not the SDK-sent name). Stops
 * early once `stop` returns true for the rows collected so far.
 */
export async function listProjectBuilds(
  projectId: number,
  config: BrowserStackConfig,
  options: {
    dashboardName?: string;
    maxPages: number;
    stop?: (rows: TraBuildRow[]) => boolean;
    now?: number;
  },
): Promise<TraBuildRow[]> {
  const end = options.now ?? Date.now();
  const start = end - BUILD_LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const rows: TraBuildRow[] = [];
  let nextPage: string | undefined;

  for (let page = 0; page < options.maxPages; page++) {
    const params: Record<string, string | number> = {
      date_range: `${start},${end}`,
    };
    // Comma-joined arrays are how the route binds lists, so a comma inside the
    // name would split it; such names fall through to the unfiltered walk.
    if (options.dashboardName && !options.dashboardName.includes(",")) {
      params.unique_build_names = options.dashboardName;
    }
    if (nextPage) params.next_page = nextPage;

    const response = await getWithRetry(
      `${getAutomationBaseUrl()}/ext/v1/projects/${encodeURIComponent(String(projectId))}/builds`,
      config,
      params,
    );
    if (!response.ok) {
      throw httpError(
        "list project builds",
        response.status,
        response.statusText,
      );
    }
    for (const raw of response.data?.builds ?? []) {
      const row = toRow(raw);
      if (row) rows.push(row);
    }
    if (options.stop?.(rows)) break;

    const cursor = response.data?.pagination?.next_page;
    if (!response.data?.pagination?.has_next || !cursor) break;
    nextPage = cursor;
  }
  return rows;
}

/** The dashboard label of a TRA build, or undefined when it cannot be read. */
export async function fetchTraBuildName(
  buildId: string,
  config: BrowserStackConfig,
): Promise<string | undefined> {
  const response = await getWithRetry(
    `${getAutomationBaseUrl()}/ext/v1/builds/${encodeURIComponent(buildId)}`,
    config,
  ).catch(() => undefined);
  const name = response?.ok ? response.data?.name : undefined;
  return typeof name === "string" && name ? name : undefined;
}
