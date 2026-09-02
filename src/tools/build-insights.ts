import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";
import { fetchFromBrowserStackAPI, handleMCPError } from "../lib/utils.js";
import { trackMCP } from "../lib/instrumentation.js";
import {
  extractDirectHashedId,
  resolveHashedBuildId,
} from "./automate-utils/resolve-hashed-build-id.js";

// Tool function that fetches build insights from two APIs
export async function fetchBuildInsightsTool(
  args: { buildId: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const buildUrl = `https://api-automation.browserstack.com/ext/v1/builds/${args.buildId}`;
    const qualityGateUrl = `https://api-automation.browserstack.com/ext/v1/quality-gates/${args.buildId}`;

    const [buildData, qualityData] = await Promise.all([
      fetchFromBrowserStackAPI(buildUrl, config),
      fetchFromBrowserStackAPI(qualityGateUrl, config),
    ]);

    const hashed_id = await resolveInsightsHashedId(
      args.buildId,
      buildData,
      config,
    );

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
      quality_gate_result: qualityData.quality_gate_result,
      ...(hashed_id ? { hashed_id } : {}),
    };

    const qualityProfiles = qualityData.quality_profiles?.map(
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

async function resolveInsightsHashedId(
  observabilityId: string,
  buildData: unknown,
  config: BrowserStackConfig,
): Promise<string | undefined> {
  const direct = extractDirectHashedId(
    (buildData ?? {}) as Parameters<typeof extractDirectHashedId>[0],
  );
  if (direct) {
    return direct;
  }

  try {
    const resolved = await resolveHashedBuildId({ observabilityId }, config);
    return resolved.hashedBuildId;
  } catch (error) {
    logger.error(
      "Could not resolve Automate hashed_id for build insights",
      error,
    );
    return undefined;
  }
}

// Registers the fetchBuildInsights tool with the MCP server
export default function addBuildInsightsTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchBuildInsights = server.tool(
    "fetchBuildInsights",
    "Fetches insights about a BrowserStack build by combining build details and quality gate results. The insights JSON includes hashed_id (the Automate/App Automate REST build id used by listSessionIds) when it can be resolved from observability or Automate REST.",
    {
      buildId: z.string().describe("The build UUID of the BrowserStack build"),
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
