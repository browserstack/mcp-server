import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../lib/instrumentation.js";
import { BrowserStackConfig } from "../lib/types.js";
import { NEEDS_SESSION_ID } from "./tool-handoff.js";

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

import { resolveAppAutomateBuildId } from "./failurelogs-utils/resolve-app-build-id.js";
import {
  detectSession,
  isTraBuildId,
} from "./automate-utils/resolve-hashed-build-id.js";
import { retrieveSessionVideo } from "./failurelogs-utils/video.js";

import {
  AppAutomateLogType,
  AutomateLogType,
  SessionType,
  SessionVideoLogType,
} from "../lib/constants.js";

type LogType = AutomateLogType | AppAutomateLogType;
type SessionTypeValues = SessionType;

function fitsSessionType(logType: LogType, sessionType: SessionType): boolean {
  const types: readonly string[] =
    sessionType === SessionType.Automate
      ? Object.values(AutomateLogType)
      : Object.values(AppAutomateLogType);
  return types.includes(logType);
}

const EQUIVALENT_LOG_TYPE: Partial<Record<LogType, LogType>> = {
  [AutomateLogType.SessionLogs]: AppAutomateLogType.AppiumLogs,
  [AutomateLogType.ConsoleLogs]: AppAutomateLogType.DeviceLogs,
  [AutomateLogType.NetworkLogs]: AppAutomateLogType.DeviceLogs,
  [AppAutomateLogType.AppiumLogs]: AutomateLogType.SessionLogs,
  [AppAutomateLogType.DeviceLogs]: AutomateLogType.ConsoleLogs,
  [AppAutomateLogType.CrashLogs]: AutomateLogType.SessionLogs,
};

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
  const notes: string[] = [];

  if (!args.sessionId) {
    throw new Error("Session ID is required");
  }

  const allTypes = [
    ...new Set([
      ...Object.values(AutomateLogType),
      ...Object.values(AppAutomateLogType),
    ]),
  ] as LogType[];
  const requested = args.logTypes.filter((logType) => {
    if (allTypes.includes(logType)) return true;
    errors.push(
      `Invalid log type '${logType}'. Valid log types are: ${allTypes.join(", ")}`,
    );
    return false;
  });

  let sessionType = args.sessionType;
  let buildId =
    args.buildId && !isTraBuildId(args.buildId) ? args.buildId : undefined;

  const switchTo = (actual: SessionType) => {
    if (actual === sessionType) return;
    notes.push(
      `Session ${args.sessionId} ran on ${actual}, not ${sessionType}.`,
    );
    sessionType = actual;
  };
  const notFound = () =>
    new Error(
      `Session "${args.sessionId}" was not found on Automate or App Automate. ` +
        "Use a session id from listSessions or listTestIds.",
    );

  if (requested.some((logType) => !fitsSessionType(logType, sessionType))) {
    const detected = await detectSession(args.sessionId, sessionType, config);
    if (!detected) throw notFound();
    switchTo(detected.sessionType);
    if (sessionType === SessionType.AppAutomate) {
      buildId = buildId ?? detected.hashedBuildId;
    }
  }

  const needsBuildId = requested.some(
    (logType) => logType !== SessionVideoLogType,
  );
  if (sessionType === SessionType.AppAutomate && needsBuildId && !buildId) {
    buildId = await resolveAppAutomateBuildId(args.sessionId, config);
    if (!buildId) {
      const detected = await detectSession(
        args.sessionId,
        SessionType.Automate,
        config,
      );
      if (!detected) throw notFound();
      switchTo(detected.sessionType);
      if (sessionType === SessionType.AppAutomate) {
        buildId = detected.hashedBuildId;
      }
    }
  }

  const validLogTypes: LogType[] = [];
  for (const logType of requested) {
    const fitted = fitsSessionType(logType, sessionType)
      ? logType
      : EQUIVALENT_LOG_TYPE[logType];
    if (fitted !== logType) {
      notes.push(
        `'${logType}' is not available for ${sessionType} sessions; fetched '${fitted}' instead.`,
      );
    }
    if (fitted && !validLogTypes.includes(fitted)) validLogTypes.push(fitted);
  }

  if (validLogTypes.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No valid log types found for ${sessionType} session.\nErrors encountered:\n${errors.join("\n")}`,
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
        case SessionVideoLogType: {
          response = await retrieveSessionVideo(
            args.sessionId,
            sessionType,
            config,
          );
          results.push({ type: "text", text: response });
          break;
        }

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
          response = await retrieveDeviceLogs(args.sessionId, buildId!, config);
          results.push({ type: "text", text: response });
          break;
        }

        case AppAutomateLogType.AppiumLogs: {
          response = await retrieveAppiumLogs(args.sessionId, buildId!, config);
          results.push({ type: "text", text: response });
          break;
        }

        case AppAutomateLogType.CrashLogs: {
          response = await retrieveCrashLogs(args.sessionId, buildId!, config);
          results.push({ type: "text", text: response });
          break;
        }
      }
    }
  } catch (error) {
    throw error;
  }

  if (notes.length > 0) {
    results.push({ type: "text", text: notes.join("\n") });
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
    "Fetch logs or the video URL for an Automate/App Automate session." +
      NEEDS_SESSION_ID,
    {
      sessionType: z
        .enum([SessionType.Automate, SessionType.AppAutomate])
        .describe("Product the session ran on; corrected if wrong."),
      sessionId: z
        .string()
        .describe("Session id from listSessions or listTestIds."),
      buildId: z
        .string()
        .optional()
        .describe(
          "App Automate build ID. Optional — resolved from the session if omitted.",
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
            SessionVideoLogType,
          ]),
        )
        .describe("The types of logs to fetch."),
    },
    {
      title: "Get Failure Logs",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
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
