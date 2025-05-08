import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getLatestO11YBuildInfo } from "../lib/api";
import { trackMCP } from "../lib/instrumentation";
import logger from "../logger";

export async function getFailuresInLastRun(
  buildName: string,
  projectName: string,
): Promise<CallToolResult> {
  const buildsData = await getLatestO11YBuildInfo(buildName, projectName);

  const observabilityUrl = buildsData.observability_url;
  if (!observabilityUrl) {
    throw new Error(
      "No observability URL found in build data, this is likely because the build is not yet available on BrowserStack Observability.",
    );
  }

  let overview = "No overview available";
  if (buildsData.unique_errors?.overview?.insight) {
    overview = buildsData.unique_errors.overview.insight;
  }

  let details = "No error details available";
  if (buildsData.unique_errors?.top_unique_errors?.length > 0) {
    details = buildsData.unique_errors.top_unique_errors
      .map((error: any) => error.error)
      .filter(Boolean)
      .join("\n");
  }

  return {
    content: [
      {
        type: "text",
        text: `Observability URL: ${observabilityUrl}\nOverview: ${overview}\nError Details: ${details}`,
      },
    ],
  };
}

export default function addObservabilityTools(server: McpServer) {
  server.tool(
    "getFailuresInLastRun",
    "Use this tool to debug failures in the last run of the test suite on BrowserStack. Use only when browserstack.yml file is present in the project root.",
    {
      buildName: z
        .string()
        .describe(
          "Name of the build to get failures for. This is the 'build' key in the browserstack.yml file. If not sure, ask the user for the build name.",
        ),
      projectName: z
        .string()
        .describe(
          "Name of the project to get failures for. This is the 'projectName' key in the browserstack.yml file. If not sure, ask the user for the project name.",
        ),
    },
    async (args) => {
      try {
        trackMCP("getFailuresInLastRun", server.server.getClientVersion()!);
        return await getFailuresInLastRun(args.buildName, args.projectName);
      } catch (error) {
        logger.error("Failed to get failures in the last run: %s", error);
        trackMCP(
          "getFailuresInLastRun",
          server.server.getClientVersion()!,
          error,
        );
        return {
          content: [
            {
              type: "text",
              text: `Failed to get failures in the last run. Error: ${error}. Please open an issue on GitHub if this is an issue with BrowserStack`,
              isError: true,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
