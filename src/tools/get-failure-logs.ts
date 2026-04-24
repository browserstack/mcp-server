import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../lib/instrumentation.js";
import { BrowserStackConfig } from "../lib/types.js";

import {
  retrieveNetworkFailures,
  retrieveSessionFailures,
  retrieveConsoleFailures,
} from "./failurelogs-utils/automate.js";

import {
  retrieveDeviceLogs,
  retrieveAppiumLogs,
  retrieveCrashLogs,
} from "./failurelogs-utils/app-automate.js";

import {
  AppAutomateLogType,
  AutomateLogType,
  SessionType,
} from "../lib/constants.js";

type LogType = AutomateLogType | AppAutomateLogType;
type SessionTypeValues = SessionType;

// Main log fetcher function
export async function getFailureLogs(
  args: {
    sessionId: string;
    buildId?: string;
    logTypes: LogType[];
    sessionType: SessionTypeValues;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const results: CallToolResult["content"] = [];
  const errors: string[] = [];
  let validLogTypes: LogType[] = [];

  if (!args.sessionId) {
    throw new Error("Session ID is required");
  }

  if (args.sessionType === SessionType.AppAutomate && !args.buildId) {
    throw new Error("Build ID is required for app-automate sessions");
  }

  // Validate log types and collect errors
  validLogTypes = args.logTypes.filter((logType) => {
    const isAutomate = Object.values(AutomateLogType).includes(
      logType as AutomateLogType,
    );
    const isAppAutomate = Object.values(AppAutomateLogType).includes(
      logType as AppAutomateLogType,
    );

    if (!isAutomate && !isAppAutomate) {
      errors.push(
        `Invalid log type '${logType}'. Valid log types are: ${[
          ...Object.values(AutomateLogType),
          ...Object.values(AppAutomateLogType),
        ].join(", ")}`,
      );
      return false;
    }

    if (args.sessionType === SessionType.Automate && !isAutomate) {
      errors.push(
        `Log type '${logType}' is only available for app-automate sessions.`,
      );
      return false;
    }

    if (args.sessionType === SessionType.AppAutomate && !isAppAutomate) {
      errors.push(
        `Log type '${logType}' is only available for automate sessions.`,
      );
      return false;
    }

    return true;
  });

  if (validLogTypes.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No valid log types found for ${args.sessionType} session.\nErrors encountered:\n${errors.join("\n")}`,
        },
      ],
      isError: true,
    };
  }
  let response;
  // eslint-disable-next-line no-useless-catch
  try {
    for (const logType of validLogTypes) {
      switch (logType) {
        case AutomateLogType.NetworkLogs: {
          response = await retrieveNetworkFailures(args.sessionId, config);
          results.push({ type: "text", text: response });
          break;
        }

        case AutomateLogType.SessionLogs: {
          response = await retrieveSessionFailures(args.sessionId, config);
          results.push({ type: "text", text: response });
          break;
        }

        case AutomateLogType.ConsoleLogs: {
          response = await retrieveConsoleFailures(args.sessionId, config);
          results.push({ type: "text", text: response });
          break;
        }

        case AppAutomateLogType.DeviceLogs: {
          response = await retrieveDeviceLogs(
            args.sessionId,
            args.buildId!,
            config,
          );
          results.push({ type: "text", text: response });
          break;
        }

        case AppAutomateLogType.AppiumLogs: {
          response = await retrieveAppiumLogs(
            args.sessionId,
            args.buildId!,
            config,
          );
          results.push({ type: "text", text: response });
          break;
        }

        case AppAutomateLogType.CrashLogs: {
          response = await retrieveCrashLogs(
            args.sessionId,
            args.buildId!,
            config,
          );
          results.push({ type: "text", text: response });
          break;
        }
      }
    }
  } catch (error) {
    throw error;
  }

  if (errors.length > 0) {
    results.push({
      type: "text",
      text: `Errors encountered:\n${errors.join("\n")}`,
    });
  }

  return { content: results };
}

// Register tool with the MCP server
export default function registerGetFailureLogs(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.getFailureLogs = server.tool(
    "getFailureLogs",
    "Fetch various types of logs from a BrowserStack session. Supports both automate and app-automate sessions.",
    {
      sessionType: z
        .enum([SessionType.Automate, SessionType.AppAutomate])
        .describe(
          "Type of BrowserStack session. Must be explicitly provided by the user.",
        ),
      sessionId: z
        .string()
        .describe(
          "The BrowserStack session ID. Must be explicitly provided by the user.",
        ),
      buildId: z
        .string()
        .optional()
        .describe(
          "Required only when sessionType is 'app-automate'. If sessionType is 'app-automate', always ask the user to provide the build ID before proceeding.",
        ),
      logTypes: z
        .array(
          z.enum([
            AutomateLogType.NetworkLogs,
            AutomateLogType.SessionLogs,
            AutomateLogType.ConsoleLogs,
            AppAutomateLogType.DeviceLogs,
            AppAutomateLogType.AppiumLogs,
            AppAutomateLogType.CrashLogs,
          ]),
        )
        .describe("The types of logs to fetch."),
    },
    async (args) => {
      try {
        trackMCP(
          "getFailureLogs",
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return await getFailureLogs(args, config);
      } catch (error) {
        trackMCP(
          "getFailureLogs",
          server.server.getClientVersion()!,
          error,
          config,
        );
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch failure logs: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return tools;
}
