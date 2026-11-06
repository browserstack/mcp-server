import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import { HttpError, isNotFoundError } from "../../lib/error.js";
import { fetchLatestBuildId } from "../rca-agent-utils/tra-builds.js";
import { sessionsListUrl } from "./list-session-ids.js";
import {
  resolveHashedBuildId,
  SessionNotOnFirstPageError,
  sessionDetailsUrl,
} from "./resolve-hashed-build-id.js";

export interface ResolvedTraBuild {
  traBuildId: string;
  hashedBuildId: string;
  sessionType: SessionType;
  projectName: string;
  buildName: string;
}

export class TraBuildNotFoundError extends Error {
  readonly unknownToAutomate: boolean;

  constructor(message: string, unknownToAutomate = false) {
    super(message);
    this.unknownToAutomate = unknownToAutomate;
    this.name = "TraBuildNotFoundError";
  }
}

async function readAutomateBuild(
  hashedBuildId: string,
  sessionType: SessionType,
  config: BrowserStackConfig,
): Promise<{ projectName?: string; buildName?: string } | undefined> {
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
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new HttpError(
      `Failed to read ${sessionType} build "${hashedBuildId}": ${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }
  const items = Array.isArray(response.data) ? response.data : [];
  let session = items[0]?.automation_session;
  if (!session) return {};

  if ((!session.project_name || !session.build_name) && session.hashed_id) {
    const detail = await apiClient.get({
      url: sessionDetailsUrl(sessionType, session.hashed_id),
      headers,
      raise_error: false,
    });
    if (!detail.ok && detail.status !== 404) {
      throw new HttpError(
        `Failed to read ${sessionType} session "${session.hashed_id}": ${detail.status} ${detail.statusText}`.trim(),
        detail.status,
      );
    }
    if (detail.ok) session = detail.data?.automation_session ?? session;
  }
  return {
    projectName: session.project_name ?? undefined,
    buildName: session.build_name ?? undefined,
  };
}

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
    ).catch((error) => {
      if (error instanceof HttpError && !isNotFoundError(error)) throw error;
      if (error instanceof SessionNotOnFirstPageError) {
        throw new TraBuildNotFoundError(
          `Could not confirm that TRA build ${traBuildId} is ${sessionType} build "${id}": ` +
            "no test on its first page has a session. Use listSessions with " +
            `"${id}" for its sessions.`,
        );
      }
      return undefined;
    });
    if (confirmed?.hashedBuildId !== id) {
      throw new TraBuildNotFoundError(
        `${sessionType} build "${id}" is not the latest TRA build named ` +
          `"${build.buildName}" in project "${build.projectName}". Call listBuildId with ` +
          "that project, build name and the build number from the dashboard.",
      );
    }

    return {
      traBuildId,
      hashedBuildId: id,
      sessionType: confirmed.sessionType,
      projectName: build.projectName,
      buildName: build.buildName,
    };
  }

  throw new TraBuildNotFoundError(
    `No Automate or App Automate build has id "${id}". Use the TRA build id from listBuildId.`,
    true,
  );
}

export async function mapHashedToTra(
  hashedBuildId: string,
  original: unknown,
  config: BrowserStackConfig,
): Promise<ResolvedTraBuild> {
  try {
    return await resolveTraBuildIdFromHashed(hashedBuildId, config);
  } catch (error) {
    if (!(error instanceof TraBuildNotFoundError)) throw error;
    if (!error.unknownToAutomate) throw error;
    throw new Error(
      `${original instanceof Error ? original.message : String(original)}. ` +
        "No TRA build has this id; get one with listBuildId.",
    );
  }
}
