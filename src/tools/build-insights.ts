import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";
import { fetchFromBrowserStackAPI, handleMCPError } from "../lib/utils.js";
import { trackMCP } from "../lib/instrumentation.js";
import {
  isHashedBuildId,
  NoSessionsError,
  resolveHashedBuildId,
} from "./automate-utils/resolve-hashed-build-id.js";
import { mapHashedToTra } from "./automate-utils/resolve-tra-build-id.js";
import { getRegionalHost } from "../lib/regional-host.js";

// Tool function that fetches build insights from two APIs
export async function fetchBuildInsightsTool(
  args: { buildId: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const inputId = args.buildId.trim();
    let traBuildId = inputId;
    let fetched;
    try {
      fetched = await fetchInsightsData(traBuildId, config);
    } catch (error) {
      // An Automate hashed id is not a TRA build: map it, then retry once.
      if (!isNotFound(error) || !isHashedBuildId(inputId)) throw error;
      traBuildId = await mapHashedToTra(inputId, error, config);
      fetched = await fetchInsightsData(traBuildId, config);
    }
    const { buildData, qualityData } = fetched;

    const { hashed_id, session_type, sessions } =
      traBuildId === inputId
        ? await resolveInsightsHashedId(traBuildId, buildData, config)
        : { hashed_id: inputId, session_type: undefined, sessions: undefined };

    // Select useful fields for users
    const insights = {
      name: buildData.name,
      status: buildData.status,
      duration: buildData.duration,
      user: buildData.user,
      tags: buildData.tags,
      alerts: buildData.alerts,
      status_stats: buildData.status_stats,
      failure_categories: buildData.failure_categories,
      smart_tags: buildData.smart_tags,
      unique_errors: buildData.unique_errors?.overview,
      observability_url: buildData?.observability_url,
      ci_build_url: buildData.ci_info?.build_url,
      branch: buildData.vcs_info?.branch,
      commit_sha: buildData.vcs_info?.sha,
      vcs_name: buildData.vcs_info?.name,
      quality_gate_result: qualityData?.quality_gate_result,
      ...(traBuildId !== inputId ? { tra_build_id: traBuildId } : {}),
      ...(hashed_id ? { hashed_id } : {}),
      ...(session_type ? { session_type } : {}),
      ...(sessions ? { sessions } : {}),
    };

    const qualityProfiles = qualityData?.quality_profiles?.map(
      (profile: any) => ({
        name: profile.name,
        result: profile.result,
      }),
    );

    const qualityProfilesText =
      qualityProfiles && qualityProfiles.length > 0
        ? `Quality Gate Profiles (respond only if explicitly requested): ${JSON.stringify(qualityProfiles, null, 2)}`
        : "No Quality Gate Profiles available.";

    return {
      content: [
        {
          type: "text",
          text: "Build insights:\n" + JSON.stringify(insights, null, 2),
        },
        { type: "text", text: qualityProfilesText },
      ],
    };
  } catch (error) {
    logger.error("Error fetching build insights", error);
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

async function fetchInsightsData(buildId: string, config: BrowserStackConfig) {
  const host = getRegionalHost("automationApi");
  const encoded = encodeURIComponent(buildId);
  // Quality gate data is optional — a failure there should not block build insights
  const [buildData, qualityData] = await Promise.all([
    fetchFromBrowserStackAPI(`${host}/ext/v1/builds/${encoded}`, config),
    fetchFromBrowserStackAPI(
      `${host}/ext/v1/quality-gates/${encoded}`,
      config,
    ).catch((error) => {
      logger.warn("Failed to fetch quality gate data", error);
      return null;
    }),
  ]);
  return { buildData, qualityData };
}

/**
 * The observability build payload does not carry the Automate hashed build id
 * today. Prefer it if the API ever adds one; otherwise resolve it through any
 * session of the build (two deterministic REST calls). Never blocks insights.
 */
async function resolveInsightsHashedId(
  observabilityBuildId: string,
  buildData: unknown,
  config: BrowserStackConfig,
): Promise<{ hashed_id?: string; session_type?: string; sessions?: string }> {
  const direct = extractHashedBuildId(buildData);
  if (direct) {
    return { hashed_id: direct };
  }
  try {
    const resolved = await resolveHashedBuildId(observabilityBuildId, config);
    return {
      hashed_id: resolved.hashedBuildId,
      session_type: resolved.sessionType,
    };
  } catch (error) {
    if (error instanceof NoSessionsError) {
      return {
        sessions:
          "none: results were uploaded (e.g. JUnit), so there are no Automate sessions, logs or video",
      };
    }
    logger.warn("Could not resolve hashed build id for build insights", error);
    return {};
  }
}

function extractHashedBuildId(buildData: any): string | undefined {
  const candidates = [
    buildData?.hashed_id,
    buildData?.automate_hashed_id,
    buildData?.hashedId,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      /^[a-z0-9]{40}$/i.test(candidate.trim())
    )
      return candidate.trim();
  }
  return undefined;
}

// Registers the fetchBuildInsights tool with the MCP server
export default function addBuildInsightsTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchBuildInsights = server.tool(
    "fetchBuildInsights",
    "Fetch build details and quality gate results for a TRA build. Includes hashed_id and session_type for listSessions.",
    {
      buildId: z
        .string()
        .describe("TRA build id from listBuildId (Automate ids are mapped)."),
    },
    {
      title: "Fetch Build Insights",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      try {
        trackMCP(
          "fetchBuildInsights",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await fetchBuildInsightsTool(args, config);
      } catch (error) {
        return handleMCPError("fetchBuildInsights", server, config, error);
      }
    },
  );

  return tools;
}
