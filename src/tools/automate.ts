import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fetchAutomationScreenshots } from "./automate-utils/fetch-screenshots.js";
import {
  DEFAULT_SESSION_LIST_LIMIT,
  listSessionIds,
  UnknownBuildError,
} from "./automate-utils/list-session-ids.js";
import {
  isObservabilityBuildUuid,
  resolveHashedBuildId,
} from "./automate-utils/resolve-hashed-build-id.js";
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
    // Accept the observability build id too. Observability ids are usually
    // UUIDs but can also be 40-char hex like Automate hashed ids, so shape
    // alone is not enough: try the REST list first and resolve on a miss.
    const inputId = args.buildId.trim();
    let buildId = inputId;
    let resolvedNote: string | undefined;

    const resolve = async () => {
      const resolved = await resolveHashedBuildId(
        inputId,
        config,
        args.sessionType,
      );
      buildId = resolved.hashedBuildId;
      resolvedNote = `Resolved observability build ${inputId} to hashed build id ${buildId}.`;
    };

    let sessions;
    if (isObservabilityBuildUuid(inputId)) {
      await resolve();
      sessions = await listSessionIds({ ...args, buildId }, config);
    } else {
      try {
        sessions = await listSessionIds({ ...args, buildId }, config);
      } catch (error) {
        if (!(error instanceof UnknownBuildError)) throw error;
        try {
          await resolve();
        } catch (resolveError) {
          logger.debug(
            "listSessions: id is neither a known hashed build nor a resolvable observability build",
            resolveError,
          );
          throw error;
        }
        sessions = await listSessionIds({ ...args, buildId }, config);
      }
    }

    const content: CallToolResult["content"] = [
      {
        type: "text",
        text:
          sessions.length === 0
            ? "No sessions found for this hashed build ID."
            : JSON.stringify(sessions, null, 2),
      },
    ];
    if (resolvedNote) {
      content.push({ type: "text", text: resolvedNote });
    }

    return { content };
  } catch (error) {
    logger.error("Error listing session IDs", error);
    throw error;
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
    "List sessions for a hashed Automate/App Automate build: session IDs, status, OS, browser/device, dashboard URL.",
    {
      sessionType: z
        .enum([SessionType.Automate, SessionType.AppAutomate])
        .describe("Type of BrowserStack session"),
      buildId: z
        .string()
        .describe(
          "Hashed build id from the dashboard, or the observability build id from getBuildId.",
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
