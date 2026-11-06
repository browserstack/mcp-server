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

export interface BuildLookupInput {
  browserStackProjectName?: string;
  browserStackBuildName?: string;
  buildNumber?: number;
  buildUrl?: string;
}

/** A capability call the client makes to finish the lookup. */
export interface CapabilityCall {
  name: string;
  product: string;
  query: Record<string, string | number>;
}

export type BuildLookupResult =
  | { buildId: string; note?: string }
  | { capability: CapabilityCall; note: string };

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

// The build-number lookup lives in the TRA capability index, so its endpoint is
// defined once there; the tool hands the client a ready call.
export const BUILD_BY_NUMBER_CAPABILITY = "get_build_id_from_build_coordinates";

function buildByNumber(
  projectName: string,
  buildName: string,
  buildNumber: number,
): BuildLookupResult {
  const capability: CapabilityCall = {
    name: BUILD_BY_NUMBER_CAPABILITY,
    product: "tra",
    query: {
      projectNormalisedName: projectName,
      buildNormalisedName: buildName,
      buildSerialId: buildNumber,
    },
  };
  return {
    capability,
    note:
      `To get build #${buildNumber} of "${buildName}", call invokeCapability with ` +
      `${JSON.stringify(capability)}. Its buildId is the TRA build id. The build name ` +
      "must be the one in the TRA dashboard link; a 404 means no build has that " +
      "name and number.",
  };
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
 * One request at most: a TRA id is returned as is, an Automate id is mapped, a
 * name without a number is the latest run, and a name with a number is handed
 * to the build-number capability.
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
    return buildByNumber(projectName, buildName, buildNumber);
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
