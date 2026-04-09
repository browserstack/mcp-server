import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetAiSummary(
  args: { build_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Get build with build-summary include
  const response = await percyGet(`/builds/${args.build_id}`, config, {
    include: "build-summary",
  });

  const build = response?.data || {};
  const attrs = build.attributes || {};
  const buildNum = attrs["build-number"] || args.build_id;
  const state = attrs.state || "unknown";

  // Get AI details from build attributes
  const ai = attrs["ai-details"] || {};
  const potentialBugs = ai["total-potential-bugs"] ?? 0;
  const aiVisualDiffs = ai["total-ai-visual-diffs"] ?? 0;
  const diffsReduced = ai["total-diffs-reduced-capped"] ?? 0;
  const comparisonsWithAi = ai["total-comparisons-with-ai"] ?? 0;
  const allCompleted = ai["all-ai-jobs-completed"] ?? false;
  const summaryStatus = ai["summary-status"];

  // Get build summary from included data
  const included = response?.included || [];
  const summaryObj = included.find((i: any) => i.type === "build-summaries");
  const summaryJson = summaryObj?.attributes?.summary;

  let output = `## Percy Build #${buildNum} — AI Build Summary\n\n`;

  // Check for actual AI data, not just the toggle flag
  const hasAiData =
    (comparisonsWithAi ?? 0) > 0 ||
    (potentialBugs ?? 0) > 0 ||
    (aiVisualDiffs ?? 0) > 0 ||
    summaryStatus === "ok";

  if (!hasAiData) {
    output += `No AI analysis data found for this build.\n`;
    output += `AI may not be enabled, or the build has no visual diffs.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  if (state !== "finished") {
    output += `Build is **${state}**. AI summary is available after the build finishes.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // AI stats header
  output += `**${potentialBugs} potential bug${potentialBugs !== 1 ? "s" : ""}** · **${aiVisualDiffs} AI visual diff${aiVisualDiffs !== 1 ? "s" : ""}**\n\n`;

  if (diffsReduced > 0) {
    output += `AI reduced noise by **${diffsReduced}** diff${diffsReduced !== 1 ? "s" : ""}.\n`;
  }
  if (comparisonsWithAi > 0) {
    output += `**${comparisonsWithAi}** comparison${comparisonsWithAi !== 1 ? "s" : ""} analyzed by AI.\n`;
  }
  output += `AI jobs: ${allCompleted ? "completed" : "in progress"}\n\n`;

  // Parse and display the build summary
  if (summaryJson) {
    try {
      const summary =
        typeof summaryJson === "string" ? JSON.parse(summaryJson) : summaryJson;

      if (summary.title) {
        output += `### Summary\n\n`;
        output += `> ${summary.title}\n\n`;
      }

      // Display items (change descriptions with occurrences)
      const items = summary.items || summary.changes || [];
      if (items.length > 0) {
        output += `### Changes\n\n`;
        items.forEach((item: any) => {
          const title =
            item.title || item.description || item.name || String(item);
          const occurrences =
            item.occurrences || item.count || item.occurrence_count;
          output += `- **${title}**`;
          if (occurrences)
            output += ` (${occurrences} occurrence${occurrences !== 1 ? "s" : ""})`;
          output += "\n";
        });
        output += "\n";
      }

      // Display snapshots if available
      const snapshots = summary.snapshots || [];
      if (snapshots.length > 0) {
        output += `### Affected Snapshots\n\n`;
        snapshots.forEach((snap: any) => {
          const name = snap.name || snap.snapshot_name || "Unknown";
          const changes = snap.changes || snap.items || [];
          output += `**${name}**\n`;
          changes.forEach((change: any) => {
            output += `  - ${change.title || change.description || change}\n`;
          });
        });
        output += "\n";
      }
    } catch {
      // Summary is not valid JSON — show raw
      output += `### Raw Summary\n\n`;
      output += `${String(summaryJson).slice(0, 1000)}\n\n`;
    }
  } else if (summaryStatus === "processing") {
    output += `### Summary\n\nAI summary is being generated. Try again in a minute.\n`;
  } else if (summaryStatus === "skipped") {
    const reason = ai["summary-reason"] || "unknown";
    output += `### Summary\n\nAI summary was skipped: ${reason}\n`;
    if (reason === "too_many_comparisons") {
      output += `(Build has more than 50 comparisons — summaries are only generated for smaller builds)\n`;
    }
  } else {
    output += `### Summary\n\nNo AI summary available for this build.\n`;
  }

  // Build URL
  const webUrl = attrs["web-url"];
  if (webUrl) {
    output += `**View in Percy:** ${webUrl}\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
