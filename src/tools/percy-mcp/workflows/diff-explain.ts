import { PercyClient } from "../../../lib/percy-api/client.js";
import { formatComparison } from "../../../lib/percy-api/formatter.js";
import { pollUntil } from "../../../lib/percy-api/polling.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyDiffExplain(
  args: { comparison_id: string; depth?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);
  const depth = args.depth || "detailed";  // summary, detailed, full_rca

  // Get comparison with AI data
  const comparison = await client.get<any>(
    `/comparisons/${args.comparison_id}`,
    {},
    ["head-screenshot.image", "base-screenshot.image", "diff-image", "ai-diff-image", "browser.browser-family", "comparison-tag"],
  );

  if (!comparison) {
    return { content: [{ type: "text", text: "Comparison not found." }], isError: true };
  }

  let output = `## Visual Diff Explanation — Comparison #${args.comparison_id}\n\n`;

  // Basic diff info
  const diffRatio = comparison.diffRatio ?? 0;
  const aiDiffRatio = comparison.aiDiffRatio;
  output += `**Diff:** ${(diffRatio * 100).toFixed(1)}%`;
  if (aiDiffRatio !== null && aiDiffRatio !== undefined) {
    output += ` | **AI Diff:** ${(aiDiffRatio * 100).toFixed(1)}%`;
    const reduction = diffRatio > 0 ? ((1 - aiDiffRatio / diffRatio) * 100).toFixed(0) : "0";
    output += ` (${reduction}% noise filtered)`;
  }
  output += "\n\n";

  // Summary depth: AI descriptions only
  const regions = comparison.appliedRegions || [];
  if (regions.length > 0) {
    output += `### What Changed (${regions.length} regions)\n\n`;
    regions.forEach((region: any, i: number) => {
      const type = region.change_type || region.changeType || "unknown";
      const title = region.change_title || region.changeTitle || "Untitled change";
      const desc = region.change_description || region.changeDescription || "";
      const reason = region.change_reason || region.changeReason || "";
      const ignored = region.ignored;

      output += `${i + 1}. ${ignored ? "~~" : "**"}${title}${ignored ? "~~" : "**"} (${type})`;
      if (ignored) output += " — *ignored by AI*";
      output += "\n";
      if (desc && depth !== "summary") output += `   ${desc}\n`;
      if (reason && depth !== "summary") output += `   *Reason: ${reason}*\n`;
      output += "\n";
    });
  } else if (diffRatio > 0) {
    output += "No AI region data available. Visual diff detected but not yet analyzed by AI.\n\n";
  } else {
    output += "No visual differences detected.\n\n";
  }

  // Detailed depth: + coordinates
  if (depth === "detailed" || depth === "full_rca") {
    const coords = comparison.diffRects || comparison.aiDiffRects || [];
    if (coords.length > 0) {
      output += `### Diff Regions (coordinates)\n\n`;
      coords.forEach((rect: any, i: number) => {
        output += `${i + 1}. (${rect.x || rect.left || 0}, ${rect.y || rect.top || 0}) → (${rect.right || rect.x2 || 0}, ${rect.bottom || rect.y2 || 0})\n`;
      });
      output += "\n";
    }
  }

  // Full RCA depth: + DOM/CSS changes
  if (depth === "full_rca") {
    output += `### Root Cause Analysis\n\n`;
    try {
      // Check if RCA exists, trigger if needed
      let rcaData: any;
      try {
        rcaData = await client.get<any>("/rca", { comparison_id: args.comparison_id });
      } catch (e: any) {
        if (e.statusCode === 404) {
          // Trigger RCA
          await client.post("/rca", {
            data: { type: "rca", attributes: { "comparison-id": args.comparison_id } }
          });
          // Poll for result (max 30s for inline use)
          rcaData = await pollUntil(async () => {
            const data = await client.get<any>("/rca", { comparison_id: args.comparison_id });
            if (data?.status === "finished" || data?.status === "failed") return { done: true, result: data };
            return { done: false };
          }, { maxTimeoutMs: 30000 });
        } else {
          throw e;
        }
      }

      if (rcaData?.status === "finished" && rcaData?.diffNodes) {
        const nodes = rcaData.diffNodes;
        const commonDiffs = nodes.common_diffs || [];
        if (commonDiffs.length > 0) {
          commonDiffs.slice(0, 10).forEach((diff: any, i: number) => {
            const base = diff.base || {};
            const head = diff.head || {};
            const tag = head.tagName || base.tagName || "element";
            const xpath = head.xpath || base.xpath || "";
            output += `${i + 1}. **${tag}**`;
            if (xpath) output += ` — \`${xpath}\``;
            output += "\n";
            const baseAttrs = base.attributes || {};
            const headAttrs = head.attributes || {};
            for (const key of Object.keys(headAttrs)) {
              if (JSON.stringify(baseAttrs[key]) !== JSON.stringify(headAttrs[key])) {
                output += `   ${key}: \`${baseAttrs[key] ?? "none"}\` → \`${headAttrs[key]}\`\n`;
              }
            }
            output += "\n";
          });
        } else {
          output += "No DOM-level differences identified by RCA.\n";
        }
      } else if (rcaData?.status === "failed") {
        output += "RCA analysis failed — comparison may not have DOM metadata.\n";
      } else {
        output += "RCA analysis is still processing. Re-run with depth=full_rca later.\n";
      }
    } catch (e: any) {
      output += `RCA unavailable: ${e.message}. Falling back to AI-only analysis.\n`;
    }
  }

  return { content: [{ type: "text", text: output }] };
}
