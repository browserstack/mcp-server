/**
 * percy_get_comparison — Get detailed Percy comparison data.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { formatComparison } from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetComparisonArgs {
  comparison_id: string;
  include_images?: boolean;
}

export async function percyGetComparison(
  args: GetComparisonArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "project" });

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
  }>(`/comparisons/${args.comparison_id}`, undefined, includes);

  const comparison = response.data as any;

  if (!comparison) {
    return {
      content: [
        {
          type: "text",
          text: `_Comparison ${args.comparison_id} not found._`,
        },
      ],
    };
  }

  const contentParts: CallToolResult["content"] = [];

  // Always include the formatted text
  contentParts.push({
    type: "text",
    text: formatComparison(comparison, { includeRegions: true }),
  });

  // If include_images is requested, fetch and include image URLs as text
  if (args.include_images) {
    const imageLines: string[] = [];
    imageLines.push("");
    imageLines.push("### Screenshot URLs");

    const baseUrl =
      comparison.baseScreenshot?.image?.url ??
      comparison.baseScreenshot?.url;
    const headUrl =
      comparison.headScreenshot?.image?.url ??
      comparison.headScreenshot?.url;
    const diffUrl =
      comparison.diffImage?.url;
    const aiDiffUrl =
      comparison.aiDiffImage?.url;

    if (baseUrl) imageLines.push(`- **Base:** ${baseUrl}`);
    if (headUrl) imageLines.push(`- **Head:** ${headUrl}`);
    if (diffUrl) imageLines.push(`- **Diff:** ${diffUrl}`);
    if (aiDiffUrl) imageLines.push(`- **AI Diff:** ${aiDiffUrl}`);

    if (imageLines.length > 2) {
      contentParts.push({
        type: "text",
        text: imageLines.join("\n"),
      });
    }
  }

  return { content: contentParts };
}
