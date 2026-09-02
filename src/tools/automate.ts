import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fetchAutomationScreenshots } from "./automate-utils/fetch-screenshots.js";
import {
  DEFAULT_SESSION_LIST_LIMIT,
  listSessionIds,
} from "./automate-utils/list-session-ids.js";
import { SessionType } from "../lib/constants.js";
import { trackMCP } from "../lib/instrumentation.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";

// Tool function that fetches and processes screenshots from BrowserStack Automate session
export async function fetchAutomationScreenshotsTool(
  args: {
    sessionId: string;
    sessionType: SessionType;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const screenshots = await fetchAutomationScreenshots(
      args.sessionId,
      args.sessionType,
      config,
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
      data: screenshot.base64,
      mimeType: "image/png",
      _meta: { url: screenshot.url, index: index + 1 },
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
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: `Error during fetching screenshots: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

export async function listSessionIdsTool(
  args: {
    sessionType: SessionType;
    buildId: string;
    limit?: number;
    offset?: number;
    status?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const sessions = await listSessionIds(args, config);
    if (sessions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No sessions found for this hashed build ID.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(sessions, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error("Error listing session IDs", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: `Error listing session IDs: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

//Registers the fetchAutomationScreenshots tool with the MCP server
export default function addAutomationTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.fetchAutomationScreenshots = server.tool(
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
    {
      title: "Fetch Automation Screenshots",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      try {
        trackMCP(
          "fetchAutomationScreenshots",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await fetchAutomationScreenshotsTool(args, config);
      } catch (error) {
        trackMCP(
          "fetchAutomationScreenshots",
          server.server.getClientVersion()!,
          error,
          config,
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
          isError: true,
        };
      }
    },
  );

  tools.listSessions = server.tool(
    "listSessions",
    "List Automate/App Automate sessions for a hashed build ID, including " +
      "hashed session IDs and session details (name, status, OS, browser/device, " +
      "and dashboard URL). Use the dashboard hashed build id (same family as " +
      "App Automate getFailureLogs buildId). If you only have an observability " +
      "UUID from getBuildId or listBuildId, call fetchBuildInsights and use " +
      "hashed_id when present. Returned sessionId values work with getFailureLogs, " +
      "fetchAutomationScreenshots, and fetchSelfHealedSelectors.",
    {
      sessionType: z
        .enum([SessionType.Automate, SessionType.AppAutomate])
        .describe("Type of BrowserStack session"),
      buildId: z
        .string()
        .describe(
          "REST hashed Automate/App Automate build ID from the dashboard URL " +
            "or hashed_id from fetchBuildInsights (not the observability UUID " +
            "from getBuildId / listBuildId). Same ID family as App Automate " +
            "getFailureLogs buildId.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          `Max sessions to return. Defaults to ${DEFAULT_SESSION_LIST_LIMIT}.`,
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset for the REST session list."),
      status: z
        .string()
        .optional()
        .describe(
          "Optional session status filter (e.g. done, running, error). Applied client-side.",
        ),
    },
    {
      title: "List Sessions",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async (args) => {
      try {
        trackMCP(
          "listSessions",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await listSessionIdsTool(args, config);
      } catch (error) {
        trackMCP(
          "listSessions",
          server.server.getClientVersion()!,
          error,
          config,
        );
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error listing session IDs: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return tools;
}
