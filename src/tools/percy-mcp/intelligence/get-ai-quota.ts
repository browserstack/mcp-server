/**
 * percy_get_ai_quota — Check Percy AI quota status.
 *
 * Since there is no direct quota endpoint, derives AI quota info
 * from the latest build's AI details.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetAiQuota(
  _args: Record<string, never>,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "project" });

  // Fetch the latest build to extract AI details
  const response = await client.get<{
    data: Record<string, unknown>[] | null;
    meta?: Record<string, unknown>;
  }>("/builds", {
    "page[limit]": "1",
    "include-metadata": "true",
  });

  const builds = Array.isArray(response.data) ? response.data : [];

  if (builds.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "AI quota information unavailable. No builds found for this project.",
        },
      ],
    };
  }

  const build = builds[0] as any;
  const ai = build.aiDetails;

  if (!ai) {
    return {
      content: [
        {
          type: "text",
          text: "AI quota information unavailable. Ensure AI is enabled on your Percy project.",
        },
      ],
    };
  }

  const lines: string[] = [];
  lines.push("## Percy AI Quota Status");
  lines.push("");

  // Quota / regeneration info
  const used = ai.regenerationsUsed ?? ai.quotaUsed;
  const total = ai.regenerationsTotal ?? ai.quotaTotal ?? ai.dailyQuota;
  const plan = ai.planType ?? ai.plan ?? ai.tier;

  if (used != null && total != null) {
    lines.push(
      `**Daily Regenerations:** ${used} / ${total} used`,
    );
  } else if (total != null) {
    lines.push(`**Daily Regeneration Limit:** ${total}`);
  } else {
    lines.push(
      "**Daily Regenerations:** Quota details not available in build metadata.",
    );
  }

  if (plan) {
    lines.push(`**Plan:** ${plan}`);
  }

  // Additional AI stats from the latest build
  if (ai.comparisonsAnalyzed != null) {
    lines.push("");
    lines.push("### Latest Build AI Stats");
    lines.push(`- Build #${build.buildNumber ?? build.id}`);
    lines.push(`- Comparisons analyzed: ${ai.comparisonsAnalyzed}`);
    if (ai.potentialBugs != null) {
      lines.push(`- Potential bugs detected: ${ai.potentialBugs}`);
    }
    if (ai.aiJobsCompleted != null) {
      lines.push(
        `- AI jobs completed: ${ai.aiJobsCompleted ? "yes" : "no"}`,
      );
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
