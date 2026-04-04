/**
 * percy_get_usage_stats — Get Percy screenshot usage, quota limits, and AI comparison
 * counts for an organization.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetUsageStatsArgs {
  org_id: string;
  product?: string;
}

export async function percyGetUsageStats(
  args: GetUsageStatsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { org_id, product } = args;
  const client = new PercyClient(config);

  const params: Record<string, string> = {
    "filter[organization-id]": org_id,
  };
  if (product) {
    params["filter[product]"] = product;
  }

  const response = await client.get<{
    data: Record<string, unknown> | Record<string, unknown>[] | null;
    meta?: Record<string, unknown>;
  }>("/usage-stats", params);

  const data = response?.data;
  const entries = Array.isArray(data) ? data : data ? [data] : [];

  if (entries.length === 0) {
    return {
      content: [
        { type: "text", text: "_No usage data found for this organization._" },
      ],
    };
  }

  const lines: string[] = [];
  lines.push(`## Percy Usage Stats (Org: ${org_id})`);
  lines.push("");

  for (const entry of entries) {
    const attrs = (entry as any).attributes ?? entry;
    const entryProduct = attrs.product ?? attrs["product-type"] ?? "percy";

    lines.push(`### ${entryProduct}`);
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");

    const currentUsage =
      attrs.currentUsage ?? attrs["current-usage"] ?? attrs.usage ?? "?";
    const quota = attrs.quota ?? attrs["screenshot-quota"] ?? "?";
    const aiComparisons =
      attrs.aiComparisons ?? attrs["ai-comparisons"] ?? "N/A";
    const planType = attrs.planType ?? attrs["plan-type"] ?? "N/A";

    lines.push(`| Current Usage | ${currentUsage} |`);
    lines.push(`| Quota | ${quota} |`);
    lines.push(`| AI Comparisons | ${aiComparisons} |`);
    lines.push(`| Plan Type | ${planType} |`);

    // Include any additional numeric attrs
    for (const [key, value] of Object.entries(attrs)) {
      if (
        typeof value === "number" &&
        !["currentUsage", "current-usage", "usage", "quota", "screenshot-quota", "aiComparisons", "ai-comparisons"].includes(key)
      ) {
        lines.push(`| ${key} | ${value} |`);
      }
    }

    lines.push("");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
