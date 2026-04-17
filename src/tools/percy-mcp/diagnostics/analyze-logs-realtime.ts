/**
 * percy_analyze_logs_realtime — Analyze raw log data in real-time.
 *
 * Accepts a JSON array of log entries, sends them to Percy's suggestion
 * engine, and returns instant diagnostics with fix suggestions.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { formatSuggestions } from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface AnalyzeLogsRealtimeArgs {
  logs: string;
}

export async function percyAnalyzeLogsRealtime(
  args: AnalyzeLogsRealtimeArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);

  let logEntries: unknown[];
  try {
    logEntries = JSON.parse(args.logs);
    if (!Array.isArray(logEntries)) {
      return {
        content: [
          {
            type: "text",
            text: "logs must be a JSON array of log entries.",
          },
        ],
        isError: true,
      };
    }
  } catch {
    return {
      content: [
        {
          type: "text",
          text: "Invalid JSON in logs parameter. Provide a JSON array of log entries.",
        },
      ],
      isError: true,
    };
  }

  const body = {
    data: {
      logs: logEntries,
    },
  };

  try {
    const result = await client.post<unknown>("/suggestions/from_logs", body);

    if (!result || (Array.isArray(result) && result.length === 0)) {
      return {
        content: [
          {
            type: "text",
            text: "No issues detected in the provided logs.",
          },
        ],
      };
    }

    const suggestions = Array.isArray(result) ? result : [result];
    const output =
      "## Real-Time Log Analysis\n\n" + formatSuggestions(suggestions);

    return { content: [{ type: "text", text: output }] };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: `Log analysis failed: ${message}` }],
      isError: true,
    };
  }
}
