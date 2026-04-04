/**
 * percy_get_build_summary — Get AI-generated natural language summary
 * of all visual changes in a Percy build.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetBuildSummaryArgs {
  build_id: string;
}

export async function percyGetBuildSummary(
  args: GetBuildSummaryArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "project" });

  const response = await client.get<{
    data: Record<string, unknown> | null;
  }>(`/builds/${args.build_id}`, { "include-metadata": "true" }, [
    "build-summary",
  ]);

  const build = response.data as any;

  if (!build) {
    return {
      content: [{ type: "text", text: `_Build ${args.build_id} not found._` }],
    };
  }

  // Check for build summary in relationships or top-level
  const summary =
    build.buildSummary?.content ??
    build.buildSummary?.summary ??
    build.summary ??
    null;

  if (summary && typeof summary === "string") {
    const lines: string[] = [];
    lines.push(
      `## Build Summary — Build #${build.buildNumber ?? args.build_id}`,
    );
    lines.push("");

    // The summary may be a JSON string or plain text
    let parsedSummary: string;
    try {
      const parsed = JSON.parse(summary);
      // If it parsed as an object, format its contents
      if (typeof parsed === "object" && parsed !== null) {
        parsedSummary = Object.entries(parsed)
          .map(([key, value]) => `**${key}:** ${value}`)
          .join("\n");
      } else {
        parsedSummary = String(parsed);
      }
    } catch {
      // Plain text — use as-is
      parsedSummary = summary;
    }

    lines.push(parsedSummary);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }

  // No summary — check AI details for reason
  const ai = build.aiDetails;
  if (ai) {
    const status = ai.summaryStatus ?? ai.aiSummaryStatus;

    if (status === "processing") {
      return {
        content: [
          {
            type: "text",
            text: "Build summary is being generated. Try again in a minute.",
          },
        ],
      };
    }

    if (status === "skipped") {
      const reason =
        ai.summaryReason ?? ai.summarySkipReason ?? "unknown reason";
      return {
        content: [
          {
            type: "text",
            text: `Build summary unavailable. Reason: ${reason}`,
          },
        ],
      };
    }
  }

  return {
    content: [{ type: "text", text: "No build summary available." }],
  };
}
