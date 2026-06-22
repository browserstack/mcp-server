export interface BuildSummary {
  build_id: string;
  build_number: number;
  status: string;
  started_at: string;
}

const BUILDS_API_BASE = "https://api-automation.browserstack.com/ext/v1";
const DEFAULT_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
// The project-builds endpoint sorts ascending within a date_range, so the
// newest runs sit at the end of the window. We anchor at the latest build and
// widen the span until we have enough runs.
const WINDOW_DAYS = [2, 7, 30, 180, 730];
const MAX_PAGES_PER_WINDOW = 60;

function authHeaders(username: string, accessKey: string) {
  return {
    Authorization:
      "Basic " + Buffer.from(`${username}:${accessKey}`).toString("base64"),
    "Content-Type": "application/json",
  };
}

/**
 * List the most recent build IDs for a given project + build name, newest first.
 */
export async function listBuildIds(
  projectName: string,
  buildName: string,
  username: string,
  accessKey: string,
  limit: number = DEFAULT_LIMIT,
): Promise<BuildSummary[]> {
  const headers = authHeaders(username, accessKey);

  // Resolve the project id from the latest build (no user_name filter).
  const latestUrl = new URL(`${BUILDS_API_BASE}/builds/latest`);
  latestUrl.searchParams.append("project_name", projectName);
  latestUrl.searchParams.append("build_name", buildName);

  const latestResponse = await fetch(latestUrl.toString(), { headers });
  if (!latestResponse.ok) {
    throw new Error(
      `Failed to resolve project: ${latestResponse.status} ${latestResponse.statusText}`,
    );
  }
  const latest = await latestResponse.json();
  const projectId = latest?.project_id;
  if (!projectId) {
    throw new Error(
      `No builds found for project "${projectName}" and build "${buildName}"`,
    );
  }

  // Anchor just after the latest run so it always falls inside the window.
  const anchorMs = latest.started_at
    ? Date.parse(latest.started_at) + DAY_MS
    : Date.now() + DAY_MS;

  let collected: BuildSummary[] = [];
  for (const windowDays of WINDOW_DAYS) {
    collected = await collectBuildsInWindow(
      projectId,
      buildName,
      anchorMs - windowDays * DAY_MS,
      anchorMs,
      limit,
      headers,
    );
    if (collected.length >= limit) {
      break;
    }
  }

  return collected.reverse();
}

/**
 * Walk the project-builds pages within [startMs, endMs], returning the last
 * `limit` runs (oldest-first) found in that window.
 */
async function collectBuildsInWindow(
  projectId: number,
  buildName: string,
  startMs: number,
  endMs: number,
  limit: number,
  headers: Record<string, string>,
): Promise<BuildSummary[]> {
  const tail: BuildSummary[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < MAX_PAGES_PER_WINDOW; page++) {
    const url = new URL(`${BUILDS_API_BASE}/projects/${projectId}/builds`);
    url.searchParams.append("unique_build_names", buildName);
    url.searchParams.append("date_range", String(startMs));
    url.searchParams.append("date_range", String(endMs));
    if (nextPage) {
      url.searchParams.append("next_page", nextPage);
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch builds: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();

    for (const build of data?.builds ?? []) {
      if (build.build_id) {
        tail.push({
          build_id: build.build_id,
          build_number: build.build_number,
          status: build.status,
          started_at: build.started_at,
        });
        if (tail.length > limit) {
          tail.shift();
        }
      }
    }

    if (!data?.pagination?.has_next || !data.pagination.next_page) {
      break;
    }
    nextPage = data.pagination.next_page;
  }

  return tail;
}
