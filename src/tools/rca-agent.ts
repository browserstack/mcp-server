import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";
import { getBrowserStackAuth } from "../lib/get-auth.js";
import { getBuildId } from "./rca-agent-utils/get-build-id.js";
import { getTestIds } from "./rca-agent-utils/get-failed-test-id.js";
import { getRCAData } from "./rca-agent-utils/rca-data.js";
import { formatRCAData } from "./rca-agent-utils/format-rca.js";
import { TestStatus } from "./rca-agent-utils/types.js";
import { handleMCPError } from "../lib/utils.js";
import { trackMCP } from "../index.js";
import { BuildIdArgs } from "./rca-agent-utils/types.js";
import {
  FETCH_RCA_PARAMS,
  GET_BUILD_ID_PARAMS,
  LIST_TEST_IDS_PARAMS,
} from "./rca-agent-utils/constants.js";

// Tool function to fetch build ID
export async function getBuildIdTool(
  args: BuildIdArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const { browserStackProjectName, browserStackBuildName } = args;

    const authString = getBrowserStackAuth(config);
    const [username, accessKey] = authString.split(":");

    const buildId = await getBuildId(
      browserStackProjectName,
      browserStackBuildName,
      username,
      accessKey,
    );

    return {
      content: [
        {
          type: "text",
          text: buildId,
        },
      ],
    };
  } catch (error) {
    logger.error("Error fetching build ID", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: `Error fetching build ID: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

// Tool function that fetches RCA data
export async function fetchRCADataTool(
  args: { testId: number[] },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const authString = getBrowserStackAuth(config);

    // Limit to first 3 test IDs for performance
    const testIds = args.testId;

    const rcaData = await getRCAData(testIds, authString);

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
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: `Error fetching RCA data: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

export async function listTestIdsTool(
  args: {
    buildId: string;
    status?: TestStatus;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const { buildId, status } = args;
    const authString = getBrowserStackAuth(config);

    // Get test IDs
    const testIds = await getTestIds(buildId, authString, status);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(testIds, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error("Error listing test IDs", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: `Error listing test IDs: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

export default function addRCATools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchRCA = server.tool(
    "fetchRCA",
    "Retrieves AI-RCA (Root Cause Analysis) data for a BrowserStack Automate and App-Automate session and provides insights into test failures.",
    FETCH_RCA_PARAMS,
    async (args) => {
      try {
        trackMCP("fetchRCA", server.server.getClientVersion()!, config);
        return await fetchRCADataTool(args, config);
      } catch (error) {
        return handleMCPError("fetchRCA", server, config, error);
      }
    },
  );

  tools.getBuildId = server.tool(
    "getBuildId",
    "Get the BrowserStack build ID for a given project and build name.",
    GET_BUILD_ID_PARAMS,
    async (args) => {
      try {
        trackMCP("getBuildId", server.server.getClientVersion()!, config);
        return await getBuildIdTool(args, config);
      } catch (error) {
        return handleMCPError("getBuildId", server, config, error);
      }
    },
  );

  tools.listTestIds = server.tool(
    "listTestIds",
    "List test IDs from a BrowserStack Automate build, optionally filtered by status",
    LIST_TEST_IDS_PARAMS,
    async (args) => {
      try {
        trackMCP("listTestIds", server.server.getClientVersion()!, config);
        return await listTestIdsTool(args, config);
      } catch (error) {
        return handleMCPError("listTestIds", server, config, error);
      }
    },
  );

  return tools;
}
