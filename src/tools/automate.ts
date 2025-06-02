import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fetchAutomationScreenshots } from "./automate-utils/fetch-screenshots.js";
import { SessionType } from "../lib/constants.js";
import { trackMCP } from "../lib/instrumentation.js";
import logger from "../logger.js";

// Tool function that fetches and processes screenshots from BrowserStack Automate session
export async function fetchAutomationScreenshotsTool(args: {
  sessionId: string;
  sessionType: SessionType;
}): Promise<CallToolResult> {
  try {
    const screenshots = await fetchAutomationScreenshots(
      args.sessionId,
      args.sessionType,
    );

    if (screenshots.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No screenshots found in the session or some unexpected error occurred",
          },
        ],
        isError: true,
      };
    }

    const results = screenshots.map((screenshot, index) => ({
      type: "image" as const,
      text: `Screenshot ${index + 1}`,
      data: screenshot.base64,
      mimeType: "image/png",
      metadata: { url: screenshot.url },
    }));

    return {
      content: [
        {
          type: "text",
          text: `Retrieved ${screenshots.length} screenshot(s) from the end of the session.`,
        },
        ...results,
      ],
    };
  } catch (error) {
    logger.error("Error during fetching screenshots", error);
    throw error;
  }
}

//Registers the fetchAutomationScreenshots tool with the MCP server
export default function addAutomationTools(server: McpServer) {
  server.tool(
    "fetchAutomationScreenshots",
    "Fetch and process screenshots from a BrowserStack Automate session",
    {
      sessionId: z
        .string()
        .describe("The BrowserStack session ID to fetch screenshots from"),
      sessionType: z
        .enum([SessionType.Automate, SessionType.AppAutomate])
        .describe("Type of BrowserStack session"),
    },
    async (args) => {
      try {
        trackMCP(
          "fetchAutomationScreenshots",
          server.server.getClientVersion()!,
        );
        return await fetchAutomationScreenshotsTool(args);
      } catch (error) {
        trackMCP(
          "fetchAutomationScreenshots",
          server.server.getClientVersion()!,
          error,
        );
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error during fetching automate screenshots: ${errorMessage}`,
            },
          ],
        };
      }
    },
  );
}
