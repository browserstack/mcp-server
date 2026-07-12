import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../lib/instrumentation.js";
import { handleMCPError } from "../lib/utils.js";
import { BrowserStackConfig } from "../lib/types.js";
import {
  TFA_RCA_TURN_PARAMS,
  TRIGGER_RCA_REPORT_PARAMS,
} from "./tfa-rca-utils/constants.js";
import {
  submitTfaRcaTurn,
  TfaRcaTurnArgs,
  TfaRcaTurnError,
} from "./tfa-rca-utils/submit-turn.js";
import {
  triggerRcaReport,
  TriggerRcaReportArgs,
  TriggerRcaReportError,
} from "./tfa-rca-utils/trigger-report.js";

const TOOL_NAME = "tfaRcaTurn";
const TRIGGER_TOOL_NAME = "triggerRcaReport";

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

  return tools;
}
