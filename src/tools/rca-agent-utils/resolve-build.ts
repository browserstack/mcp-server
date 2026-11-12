import { SessionType } from "../../lib/constants.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  isHashedBuildId,
  isTraBuildId,
} from "../automate-utils/resolve-hashed-build-id.js";
import {
  resolveTraBuildIdFromHashed,
  TraBuildNotFoundError,
} from "../automate-utils/resolve-tra-build-id.js";
import { fetchLatestBuildId } from "./tra-builds.js";
import { HttpError } from "../../lib/error.js";
import {
  callCapability,
  CapabilityUnavailableError,
} from "../capability-registry/call.js";
import { InvocationError } from "../capability-registry/index-loader.js";

export interface BuildLookupInput {
  browserStackProjectName?: string;
  browserStackBuildName?: string;
  buildNumber?: number;
  buildUrl?: string;
}

export interface BuildLookupResult {
  buildId: string;
  note?: string;
}

export class BuildLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildLookupError";
  }
}

export interface ParsedBuildUrl {
  projectName?: string;
  buildName?: string;
  buildNumber?: number;
  traBuildId?: string;
  hashedBuildId?: string;
  sessionType?: SessionType;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, " "));
  } catch {
    return segment.replace(/\+/g, " ");
  }
}

// TRA links (also served on the Automate dashboard): .../projects/<project>/builds/<name>/<number>
// Automate links: .../builds/<hashed id>[/sessions/<id>]
export function parseBuildUrl(input: string): ParsedBuildUrl | undefined {
  const raw = input.trim();
  if (isTraBuildId(raw)) return { traBuildId: raw };
  if (isHashedBuildId(raw)) return { hashedBuildId: raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const sessionType = url.hostname.includes("app-automate")
    ? SessionType.AppAutomate
    : SessionType.Automate;

  const projectsAt = segments.indexOf("projects");
  if (projectsAt >= 0 && segments[projectsAt + 2] === "builds") {
    const projectName = decodeSegment(segments[projectsAt + 1] ?? "");
    const buildName = segments[projectsAt + 3]
      ? decodeSegment(segments[projectsAt + 3])
      : undefined;
    const number = Number(segments[projectsAt + 4]);
    if (projectName) {
      return {
        projectName,
        buildName,
        ...(Number.isInteger(number) && number > 0
          ? { buildNumber: number }
          : {}),
      };
    }
  }

  const buildsAt = segments.indexOf("builds");
  const afterBuilds = buildsAt >= 0 ? segments[buildsAt + 1] : undefined;
  if (afterBuilds && isHashedBuildId(afterBuilds)) {
    return { hashedBuildId: afterBuilds, sessionType };
  }
  if (afterBuilds && isTraBuildId(afterBuilds)) {
    return { traBuildId: afterBuilds };
  }
  return undefined;
}

// The build-number lookup is defined in the TRA capability index and called through
// the registry, so its endpoint is maintained in one place.
export const BUILD_BY_NUMBER_CAPABILITY = "get_build_id_from_build_coordinates";

async function buildByNumber(
  projectName: string,
  buildName: string,
  buildNumber: number,
  config: BrowserStackConfig,
): Promise<BuildLookupResult> {
  let result;
  try {
    result = await callCapability(
      "tra",
      BUILD_BY_NUMBER_CAPABILITY,
      {
        query: {
          projectNormalisedName: projectName,
          buildNormalisedName: buildName,
          buildSerialId: buildNumber,
        },
      },
      config,
    );
  } catch (error) {
    if (
      error instanceof CapabilityUnavailableError ||
      error instanceof InvocationError
    ) {
      throw new BuildLookupError(
        `Looking up a build by number is not available here (${error.message}). ` +
          "Pass the TRA build id, or project + the build name from browserstack.yml " +
          "for its latest run.",
      );
    }
    throw error;
  }

  const { status, body } = result.http_response;
  const buildId = (body as { buildId?: unknown } | null)?.buildId;
  if (result.ok && typeof buildId === "string" && buildId) {
    return {
      buildId,
      note: `Build #${buildNumber} of "${buildName}" in "${projectName}".`,
    };
  }
  if (status === 404 || result.ok) {
    throw new BuildLookupError(
      `No build #${buildNumber} named "${buildName}" in "${projectName}". With a build ` +
        "number, use the build name shown on the dashboard (as in the TRA build link), " +
        "which can be shorter than the name in browserstack.yml.",
    );
  }
  throw new HttpError(
    `Failed to look up build #${buildNumber}: ${status} ${result.http_response.error ?? ""}`.trim(),
    status,
  );
}

async function resolveFromHashed(
  hashedBuildId: string,
  sessionType: SessionType | undefined,
  config: BrowserStackConfig,
): Promise<BuildLookupResult> {
  try {
    const resolved = await resolveTraBuildIdFromHashed(
      hashedBuildId,
      config,
      sessionType,
    );
    return {
      buildId: resolved.traBuildId,
      note:
        `TRA build for ${resolved.sessionType} build ${hashedBuildId} ` +
        `("${resolved.buildName}" in "${resolved.projectName}"). listSessions takes either id.`,
    };
  } catch (error) {
    if (!(error instanceof TraBuildNotFoundError)) throw error;
    // Possibly an older all-hex TRA id.
    if (error.unknownToAutomate) return { buildId: hashedBuildId };
    return {
      buildId: hashedBuildId,
      note:
        `This is an Automate hashed build id. ${error.message} ` +
        "listTestIds and fetchRCA need a TRA build id and do not apply.",
    };
  }
}

/**
 * No paging: a TRA id is returned as is, an Automate id is mapped, a name
 * without a number is the latest run, and a name with a number is one call to
 * the build-number capability.
 */
export async function resolveBuild(
  input: BuildLookupInput,
  config: BrowserStackConfig,
  options: { userName?: string } = {},
): Promise<BuildLookupResult> {
  let projectName = input.browserStackProjectName?.trim() || undefined;
  let buildName = input.browserStackBuildName?.trim() || undefined;
  let buildNumber = input.buildNumber;

  if (input.buildUrl) {
    const parsed = parseBuildUrl(input.buildUrl);
    if (!parsed) {
      throw new BuildLookupError(
        "Could not read a build from that link. Expected a TRA link " +
          "(.../projects/<project>/builds/<name>/<number>) or an Automate build link (.../builds/<id>).",
      );
    }
    if (parsed.traBuildId) {
      return { buildId: parsed.traBuildId };
    }
    if (parsed.hashedBuildId) {
      return resolveFromHashed(
        parsed.hashedBuildId,
        parsed.sessionType,
        config,
      );
    }
    projectName = parsed.projectName ?? projectName;
    buildName = parsed.buildName ?? buildName;
    buildNumber = parsed.buildNumber ?? buildNumber;
  }

  if (!projectName || !buildName) {
    throw new BuildLookupError(
      "Pass browserStackProjectName and browserStackBuildName (from browserstack.yml " +
        "or the dashboard), or buildUrl.",
    );
  }

  if (buildNumber !== undefined) {
    return buildByNumber(projectName, buildName, buildNumber, config);
  }

  if (options.userName) {
    const own = await fetchLatestBuildId(
      projectName,
      buildName,
      config,
      options.userName,
    );
    if (own) return { buildId: own };
  }
  const anyone = await fetchLatestBuildId(projectName, buildName, config);
  if (anyone) {
    return options.userName
      ? {
          buildId: anyone,
          note: "None of your own builds has this name; this is the latest run by anyone.",
        }
      : { buildId: anyone };
  }

  throw new BuildLookupError(
    `No build in "${projectName}" was sent with the name "${buildName}". The latest-build ` +
      "lookup matches the name from browserstack.yml (buildName), which can differ from " +
      "the name on the dashboard. Pass that name, or the build number or dashboard link.",
  );
}
