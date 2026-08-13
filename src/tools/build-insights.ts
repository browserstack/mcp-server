import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";
import { fetchFromBrowserStackAPI, handleMCPError } from "../lib/utils.js";
import { trackMCP } from "../lib/instrumentation.js";

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
      quality_gate_result: qualityData.quality_gate_result,
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

// Registers the fetchBuildInsights tool with the MCP server
export default function addBuildInsightsTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchBuildInsights = server.tool(
    "fetchBuildInsights",
    "Fetches insights about a BrowserStack build by combining build details and quality gate results.",
    {
      buildId: z.string().describe("The build UUID of the BrowserStack build"),
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
