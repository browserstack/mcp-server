import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import {
  fetchLatestBuildId,
  fetchTraBuildName,
  findProject,
  listProjectBuilds,
  normaliseName,
  TraBuildRow,
} from "../rca-agent-utils/tra-builds.js";
import { sessionsListUrl } from "./list-session-ids.js";
import {
  resolveHashedBuildId,
  sessionDetailsUrl,
} from "./resolve-hashed-build-id.js";

export interface ResolvedTraBuild {
  traBuildId: string;
  hashedBuildId: string;
  sessionType: SessionType;
  projectName: string;
  buildName: string;
}

/** An Automate build that TRA cannot map back, with the reason as the message. */
export class TraBuildNotFoundError extends Error {
  /** Neither Automate nor App Automate knows the id: it may be a TRA id after all. */
  readonly unknownToAutomate: boolean;

  constructor(message: string, unknownToAutomate = false) {
    super(message);
    this.unknownToAutomate = unknownToAutomate;
    this.name = "TraBuildNotFoundError";
  }
}

/** Project and build name of an Automate / App Automate build, from its first session. */
async function readAutomateBuild(
  hashedBuildId: string,
  sessionType: SessionType,
  config: BrowserStackConfig,
): Promise<
  { projectName?: string; buildName?: string; startedAt?: string } | undefined
> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(getBrowserStackAuth(config)).toString("base64")}`,
  };
  const response = await apiClient.get({
    url: sessionsListUrl(sessionType, hashedBuildId),
    headers,
    params: { limit: 1 },
    raise_error: false,
  });
  if (!response.ok) return undefined;
  const items = Array.isArray(response.data) ? response.data : [];
  let session = items[0]?.automation_session;
  if (!session) return {};

  // The session detail always carries both names; read it if the list did not.
  if ((!session.project_name || !session.build_name) && session.hashed_id) {
    const detail = await apiClient.get({
      url: sessionDetailsUrl(sessionType, session.hashed_id),
      headers,
      raise_error: false,
    });
    if (detail.ok) session = detail.data?.automation_session ?? session;
  }
  return {
    projectName: session.project_name ?? undefined,
    buildName: session.build_name ?? undefined,
    startedAt: session.created_at ?? undefined,
  };
}

// Older runs: how many listing pages to walk, and how many candidates to confirm.
const OLDER_RUN_PAGES = 20;
const OLDER_RUN_CONFIRMATIONS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Find an older TRA run of the same build: walk the project's builds (filtered by
 * the dashboard label when known) for rows the SDK sent under the same name,
 * closest in start time first, and confirm each by resolving its hashed id.
 */
async function findOlderTraRun(
  hashedBuildId: string,
  build: { projectName: string; buildName: string; startedAt?: string },
  latestTraBuildId: string,
  sessionType: SessionType,
  config: BrowserStackConfig,
): Promise<{ traBuildId: string; sessionType: SessionType } | undefined> {
  const { project } = await findProject(build.projectName, config);
  if (!project) return undefined;

  const dashboardName = await fetchTraBuildName(latestTraBuildId, config);
  const wanted = normaliseName(build.buildName);
  const started = build.startedAt ? Date.parse(build.startedAt) : NaN;
  const rowTime = (row: TraBuildRow) =>
    row.startedAt ? Date.parse(row.startedAt) : NaN;

  const rows = await listProjectBuilds(project.id, config, {
    dashboardName,
    maxPages: OLDER_RUN_PAGES,
    // Pages are newest first: stop once they reach a day before this run began.
    stop: (seen) =>
      !Number.isNaN(started) &&
      seen.some((row) => rowTime(row) < started - DAY_MS),
  });

  const candidates = rows
    .filter(
      (row) =>
        row.buildId !== latestTraBuildId &&
        normaliseName(row.originalName) === wanted,
    )
    .sort((a, b) =>
      Number.isNaN(started)
        ? 0
        : Math.abs(rowTime(a) - started) - Math.abs(rowTime(b) - started),
    )
    .slice(0, OLDER_RUN_CONFIRMATIONS);

  for (const row of candidates) {
    const confirmed = await resolveHashedBuildId(
      row.buildId,
      config,
      sessionType,
    ).catch(() => undefined);
    if (confirmed?.hashedBuildId === hashedBuildId) {
      return { traBuildId: row.buildId, sessionType: confirmed.sessionType };
    }
  }
  return undefined;
}

/**
 * Map an Automate / App Automate hashed build id to its TRA build id: read the
 * project and build name from one of its sessions, look up TRA's latest build
 * with that name, and confirm it is the same run by resolving its hashed id back.
 * Throws TraBuildNotFoundError with a user-facing reason when it cannot.
 */
export async function resolveTraBuildIdFromHashed(
  hashedBuildId: string,
  config: BrowserStackConfig,
  preferred: SessionType = SessionType.Automate,
): Promise<ResolvedTraBuild> {
  const id = hashedBuildId.trim();
  const order = [
    preferred,
    preferred === SessionType.Automate
      ? SessionType.AppAutomate
      : SessionType.Automate,
  ];

  for (const sessionType of order) {
    const build = await readAutomateBuild(id, sessionType, config);
    if (!build) continue;
    if (!build.projectName || !build.buildName) {
      throw new TraBuildNotFoundError(
        `${sessionType} build "${id}" does not report a project and build name, ` +
          "so its TRA build cannot be found. Use listSessions with this id for its sessions.",
      );
    }

    const traBuildId = await fetchLatestBuildId(
      build.projectName,
      build.buildName,
      config,
    );
    if (!traBuildId) {
      throw new TraBuildNotFoundError(
        `${sessionType} build "${id}" (project "${build.projectName}", build ` +
          `"${build.buildName}") has no TRA build: only runs through the BrowserStack SDK ` +
          "report tests to TRA. Use listSessions and getFailureLogs with this id instead.",
      );
    }

    const confirmed = await resolveHashedBuildId(
      traBuildId,
      config,
      sessionType,
    ).catch(() => undefined);
    if (confirmed?.hashedBuildId === id) {
      return {
        traBuildId,
        hashedBuildId: id,
        sessionType: confirmed.sessionType,
        projectName: build.projectName,
        buildName: build.buildName,
      };
    }

    const older = await findOlderTraRun(
      id,
      {
        projectName: build.projectName,
        buildName: build.buildName,
        startedAt: build.startedAt,
      },
      traBuildId,
      sessionType,
      config,
    );
    if (!older) {
      throw new TraBuildNotFoundError(
        `${sessionType} build "${id}" (build "${build.buildName}" in project ` +
          `"${build.projectName}") matches no TRA run in the last year. Call listBuildId ` +
          "with that project, build name and the build number from the dashboard.",
      );
    }
    return {
      traBuildId: older.traBuildId,
      hashedBuildId: id,
      sessionType: older.sessionType,
      projectName: build.projectName,
      buildName: build.buildName,
    };
  }

  throw new TraBuildNotFoundError(
    `No Automate or App Automate build has id "${id}". Use the TRA build id from listBuildId.`,
    true,
  );
}

/** TRA id for an Automate hashed id, or the original 404 with the reason added. */
export async function mapHashedToTra(
  hashedBuildId: string,
  original: unknown,
  config: BrowserStackConfig,
): Promise<string> {
  try {
    return (await resolveTraBuildIdFromHashed(hashedBuildId, config))
      .traBuildId;
  } catch (error) {
    if (error instanceof TraBuildNotFoundError && !error.unknownToAutomate) {
      throw error;
    }
    throw new Error(
      `${original instanceof Error ? original.message : String(original)}. ` +
        "No TRA build has this id; get one with listBuildId.",
    );
  }
}
