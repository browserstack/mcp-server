import { apiClient } from "../../lib/apiClient.js";
import { HttpError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getAutomationBaseUrl } from "./constants.js";

// Each TRA build has two names: `original_name` (what the SDK sent; only
// /builds/latest matches it) and `name` (the dashboard label; only the project
// build listing's `unique_build_names` filter matches it).

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

export const BUILD_LOOKUP_WINDOW_DAYS = 365;

// The project list has no name filter; kept low because clients retry failed lookups.
const MAX_PROJECT_PAGES = 5;

function authHeaders(config: BrowserStackConfig): Record<string, string> {
  const auth = Buffer.from(getBrowserStackAuth(config)).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };
}

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
  return new HttpError(
    `Failed to ${what}: ${status} ${statusText}`.trim(),
    status,
  );
}

export function normaliseName(value: string | undefined): string {
  return (value ?? "").replace(/\+/g, " ").trim().toLowerCase();
}

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

export async function findProject(
  projectName: string,
  config: BrowserStackConfig,
): Promise<{
  project?: TraProject;
  similar: TraProject[];
  /** The page cap ended the search, so the project may still exist. */
  truncated: boolean;
  /** How many projects were checked. */
  searched: number;
}> {
  const wanted = normaliseName(projectName);
  const similar: TraProject[] = [];
  let nextPage: string | undefined;
  let searched = 0;

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
    if (projects.length === 0) return { similar, truncated: false, searched };

    for (const row of projects) {
      searched++;
      if (typeof row?.id !== "number" || typeof row?.name !== "string")
        continue;
      const project = { id: row.id, name: row.name };
      const name = normaliseName(row.name);
      if (name === wanted)
        return { project, similar, truncated: false, searched };
      if (name.includes(wanted) || wanted.includes(name)) similar.push(project);
    }

    const cursor = response.data?.pagination?.next_page;
    if (!response.data?.pagination?.has_next || !cursor) {
      return { similar, truncated: false, searched };
    }
    nextPage = cursor;
  }
  return { similar, truncated: nextPage !== undefined, searched };
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
    // The route splits list params on commas, so such names skip the filter.
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
