import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../lib/instrumentation.js";
import { handleMCPError } from "../lib/utils.js";
import { BrowserStackConfig } from "../lib/types.js";
import {
  GET_BUILD_FAILURE_THEMES_PARAMS,
  GET_TFA_TURN_RESULT_PARAMS,
  LIST_TESTS_IN_FAILURE_THEME_PARAMS,
  TFA_RCA_TURN_PARAMS,
  TRIGGER_RCA_REPORT_PARAMS,
} from "./tfa-rca-utils/constants.js";
import {
  submitTfaRcaTurn,
  TfaRcaTurnArgs,
} from "./tfa-rca-utils/submit-turn.js";
import {
  getTfaTurnResult,
  GetTfaTurnResultArgs,
  TfaRcaTurnError,
} from "./tfa-rca-utils/turn-result.js";
import {
  triggerRcaReport,
  TriggerRcaReportArgs,
  TriggerRcaReportError,
} from "./tfa-rca-utils/trigger-report.js";
import {
  BuildFailureThemesError,
  fetchBuildFailureThemes,
  fetchTestsInFailureTheme,
  ListTestsInFailureThemeArgs,
} from "./tfa-rca-utils/build-failure-themes.js";

const TOOL_NAME = "tfaRcaTurn";
const GET_RESULT_TOOL_NAME = "getTfaTurnResult";
const TRIGGER_TOOL_NAME = "triggerRcaReport";
const GET_BUILD_FAILURE_THEMES_TOOL_NAME = "getBuildFailureThemes";
const LIST_TESTS_IN_FAILURE_THEME_TOOL_NAME = "listTestsInFailureTheme";

/** Wrap a domain error into the standard `{ isError: true }` envelope. */
function domainErrorResult(toolName: string, error: Error): CallToolResult {
  const readable = toolName.replace(/([A-Z])/g, " $1").toLowerCase();
  return {
    content: [
      {
        type: "text",
        text: `Failed to ${readable}: ${error.message}`,
      },
    ],
    isError: true,
  };
}

export async function tfaRcaTurnTool(
  args: TfaRcaTurnArgs,
  config: BrowserStackConfig,
  context?: any,
): Promise<CallToolResult> {
  // The util returns the trimmed, status-discriminated contract; JSON.stringify
  // drops the undefined slots, so the wrapper stays a plain serializer.
  const result = await submitTfaRcaTurn(args, config, context);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export async function getTfaTurnResultTool(
  args: GetTfaTurnResultArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Same trimmed contract as `tfaRcaTurn`, read once without submitting.
  const result = await getTfaTurnResult(args, config);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export async function triggerRcaReportTool(
  args: TriggerRcaReportArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const glimpse = await triggerRcaReport(args, config);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(glimpse, null, 2),
      },
    ],
  };
}

