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
  isTraBuildId,
  NoSessionsError,
  otherSessionType,
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
            text: "No screenshots found in the session logs. Run with browserstack.debug: true to capture visual-log screenshots.",
          },
        ],
        isError: true,
      };
    }

    const results = screenshots.map((screenshot, index) => ({
      type: "image" as const,
      data: screenshot.base64,
      mimeType: screenshot.mimeType,
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
    const inputId = args.buildId.trim();
    const notes: string[] = [];
    let sessionType = args.sessionType;
    let buildId = inputId;
    let sessions: Awaited<ReturnType<typeof listSessionIds>> | undefined;

    const switched = (actual: SessionType) => {
      if (actual !== args.sessionType) {
        notes.push(
          `This build ran on ${actual}, not ${args.sessionType}; use sessionType "${actual}" for its sessions.`,
        );
      }
      sessionType = actual;
    };

    const fromTraBuild = async () => {
      const resolved = await resolveHashedBuildId(
        inputId,
        config,
        args.sessionType,
      );
      buildId = resolved.hashedBuildId;
      switched(resolved.sessionType);
      notes.push(
        `Resolved TRA build ${inputId} to hashed build id ${buildId}.`,
      );
      return listSessionIds({ ...args, sessionType, buildId }, config);
    };

    if (isTraBuildId(inputId)) {
      sessions = await fromTraBuild();
    } else {
      for (const candidate of [
        args.sessionType,
        otherSessionType(args.sessionType),
      ]) {
        try {
          sessions = await listSessionIds(
            { ...args, sessionType: candidate, buildId },
            config,
          );
          switched(candidate);
          break;
        } catch (error) {
          if (!(error instanceof UnknownBuildError)) throw error;
        }
      }
      if (!sessions) {
        // An all-hex id can still be an older TRA build id.
        try {
          sessions = await fromTraBuild();
        } catch (resolveError) {
          if (resolveError instanceof NoSessionsError) throw resolveError;
          logger.debug(
            "listSessions: id is not a TRA build either",
            resolveError,
          );
          throw new UnknownBuildError(
            `No Automate, App Automate or TRA build has id "${inputId}". Pass the id from ` +
              "the dashboard build link, or the TRA build id from listBuildId.",
          );
        }
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
    for (const note of notes) {
      content.push({ type: "text", text: note });
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
    "Fetch screenshots captured during an Automate/App Automate session.",
    {
      sessionId: z
        .string()
        .describe("Session id from listSessions or listTestIds."),
      sessionType: z
        .enum([SessionType.Automate, SessionType.AppAutomate])
        .describe("Product the session ran on."),
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
    "List a build's sessions: session IDs, status, OS, browser/device, dashboard URL. Takes an Automate or a TRA build id.",
    {
      sessionType: z
        .enum([SessionType.Automate, SessionType.AppAutomate])
        .describe("Product the build ran on; the other is also tried."),
      buildId: z
        .string()
        .describe("Automate hashed build id, or TRA id from listBuildId."),
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
