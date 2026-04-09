import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetSnapshot(
  args: { snapshot_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet(`/snapshots/${args.snapshot_id}`, config, {
    include: [
      "comparisons.head-screenshot.image",
      "comparisons.base-screenshot.image",
      "comparisons.diff-image",
      "comparisons.ai-diff-image",
      "comparisons.browser.browser-family",
      "comparisons.comparison-tag",
    ].join(","),
  });

  const snap = response?.data || {};
  const attrs = snap.attributes || {};
  const included = response?.included || [];

  let output = `## Snapshot: ${attrs.name || args.snapshot_id}\n\n`;

  if (attrs["display-name"] && attrs["display-name"] !== attrs.name) {
    output += `**Display name:** ${attrs["display-name"]}\n`;
  }

  output += `| Field | Value |\n|---|---|\n`;
  output += `| **Review** | ${attrs["review-state"] || "—"} (${attrs["review-state-reason"] || "—"}) |\n`;
  output += `| **Diff ratio** | ${attrs["diff-ratio"] != null ? (attrs["diff-ratio"] * 100).toFixed(2) + "%" : "—"} |\n`;
  output += `| **Test case** | ${attrs["test-case-name"] || "none"} |\n`;
  output += `| **Comments** | ${attrs["total-open-comments"] ?? 0} |\n`;
  output += `| **Layout** | ${attrs["enable-layout"] ? "enabled" : "disabled"} |\n`;

  // Comparisons table
  const comps = included.filter((i: any) => i.type === "comparisons");
  const browsers = new Map(
    included
      .filter((i: any) => i.type === "browsers")
      .map((b: any) => {
        const family = included.find(
          (f: any) =>
            f.type === "browser-families" &&
            f.id === b.relationships?.["browser-family"]?.data?.id,
        );
        return [
          b.id,
          `${family?.attributes?.name || "?"} ${b.attributes?.version || ""}`,
        ];
      }),
  );
  const images = new Map<string, any>(
    included
      .filter((i: any) => i.type === "images")
      .map((img: any) => [img.id, img.attributes]),
  );

  if (comps.length > 0) {
    output += `\n### Comparisons (${comps.length})\n\n`;
    output += `| Browser | Width | Diff | AI Diff | AI State | Bugs |\n|---|---|---|---|---|---|\n`;

    comps.forEach((c: any) => {
      const ca = c.attributes || {};
      const browserId = c.relationships?.browser?.data?.id;
      const browserName = browsers.get(browserId) || "?";
      const diff =
        ca["diff-ratio"] != null
          ? (ca["diff-ratio"] * 100).toFixed(1) + "%"
          : "—";
      const aiDiff =
        ca["ai-diff-ratio"] != null
          ? (ca["ai-diff-ratio"] * 100).toFixed(1) + "%"
          : "—";
      const aiState = ca["ai-processing-state"] || "—";
      const bugs = ca["ai-details"]?.["total-potential-bugs"] ?? "—";
      output += `| ${browserName} | ${ca.width || "?"}px | ${diff} | ${aiDiff} | ${aiState} | ${bugs} |\n`;
    });

    // Show AI regions for comparisons that have them
    const compsWithRegions = comps.filter(
      (c: any) => c.attributes?.["applied-regions"]?.length > 0,
    );
    if (compsWithRegions.length > 0) {
      output += `\n### AI Detected Changes\n\n`;
      for (const c of compsWithRegions) {
        const regions = c.attributes["applied-regions"];
        regions.forEach((r: any) => {
          const ignored = r.ignored ? " *(ignored)*" : "";
          output += `- **${r.change_title || r.change_type || "Change"}** (${r.change_type || "?"})${ignored}\n`;
          if (r.change_description) output += `  ${r.change_description}\n`;
          if (r.change_reason) output += `  *Reason: ${r.change_reason}*\n`;
        });
      }
    }

    // Image URLs for first comparison
    const firstComp = comps[0];
    const headScreenshotId =
      firstComp?.relationships?.["head-screenshot"]?.data?.id;
    const headScreenshot = included.find(
      (i: any) => i.type === "screenshots" && i.id === headScreenshotId,
    );
    const headImageId = headScreenshot?.relationships?.image?.data?.id;
    const headImage = headImageId ? images.get(headImageId) : null;

    if (headImage?.url) {
      output += `\n### Images (first comparison)\n\n`;
      output += `**Head:** ${headImage.url}\n`;

      const baseScreenshotId =
        firstComp?.relationships?.["base-screenshot"]?.data?.id;
      const baseScreenshot = included.find(
        (i: any) => i.type === "screenshots" && i.id === baseScreenshotId,
      );
      const baseImageId = baseScreenshot?.relationships?.image?.data?.id;
      const baseImage = baseImageId ? images.get(baseImageId) : null;
      if (baseImage?.url) output += `**Base:** ${baseImage.url}\n`;

      const diffImageId = firstComp?.relationships?.["diff-image"]?.data?.id;
      const diffImage = diffImageId ? images.get(diffImageId) : null;
      if (diffImage?.url) output += `**Diff:** ${diffImage.url}\n`;
    }
  }

  return { content: [{ type: "text", text: output }] };
}
