import { SessionType } from "../../lib/constants.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  isHashedBuildId,
  isTraBuildId,
} from "../automate-utils/resolve-hashed-build-id.js";
import { findAutomateBuildsByName } from "../automate-utils/find-automate-build.js";
import {
  resolveTraBuildIdFromHashed,
  TraBuildNotFoundError,
} from "../automate-utils/resolve-tra-build-id.js";
import {
  BUILD_LOOKUP_WINDOW_DAYS,
  fetchLatestBuildId,
  findProject,
  listProjectBuilds,
  normaliseName,
  TraBuildRow,
} from "./tra-builds.js";

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

const MAX_CANDIDATES = 5;
// One page per search: clients retry failed lookups.
const BUILD_PAGES = 1;

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

function describeRow(row: TraBuildRow): string {
  const parts = [`#${row.buildNumber ?? "?"}`];
  if (row.originalName && row.originalName !== row.name) {
    parts.push(`sent as "${row.originalName}"`);
  }
  if (row.startedAt) parts.push(`started ${row.startedAt.slice(0, 10)}`);
  if (row.status) parts.push(row.status);
  return `- "${row.name ?? row.originalName}" ${parts.join(", ")}: ${row.buildId}`;
}

function candidateList(rows: TraBuildRow[]): string {
  return newestFirst(rows).slice(0, MAX_CANDIDATES).map(describeRow).join("\n");
}

