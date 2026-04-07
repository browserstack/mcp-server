import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetInsights(
  args: { org_slug: string; period?: string; product?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const params: Record<string, string> = {
    period: args.period || "last_30_days",
    product: args.product || "web",
  };

  const response = await percyGet(
    `/insights/metrics/${args.org_slug}`,
    config,
    params,
  );
  const data = response?.data?.attributes || response?.data || {};

  let output = `## Percy Testing Insights — ${args.org_slug}\n\n`;
  output += `**Period:** ${params.period}\n**Product:** ${params.product}\n\n`;

  // Review efficiency
  const review = data.reviewEfficiency || data["review-efficiency"] || {};
  if (review) {
    output += `### Review Efficiency\n`;
    output += `| Metric | Value |\n|---|---|\n`;
    if (review.meaningfulReviewTimeRatio != null)
      output += `| Meaningful review ratio | ${(review.meaningfulReviewTimeRatio * 100).toFixed(0)}% |\n`;
    if (review.totalReviews != null)
      output += `| Total reviews | ${review.totalReviews} |\n`;
    if (review.noisyReviews != null)
      output += `| Noisy reviews | ${review.noisyReviews} |\n`;
    if (review.medianReviewTimeSeconds != null)
      output += `| Median review time | ${review.medianReviewTimeSeconds}s |\n`;
    output += "\n";
  }

  // ROI
  const roi = data.roiTimeSavings || data["roi-time-savings"] || {};
  if (roi) {
    output += `### ROI & Time Savings\n`;
    output += `| Metric | Value |\n|---|---|\n`;
    if (roi.totalTimeSaved != null)
      output += `| Total time saved | ${roi.totalTimeSaved} min |\n`;
    if (roi.noDiffPercentage != null)
      output += `| No-diff percentage | ${(roi.noDiffPercentage * 100).toFixed(0)}% |\n`;
    if (roi.buildsCount != null) output += `| Builds | ${roi.buildsCount} |\n`;
    output += "\n";
  }

  // Coverage
  const coverage = data.coverage || {};
  if (coverage) {
    output += `### Coverage\n`;
    output += `| Metric | Value |\n|---|---|\n`;
    if (coverage.coveragePercentage != null)
      output += `| Coverage | ${coverage.coveragePercentage.toFixed(0)}% |\n`;
    if (coverage.activeSnapshotsCount != null)
      output += `| Active snapshots | ${coverage.activeSnapshotsCount} |\n`;
    output += "\n";
  }

  return { content: [{ type: "text", text: output }] };
}
