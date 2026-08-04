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
    "Submit one collaborative RCA turn for a test run to the TFA agent, then poll in-call for a result. Omit threadId on the first turn for a test run — this starts a new investigation thread; every following turn on that same test MUST pass back the threadId from the previous response, since a test run should have only one active thread at a time. Returns status RESOLVED (terminal, includes root_cause/related_prs), NEEDS_INFO (fulfill the asks and submit the next turn with the same threadId), or PENDING (still working — poll it with getTfaTurnResult using the returned turnId; do NOT call tfaRcaTurn again for the same turn, that submits a duplicate).",
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
    "Read a previously submitted RCA turn's status once, given the testRunId and the turnId a PENDING tfaRcaTurn response returned — this never resubmits or duplicates the turn. Returns PENDING again if the TFA agent is still working, or the same RESOLVED/NEEDS_INFO contract as tfaRcaTurn once it finishes. On NEEDS_INFO, gather the requested evidence and continue via tfaRcaTurn with the same threadId; RESOLVED is terminal for this test — do not call this tool or tfaRcaTurn again for it.",
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
    "Trigger (or read, if one already exists) a build's Release Readiness report, returning a trimmed verdict glimpse and a Test Observability UI link — never the raw report body. Without force, a completed report is read as-is at no extra analysis cost, so it's safe to call this repeatedly just to check status. Pass force:true only to force a fresh re-analysis of an already-completed report (e.g. after new evidence changed the picture) — do NOT set force on every call, since that discards the cached report and always pays the full re-analysis cost.",
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
    "Get a build's server-computed failure-theme clusters (buildThemes + buildWorkflows), the preferred grouping source for representative/sibling fan-out — call this once per build, not per test. Triggers server-side computation if nothing has ever run for this build, and polls in-call up to its own budget for the result to finish; never blocks indefinitely. ready:false means either the computation is still running past the poll budget or the trigger itself failed (status:'trigger-unavailable') — either way, fall back to client-side clustering rather than waiting longer or retrying this call.",
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
    "List the test runs belonging to one failure theme or workflow from a prior getBuildFailureThemes call, filtered by themeId or workflowId. Results are paginated — pass the previous response's nextCursor back as cursor and keep calling until no nextCursor is returned; do not assume a single page covers all members. This is the representative/sibling grouping source: every test in a theme's list becomes either the cluster's representative or a pre-seeded sibling confirm.",
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