export async function getBuildFailureThemesTool(
  args: { buildUuid: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const result = await fetchBuildFailureThemes(args.buildUuid, config);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export async function listTestsInFailureThemeTool(
  args: ListTestsInFailureThemeArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const result = await fetchTestsInFailureTheme(args, config);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export default function addTfaRcaCollaborationTools(
  server: McpServer,
  config: BrowserStackConfig,
): Record<string, any> {
  const tools: Record<string, any> = {};

  tools.tfaRcaTurn = server.tool(
    TOOL_NAME,
    "Submit one collaborative RCA turn for a test run to the TFA agent; returns status, asks, and RCA.",
    TFA_RCA_TURN_PARAMS,
    async (args, context) => {
      try {
        const result = await tfaRcaTurnTool(args, config, context);
        trackMCP(
          TOOL_NAME,
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return result;
      } catch (error) {
        // Domain failures carry a client-safe, group-scope-safe message.
        if (error instanceof TfaRcaTurnError) {
          trackMCP(TOOL_NAME, server.server.getClientVersion()!, error, config);
          return domainErrorResult(TOOL_NAME, error);
        }
        return handleMCPError(TOOL_NAME, server, config, error);
      }
    },
  );

  tools.getTfaTurnResult = server.tool(
    GET_RESULT_TOOL_NAME,
    "Read a submitted RCA turn's result once by turnId; PENDING if the agent is still working.",
    GET_TFA_TURN_RESULT_PARAMS,
    async (args) => {
      try {
        const result = await getTfaTurnResultTool(args, config);
        trackMCP(
          GET_RESULT_TOOL_NAME,
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return result;
      } catch (error) {
        // Domain failures carry a client-safe, group-scope-safe message.
        if (error instanceof TfaRcaTurnError) {
          trackMCP(
            GET_RESULT_TOOL_NAME,
            server.server.getClientVersion()!,
            error,
            config,
          );
          return domainErrorResult(GET_RESULT_TOOL_NAME, error);
        }
        return handleMCPError(GET_RESULT_TOOL_NAME, server, config, error);
      }
    },
  );

  tools.triggerRcaReport = server.tool(
    TRIGGER_TOOL_NAME,
    "Trigger or read a build's Release Readiness report; returns a verdict glimpse and a UI link.",
    TRIGGER_RCA_REPORT_PARAMS,
    async (args) => {
      try {
        const result = await triggerRcaReportTool(args, config);
        trackMCP(
          TRIGGER_TOOL_NAME,
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return result;
      } catch (error) {
        // Domain failures carry a client-safe, group-scope-safe message.
        if (error instanceof TriggerRcaReportError) {
          trackMCP(
            TRIGGER_TOOL_NAME,
            server.server.getClientVersion()!,
            error,
            config,
          );
          return domainErrorResult(TRIGGER_TOOL_NAME, error);
        }
        return handleMCPError(TRIGGER_TOOL_NAME, server, config, error);
      }
    },
  );

  tools.getBuildFailureThemes = server.tool(
    GET_BUILD_FAILURE_THEMES_TOOL_NAME,
    "Get a build's server-computed failure-theme clusters; triggers computation if never run, polls to done; ready:false if still not done or trigger unavailable — caller falls back to client-side clustering.",
    GET_BUILD_FAILURE_THEMES_PARAMS,
    async (args) => {
      try {
        const result = await getBuildFailureThemesTool(args, config);
        trackMCP(
          GET_BUILD_FAILURE_THEMES_TOOL_NAME,
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return result;
      } catch (error) {
        // Domain failures carry a client-safe, group-scope-safe message.
        if (error instanceof BuildFailureThemesError) {
          trackMCP(
            GET_BUILD_FAILURE_THEMES_TOOL_NAME,
            server.server.getClientVersion()!,
            error,
            config,
          );
          return domainErrorResult(GET_BUILD_FAILURE_THEMES_TOOL_NAME, error);
        }
        return handleMCPError(
          GET_BUILD_FAILURE_THEMES_TOOL_NAME,
          server,
          config,
          error,
        );
      }
    },
  );

  tools.listTestsInFailureTheme = server.tool(
    LIST_TESTS_IN_FAILURE_THEME_TOOL_NAME,
    "List test runs belonging to a build failure theme/workflow (paginated via cursor); the representative/sibling grouping source.",
    LIST_TESTS_IN_FAILURE_THEME_PARAMS,
    async (args) => {
      try {
        const result = await listTestsInFailureThemeTool(args, config);
        trackMCP(
          LIST_TESTS_IN_FAILURE_THEME_TOOL_NAME,
          server.server.getClientVersion()!,
          undefined,
          config,
        );
        return result;
      } catch (error) {
        // Domain failures carry a client-safe, group-scope-safe message.
        if (error instanceof BuildFailureThemesError) {
          trackMCP(
            LIST_TESTS_IN_FAILURE_THEME_TOOL_NAME,
            server.server.getClientVersion()!,
            error,
            config,
          );
          return domainErrorResult(
            LIST_TESTS_IN_FAILURE_THEME_TOOL_NAME,
            error,
          );
        }
        return handleMCPError(
          LIST_TESTS_IN_FAILURE_THEME_TOOL_NAME,
          server,
          config,
          error,
        );
      }
    },
  );

  return tools;
}
