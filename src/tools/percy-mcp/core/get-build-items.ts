/**
 * percy_get_build_items — List snapshots in a Percy build filtered by category.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetBuildItemsArgs {
  build_id: string;
  category?: string;
  sort_by?: string;
  limit?: number;
}

function na(value: unknown): string {
  if (value == null || value === "") return "N/A";
  return String(value);
}

function pct(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

export async function percyGetBuildItems(
  args: GetBuildItemsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "project" });
  const limit = Math.min(args.limit ?? 20, 100);

  const params: Record<string, string> = {
    "filter[build-id]": args.build_id,
    "page[limit]": String(limit),
  };

  if (args.category) {
    params["filter[category]"] = args.category;
  }
  if (args.sort_by) {
    params["sort"] = args.sort_by;
  }

  const response = await client.get<{
    data: Record<string, unknown>[] | null;
    meta?: Record<string, unknown>;
  }>("/build-items", params);

  const items = Array.isArray(response.data) ? response.data : [];

  if (items.length === 0) {
    const category = args.category ? ` in category "${args.category}"` : "";
    return {
      content: [
        {
          type: "text",
          text: `_No snapshots found${category} for build ${args.build_id}._`,
        },
      ],
    };
  }

  const lines: string[] = [];
  const category = args.category ? ` (${args.category})` : "";
  lines.push(`## Build Snapshots${category} — ${items.length} items`);
  lines.push("");
  lines.push("| # | Snapshot Name | ID | Diff | AI Diff | Status |");
  lines.push("|---|---------------|----|----- |---------|--------|");

  items.forEach((item: any, i: number) => {
    const name = na(item.name ?? item.snapshotName);
    const id = na(item.id ?? item.snapshotId);
    const diff = pct(item.diffRatio);
    const aiDiff = pct(item.aiDiffRatio);
    const status = na(item.reviewState ?? item.state);
    lines.push(`| ${i + 1} | ${name} | ${id} | ${diff} | ${aiDiff} | ${status} |`);
  });

  if (response.meta) {
    const total = (response.meta as any).totalEntries ?? (response.meta as any).total;
    if (total != null && total > items.length) {
      lines.push("");
      lines.push(`_Showing ${items.length} of ${total} snapshots._`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
