import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import { fetchLatestBuildId } from "../rca-agent-utils/tra-builds.js";
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
  };
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
    if (confirmed?.hashedBuildId !== id) {
      // Only the latest run is mapped: walking older runs costs many calls per
      // lookup, and clients retry failed lookups.
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
