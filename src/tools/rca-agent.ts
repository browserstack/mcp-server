import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";
import { getBrowserStackAuth } from "../lib/get-auth.js";
import { getBuildId } from "./rca-agent-utils/get-build-id.js";
import { getFailedTestIds } from "./rca-agent-utils/get-failed-test-id.js";
import { getRCAData } from "./rca-agent-utils/rca-data.js";
import { formatRCAData } from "./rca-agent-utils/format-rca.js";

// wTool function that fetches RCA data
export async function fetchRCADataTool(
  args: { projectName: string; buildName: string; buildId?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    let { projectName, buildName, buildId } = args;
    const authString = getBrowserStackAuth(config);
    const [username, accessKey] = authString.split(":");
    buildId = buildId || await getBuildId(projectName, buildName, username, accessKey);
    const testInfos = await getFailedTestIds(buildId, authString);
    const rcaData = await getRCAData(testInfos.slice(0, 3), authString);

    const formattedData = formatRCAData(rcaData);

    return {
      content: [
        {
          type: "text",
          text: formattedData,
        },
      ],
    };
  } catch (error) {
    logger.error("Error fetching RCA data", error);
    throw error;
  }
}

// Registers the fetchRCA tool with the MCP server
export default function addRCATools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchRCA = server.tool(
    "fetchRCA",
    "Retrieves AI-RCA (Root Cause Analysis) data for a BrowserStack Automate session and provides insights into test failures.",
    {
      projectName: z
        .string()
        .describe(
          "The project name of the test run can be available in browsrestack yml or ask it from user",
        ),
      buildName: z
        .string()
        .describe(
          "The build name of the test run can be available in browsrestack yml or ask it from user",
        ),
      buildId: z
        .string()
        .optional()
        .describe(
          "The build ID of the test run.",
        ),
    },
    async (args) => {
      try {
        return await fetchRCADataTool(args, config);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error during fetching RCA data: ${errorMessage}`,
            },
          ],
        };
      }
    },
  );

  return tools;
}
