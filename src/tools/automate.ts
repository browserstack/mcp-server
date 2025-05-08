import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger";
import { retrieveNetworkFailures } from "../lib/api";
import { trackMCP } from "../lib/instrumentation";

/**
 * Fetches failed network requests from a BrowserStack Automate session.
 * Returns network requests that resulted in errors or failed to complete.
 */
export async function getNetworkFailures(args: {
  sessionId: string;
}): Promise<CallToolResult> {
  try {
    const failureLogs = await retrieveNetworkFailures(args.sessionId);
    logger.info(
      "Successfully fetched failure network logs for session: %s",
      args.sessionId,
    );

    // Check if there are any failures
    const hasFailures = failureLogs.totalFailures > 0;
    const text = hasFailures
      ? `${failureLogs.totalFailures} network failure(s) found for session :\n\n${JSON.stringify(failureLogs.failures, null, 2)}`
      : `No network failures found for session`;

    return {
      content: [
        {
          type: "text",
          text,
        },
      ],
    };
  } catch (error) {
    logger.error("Failed to fetch network logs: %s", error);
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export default function addAutomateTools(server: McpServer) {
  server.tool(
    "getNetworkFailures",
    "Use this tool to fetch failed network requests from a BrowserStack Automate session.",
    {
      sessionId: z.string().describe("The Automate session ID."),
    },
    async (args) => {
      try {
        trackMCP("getNetworkFailures", server.server.getClientVersion()!);
        return await getNetworkFailures(args);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error("Failed to fetch network logs: %s", errorMessage);

        trackMCP(
          "getNetworkFailures",
          server.server.getClientVersion()!,
          error,
        );

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
    },
  );
}
