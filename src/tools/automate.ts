import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger";
import { downloadNetworkLogs } from "../lib/api";

/**
 * Fetches network logs for a BrowserStack Automate session and saves them locally.
 * The logs are retrieved in HAR format and contain detailed network traffic information
 */
export async function fetchNetworkLogs(args: {
  sessionId: string;
}): Promise<CallToolResult> {
  try {
    const response = await downloadNetworkLogs(args.sessionId);

    logger.info("Successfully fetched network logs: %s", response.filepath);
    return {
      content: [
        {
          type: "text",
          text: `Network logs saved to: ${response.filepath}`,
        },
      ],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    logger.error("Error in fetchNetworkLogs: %s", errorMessage);
    return {
      content: [
        {
          type: "text",
          text: `Error fetching network logs: ${errorMessage}`,
          isError: true,
        },
      ],
      isError: true,
    };
  }
}

export default function addAutomateTools(server: McpServer) {
  server.tool(
    "fetchNetworkLogs",
    "Use this tool to fetch network logs of a Automate session.",
    {
      sessionId: z.string().describe("The Automate session ID."),
    },
    async (args) => {
      try {
        return await fetchNetworkLogs(args);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        logger.error("Error in fetchNetworkLogs tool: %s", errorMessage);
        return {
          content: [
            {
              type: "text",
              text: `Error fetching network logs: ${errorMessage}`,
              isError: true,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
