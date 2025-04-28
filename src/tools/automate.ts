import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger";
import { retrieveNetworkFailures } from "../lib/api";

/**
 * Fetches failed network requests from a BrowserStack Automate session.
 * Returns network requests that resulted in errors or failed to complete.
 */
export async function getNetworkFailures(args: {
  sessionId: string;
}): Promise<CallToolResult> {
  try {
    const failureLogs = await retrieveNetworkFailures(args.sessionId);
    logger.info("Successfully fetched failure network logs for session: %s", args.sessionId);

    return {
      content: [
        {
          type: "text",
          text:
            `Found ${failureLogs.totalFailures} failure network log(s) for session ${args.sessionId}.\n\n` +
            (failureLogs.totalFailures > 0
              ? JSON.stringify(failureLogs.failures, null, 2)
              : "No failure logs found."),
        },
      ],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    logger.error("Failed to fetch network logs: %s", errorMessage);

    return {
      content: [
        {
          type: "text",
          text: `Failed to fetch network logs: ${errorMessage}`,
          isError: true,
        },
      ],
      isError: true,
    };
  }
}

export default function addAutomateTools(server: McpServer) {
  server.tool(
    "getNetworkFailures",
    "Use this tool to fetch failed network requests from a BrowserStack Automate session.",
    {
      sessionId: z.string().describe("The Automate session ID."),
    },
    getNetworkFailures,
  );
}
