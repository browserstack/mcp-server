/**
 * percy_get_ai_analysis — Get AI-powered visual diff analysis.
 *
 * Two modes:
 *   1. Single comparison (comparison_id) — regions, diff ratios, bug flags
 *   2. Build aggregate (build_id) — overall AI metrics and job status
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetAiAnalysisArgs {
  comparison_id?: string;
  build_id?: string;
}

function pct(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function na(value: unknown): string {
  if (value == null || value === "") return "N/A";
  return String(value);
}

// ---------------------------------------------------------------------------
// Single-comparison AI analysis
// ---------------------------------------------------------------------------

async function analyzeComparison(
  comparisonId: string,
  client: PercyClient,
): Promise<CallToolResult> {
  const includes = [
    "head-screenshot.image",
    "base-screenshot.image",
    "diff-image",
    "ai-diff-image",
    "browser.browser-family",
    "comparison-tag",
  ];

  const response = await client.get<{
    data: Record<string, unknown> | null;
  }>(`/comparisons/${comparisonId}`, undefined, includes);

  const comparison = response.data as any;

  if (!comparison) {
    return {
      content: [
        {
          type: "text",
          text: `_Comparison ${comparisonId} not found._`,
        },
      ],
    };
  }

  const lines: string[] = [];
  lines.push(`## AI Analysis — Comparison #${comparisonId}`);
  lines.push("");

  // Diff ratios
  const aiDiff = comparison.aiDiffRatio;
  const rawDiff = comparison.diffRatio;
  if (aiDiff != null || rawDiff != null) {
    lines.push(`**AI Diff Ratio:** ${pct(aiDiff)} (raw: ${pct(rawDiff)})`);
  }

  // AI processing state
  if (
    comparison.aiProcessingState &&
    comparison.aiProcessingState !== "completed"
  ) {
    lines.push(
      `> ⚠ AI processing state: ${comparison.aiProcessingState}. Results may be incomplete.`,
    );
    lines.push("");
  }

  // Bug count from regions
  const regions: any[] = comparison.appliedRegions ?? [];
  const bugCount = regions.filter(
    (r: any) =>
      r.isBug === true || r.classification === "bug" || r.type === "bug",
  ).length;

  if (bugCount > 0) {
    lines.push(`**Potential Bugs:** ${bugCount}`);
  }

  // Regions
  if (regions.length > 0) {
    lines.push("");
    lines.push(`### Regions (${regions.length}):`);

    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      const label = na(region.label ?? region.name);
      const type = region.type ?? region.changeType ?? "unknown";
      const desc = region.description ?? "";
      const ignored = region.ignored === true || region.state === "ignored";

      let line: string;
      if (ignored) {
        line = `${i + 1}. ~~${label}~~ (ignored by AI)`;
      } else {
        line = `${i + 1}. **${label}** (${type})`;
      }
      if (desc) line += `\n   ${desc}`;
      lines.push(line);
    }
  } else {
    lines.push("");
    lines.push("_No AI regions detected for this comparison._");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

// ---------------------------------------------------------------------------
// Build-aggregate AI analysis
// ---------------------------------------------------------------------------

async function analyzeBuild(
  buildId: string,
  client: PercyClient,
): Promise<CallToolResult> {
  const response = await client.get<{
    data: Record<string, unknown> | null;
  }>(`/builds/${buildId}`, { "include-metadata": "true" });

  const build = response.data as any;

  if (!build) {
    return {
      content: [{ type: "text", text: `_Build ${buildId} not found._` }],
    };
  }

  const ai = build.aiDetails;
  if (!ai) {
    return {
      content: [
        {
          type: "text",
          text: "AI analysis is not enabled for this project.",
        },
      ],
    };
  }

  const lines: string[] = [];
  lines.push(`## AI Analysis — Build #${build.buildNumber ?? buildId}`);
  lines.push("");

  if (ai.comparisonsAnalyzed != null) {
    lines.push(`- Comparisons analyzed: ${ai.comparisonsAnalyzed}`);
  }
  if (ai.potentialBugs != null) {
    lines.push(`- Potential bugs: ${ai.potentialBugs}`);
  }
  if (ai.totalAiDiffs != null) {
    lines.push(`- Total AI visual diffs: ${ai.totalAiDiffs}`);
  }
  if (ai.diffReduction != null) {
    lines.push(`- Diff reduction: ${ai.diffReduction} diffs filtered`);
  } else if (ai.originalDiffPercent != null && ai.aiDiffPercent != null) {
    lines.push(
      `- Diff reduction: ${pct(ai.originalDiffPercent)} → ${pct(ai.aiDiffPercent)}`,
    );
  }

  const jobsCompleted =
    ai.aiJobsCompleted != null ? (ai.aiJobsCompleted ? "yes" : "no") : "N/A";
  lines.push(`- AI jobs completed: ${jobsCompleted}`);

  const summaryStatus = na(ai.summaryStatus ?? ai.aiSummaryStatus);
  lines.push(`- Summary status: ${summaryStatus}`);

  // Warning if AI is still processing
  if (ai.aiJobsCompleted === false || ai.summaryStatus === "processing") {
    lines.push("");
    lines.push(
      "> ⚠ AI analysis is still in progress. Some metrics may be incomplete. Re-run for final results.",
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function percyGetAiAnalysis(
  args: GetAiAnalysisArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  if (!args.comparison_id && !args.build_id) {
    return {
      content: [
        {
          type: "text",
          text: "_Error: Provide either `comparison_id` or `build_id` for AI analysis._",
        },
      ],
    };
  }

  const client = new PercyClient(config, { scope: "project" });

  if (args.comparison_id) {
    return analyzeComparison(args.comparison_id, client);
  }

  return analyzeBuild(args.build_id!, client);
}
