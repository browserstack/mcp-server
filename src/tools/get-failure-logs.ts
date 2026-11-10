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
  LogsNotFoundError,
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
  findFrameworkBuild,
  FrameworkBuild,
} from "./appautomate-utils/framework-builds.js";
import { retrieveFrameworkLogs } from "./failurelogs-utils/framework.js";

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

// Only true equivalents: other log types are a different kind of evidence.
const EQUIVALENT_LOG_TYPE: Partial<Record<LogType, LogType>> = {
  [AutomateLogType.SessionLogs]: AppAutomateLogType.AppiumLogs,
  [AppAutomateLogType.AppiumLogs]: AutomateLogType.SessionLogs,
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
    if (!fitted) {
      errors.push(`'${logType}' is not available for ${sessionType} sessions.`);
    } else if (fitted !== logType) {
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

  // Framework builds (Maestro, Espresso, XCUITest, Flutter) 404 on the generic App
  // Automate log endpoints. Checked once, and only after a generic 404, so Appium
  // sessions with logs make no extra calls.
  let framework: FrameworkBuild | null | undefined;
  const appLogs = async (
    logType: AppAutomateLogType,
    generic: () => Promise<string>,
  ): Promise<string> => {
    try {
      return await generic();
    } catch (error) {
      if (!(error instanceof LogsNotFoundError)) throw error;
      if (framework === undefined) {
        framework = buildId
          ? ((await findFrameworkBuild(buildId, config)) ?? null)
          : null;
      }
      // Not a framework build either: the same "not available" text as before.
      if (!framework) return error.message;
      return retrieveFrameworkLogs(framework, args.sessionId, logType, config);
    }
  };

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
          response = await appLogs(logType, () =>
            retrieveDeviceLogs(args.sessionId, buildId!, config, {
              throwOnNotFound: true,
            }),
          );
          results.push({ type: "text", text: response });
          break;
        }

        case AppAutomateLogType.AppiumLogs: {
          response = await appLogs(logType, () =>
            retrieveAppiumLogs(args.sessionId, buildId!, config, {
              throwOnNotFound: true,
            }),
          );
          results.push({ type: "text", text: response });
          break;
        }

        case AppAutomateLogType.CrashLogs: {
          response = await appLogs(logType, () =>
            retrieveCrashLogs(args.sessionId, buildId!, config, {
              throwOnNotFound: true,
            }),
          );
          results.push({ type: "text", text: response });
          break;
        }
      }
    }
  } catch (error) {
    throw error;
  }

  if (framework) {
    notes.push(
      `This session ran through the ${framework.framework.name} framework API, so its logs come from each test's results.`,
    );
  }
  if (notes.length > 0) {
    results.unshift({ type: "text", text: notes.join("\n") });
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