function newestFirst(rows: TraBuildRow[]): TraBuildRow[] {
  return [...rows].sort((a, b) => {
    const byTime = (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
    return byTime !== 0 ? byTime : (b.buildNumber ?? 0) - (a.buildNumber ?? 0);
  });
}

function latest(rows: TraBuildRow[]): TraBuildRow {
  return [...rows].sort(
    (a, b) => (b.buildNumber ?? 0) - (a.buildNumber ?? 0),
  )[0];
}

function foundNote(row: TraBuildRow, projectName: string, how: string): string {
  const sent =
    row.originalName && row.originalName !== row.name
      ? ` (the SDK sent it as "${row.originalName}")`
      : "";
  const link = row.observabilityUrl
    ? ` Dashboard: ${row.observabilityUrl}`
    : "";
  return (
    `Found "${row.name ?? row.originalName}" #${row.buildNumber ?? "?"} in project ` +
    `"${projectName}" by ${how}${sent}.${link}`
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

async function resolveInProject(
  projectName: string,
  buildName: string | undefined,
  buildNumber: number | undefined,
  config: BrowserStackConfig,
): Promise<BuildLookupResult> {
  const { project, similar } = await findProject(projectName, config);
  if (!project) {
    const hint = similar.length
      ? ` Similar projects: ${similar
          .slice(0, MAX_CANDIDATES)
          .map((p) => `"${p.name}"`)
          .join(", ")}.`
      : "";
    throw new BuildLookupError(
      `No TRA project named "${projectName}" found.${hint} Use the project name shown on the dashboard, or pass the TRA build id.`,
    );
  }

  const window = `the last ${BUILD_LOOKUP_WINDOW_DAYS} days`;
  const wantedName = normaliseName(buildName);
  const numberMatches = (row: TraBuildRow) =>
    buildNumber === undefined || row.buildNumber === buildNumber;

  if (buildName) {
    const byLabel = (
      await listProjectBuilds(project.id, config, {
        dashboardName: buildName,
        maxPages: BUILD_PAGES,
        stop: (rows) =>
          buildNumber === undefined || rows.some((r) => numberMatches(r)),
      })
    ).filter((row) => normaliseName(row.name) === wantedName);

    if (byLabel.length) {
      const hits = byLabel.filter(numberMatches);
      if (hits.length) {
        const row = latest(hits);
        return {
          buildId: row.buildId,
          note: foundNote(
            row,
            project.name,
            buildNumber === undefined
              ? "its dashboard name (latest run)"
              : "dashboard name and build number",
          ),
        };
      }
      throw new BuildLookupError(
        `"${buildName}" in "${project.name}" has no build #${buildNumber} among its latest runs. Pass the TRA build id for older runs. Latest runs:\n` +
          candidateList(byLabel),
      );
    }

    const recent = await listProjectBuilds(project.id, config, {
      maxPages: BUILD_PAGES,
    });
    const exact = recent.filter(
      (row) =>
        (normaliseName(row.originalName) === wantedName ||
          normaliseName(row.name) === wantedName) &&
        numberMatches(row),
    );
    if (exact.length) {
      const row = latest(exact);
      return {
        buildId: row.buildId,
        note: foundNote(row, project.name, "a case-insensitive name match"),
      };
    }
    const near = recent.filter(
      (row) =>
        normaliseName(row.originalName).includes(wantedName) ||
        normaliseName(row.name).includes(wantedName) ||
        (wantedName.includes(normaliseName(row.name)) && !!row.name),
    );
    const list = near.length ? near : recent;
    throw new BuildLookupError(
      `No build named "${buildName}" among the latest builds of "${project.name}". ` +
        (list.length
          ? `${near.length ? "Close matches" : "Recent builds"} (pass a TRA build id below, or its name and number):\n${candidateList(list)}`
          : `The project has no builds in ${window}.`),
    );
  }

  const recent = await listProjectBuilds(project.id, config, {
    maxPages: BUILD_PAGES,
    stop: (rows) => buildNumber !== undefined && rows.some(numberMatches),
  });
  if (!recent.length) {
    throw new BuildLookupError(
      `Project "${project.name}" has no builds in ${window}.`,
    );
  }

  if (buildNumber === undefined) {
    const row = newestFirst(recent)[0];
    return {
      buildId: row.buildId,
      note:
        foundNote(row, project.name, "being its most recent build") +
        `\nOther recent builds:\n${candidateList(recent.filter((r) => r !== row))}`,
    };
  }

  const hits = recent.filter(numberMatches);
  if (hits.length === 1) {
    return {
      buildId: hits[0].buildId,
      note: foundNote(hits[0], project.name, "build number"),
    };
  }
  throw new BuildLookupError(
    hits.length
      ? `Several builds in "${project.name}" are #${buildNumber}; pass browserStackBuildName too:\n${candidateList(hits)}`
      : `No build #${buildNumber} among the latest builds of "${project.name}". Latest builds:\n${candidateList(recent)}`,
  );
}

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

  if (!projectName) {
    const missing = new BuildLookupError(
      "Pass browserStackProjectName (from browserstack.yml or the dashboard), or buildUrl.",
    );
    if (!buildName || buildNumber !== undefined) throw missing;
    return searchAutomateBuilds(buildName, config, missing);
  }

  if (buildName && buildNumber === undefined) {
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
  }

  try {
    return await resolveInProject(projectName, buildName, buildNumber, config);
  } catch (error) {
    if (
      !(error instanceof BuildLookupError) ||
      !buildName ||
      buildNumber !== undefined
    ) {
      throw error;
    }
    return searchAutomateBuilds(buildName, config, error);
  }
}

async function searchAutomateBuilds(
  buildName: string,
  config: BrowserStackConfig,
  traError: BuildLookupError,
): Promise<BuildLookupResult> {
  const matches = await findAutomateBuildsByName(buildName, config).catch(
    () => [],
  );
  if (!matches.length) {
    throw new BuildLookupError(
      `${traError.message}\nNone of the latest Automate or App Automate builds is named "${buildName}" either.`,
    );
  }

  const [newest, ...others] = matches;
  const resolved = await resolveFromHashed(
    newest.hashedBuildId,
    newest.sessionType,
    config,
  ).catch((): BuildLookupResult => ({ buildId: newest.hashedBuildId }));
  const found = `Found ${newest.sessionType} build "${newest.name}" by name, not through TRA.`;
  const rest = others.length
    ? `\nOther builds with this name:\n${others
        .slice(0, MAX_CANDIDATES)
        .map((m) => `- ${m.sessionType}: ${m.hashedBuildId}`)
        .join("\n")}`
    : "";
  return {
    buildId: resolved.buildId,
    note: [found, resolved.note].filter(Boolean).join(" ") + rest,
  };
}
