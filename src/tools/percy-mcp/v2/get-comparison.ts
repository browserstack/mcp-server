import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetComparison(
  args: { comparison_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet(
    `/comparisons/${args.comparison_id}`,
    config,
    {
      include: [
        "head-screenshot.image",
        "base-screenshot.image",
        "diff-image",
        "ai-diff-image",
        "browser.browser-family",
        "comparison-tag",
      ].join(","),
    },
  );

  const comp = response?.data || {};
  const attrs = comp.attributes || {};
  const included = response?.included || [];
  const ai = attrs["ai-details"] || {};

  // Resolve browser name
  const browserId = comp.relationships?.browser?.data?.id;
  const browser = included.find(
    (i: any) => i.type === "browsers" && i.id === browserId,
  );
  const familyId = browser?.relationships?.["browser-family"]?.data?.id;
  const family = included.find(
    (i: any) => i.type === "browser-families" && i.id === familyId,
  );
  const browserName = `${family?.attributes?.name || "?"} ${browser?.attributes?.version || ""}`;

  let output = `## Comparison #${args.comparison_id}\n\n`;

  output += `| Field | Value |\n|---|---|\n`;
  output += `| **Browser** | ${browserName} |\n`;
  output += `| **Width** | ${attrs.width || "?"}px |\n`;
  output += `| **State** | ${attrs.state || "?"} |\n`;
  output += `| **Diff ratio** | ${attrs["diff-ratio"] != null ? (attrs["diff-ratio"] * 100).toFixed(2) + "%" : "—"} |\n`;
  output += `| **AI diff ratio** | ${attrs["ai-diff-ratio"] != null ? (attrs["ai-diff-ratio"] * 100).toFixed(2) + "%" : "—"} |\n`;
  output += `| **AI state** | ${attrs["ai-processing-state"] || "—"} |\n`;
  output += `| **Potential bugs** | ${ai["total-potential-bugs"] ?? "—"} |\n`;
  output += `| **AI visual diffs** | ${ai["total-ai-visual-diffs"] ?? "—"} |\n`;
  output += `| **Diffs reduced** | ${ai["total-diffs-reduced-capped"] ?? "—"} |\n`;

  // AI regions (the detailed change descriptions)
  const regions = attrs["applied-regions"];
  if (Array.isArray(regions) && regions.length > 0) {
    output += `\n### AI Detected Changes (${regions.length})\n\n`;
    regions.forEach((r: any, i: number) => {
      const ignored = r.ignored ? " ~~ignored~~" : "";
      output += `${i + 1}. **${r.change_title || r.change_type || "Change"}** (${r.change_type || "?"})${ignored}\n`;
      if (r.change_description) output += `   ${r.change_description}\n`;
      if (r.change_reason) output += `   *Reason: ${r.change_reason}*\n`;
      if (r.coordinates) {
        const c = r.coordinates;
        output += `   Region: (${c.x || c.left || 0}, ${c.y || c.top || 0}) → (${c.x2 || c.right || c.x + c.width || 0}, ${c.y2 || c.bottom || c.y + c.height || 0})\n`;
      }
      output += "\n";
    });
  }

  // Image URLs
  const resolveImageUrl = (relName: string): string | null => {
    const screenshotId = comp.relationships?.[relName]?.data?.id;
    if (!screenshotId) return null;

    // Direct image relationship
    const directImage = included.find(
      (i: any) => i.type === "images" && i.id === screenshotId,
    );
    if (directImage?.attributes?.url) return directImage.attributes.url;

    // Screenshot → image relationship
    const screenshot = included.find(
      (i: any) => i.type === "screenshots" && i.id === screenshotId,
    );
    const imageId = screenshot?.relationships?.image?.data?.id;
    if (imageId) {
      const image = included.find(
        (i: any) => i.type === "images" && i.id === imageId,
      );
      return image?.attributes?.url || null;
    }
    return null;
  };

  output += `### Images\n\n`;
  const headUrl = resolveImageUrl("head-screenshot");
  const baseUrl = resolveImageUrl("base-screenshot");
  const diffUrl = resolveImageUrl("diff-image");
  const aiDiffUrl = resolveImageUrl("ai-diff-image");

  if (headUrl) output += `**Head:** ${headUrl}\n`;
  if (baseUrl) output += `**Base:** ${baseUrl}\n`;
  if (diffUrl) output += `**Diff:** ${diffUrl}\n`;
  if (aiDiffUrl) output += `**AI Diff:** ${aiDiffUrl}\n`;
  if (!headUrl && !baseUrl && !diffUrl) output += `No images available.\n`;

  // Error info
  if (attrs["error-buckets-exists"]) {
    output += `\n### Errors\n\n`;
    const assetFailures = attrs["asset-failure-category-counts"];
    if (assetFailures) {
      output += `**Asset failures:** ${JSON.stringify(assetFailures)}\n`;
    }
  }

  return { content: [{ type: "text", text: output }] };
}
