import { PercyClient } from "../../../lib/percy-api/client.js";
import {
  formatBuild,
  formatSuggestions,
  formatNetworkLogs,
} from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyDebugFailedBuild(
  args: { build_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);
  const errors: string[] = [];

  // Step 1: Get build details
  let build: any;
  try {
    build = await client.get(`/builds/${args.build_id}`, {
      "include-metadata": "true",
    });
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Failed to fetch build: ${e.message}` }],
      isError: true,
    };
  }

  const state = build?.state || "unknown";

  // Adapt to build state
  if (state === "processing" || state === "pending" || state === "waiting") {
    return {
      content: [
        {
          type: "text",
          text: `Build #${args.build_id} is **${state.toUpperCase()}**. Debug diagnostics are available after the build completes or fails.`,
        },
      ],
    };
  }

  let output = `## Build Debug Report — #${args.build_id}\n\n`;
  output += formatBuild(build) + "\n";

  // Step 2: Get suggestions
  if (state === "failed" || state === "finished") {
    try {
      const suggestions = await client.get<any>("/suggestions", {
        build_id: args.build_id,
      });
      if (
        suggestions &&
        (Array.isArray(suggestions) ? suggestions.length > 0 : true)
      ) {
        const suggestionList = Array.isArray(suggestions)
          ? suggestions
          : [suggestions];
        output += formatSuggestions(suggestionList) + "\n";
      }
    } catch (e: any) {
      errors.push(`Suggestions unavailable: ${e.message}`);
    }
  }

  // Step 3: Get failed snapshots
  if (state === "failed" || state === "finished") {
    try {
      const failedItems = await client.get<any>("/build-items", {
        "filter[build-id]": args.build_id,
        "filter[category]": "failed",
        "page[limit]": "10",
      });
      const failedList = Array.isArray(failedItems) ? failedItems : [];
      if (failedList.length > 0) {
        output += `### Failed Snapshots (${failedList.length})\n\n`;
        failedList.forEach((item: any, i: number) => {
          output += `${i + 1}. **${item.name || "Unknown"}**\n`;
        });
        output += "\n";

        // Step 4: Network logs for top 3
        const top3 = failedList.slice(0, 3);
        for (const item of top3) {
          const compId = item.comparisonId || item.comparisons?.[0]?.id;
          if (compId) {
            try {
              const logs = await client.get<any>("/network-logs", {
                comparison_id: compId,
              });
              if (logs) {
                const logList = Array.isArray(logs)
                  ? logs
                  : Object.values(logs);
                const failedLogs = logList.filter((l: any) => {
                  const headStatus = l.headStatus || l["head-status"];
                  return (
                    headStatus && headStatus !== "200" && headStatus !== "NA"
                  );
                });
                if (failedLogs.length > 0) {
                  output += `#### Network Issues — ${item.name || "Unknown"}\n\n`;
                  output += formatNetworkLogs(failedLogs) + "\n";
                }
              }
            } catch {
              // Network logs not available for this comparison
            }
          }
        }
      }
    } catch (e: any) {
      errors.push(`Failed snapshots unavailable: ${e.message}`);
    }
  }

  // Fix commands
  if (state === "failed" && build.failureReason) {
    output += `### Suggested Fix Commands\n\n`;
    if (build.failureReason === "missing_resources") {
      output +=
        '```\npercy config set networkIdleIgnore "<failing-hostname>"\npercy config set allowedHostnames "<required-hostname>"\n```\n';
    } else if (build.failureReason === "render_timeout") {
      output += "```\npercy config set networkIdleTimeout 60000\n```\n";
    } else if (build.failureReason === "missing_finalize") {
      output +=
        "Ensure `percy exec` or `percy build:finalize` is called after all snapshots.\n";
    }
  }

  if (errors.length > 0) {
    output += `\n### Partial Results\n`;
    errors.forEach((err) => {
      output += `- ${err}\n`;
    });
  }

  return { content: [{ type: "text", text: output }] };
}
