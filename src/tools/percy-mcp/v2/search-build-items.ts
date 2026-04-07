import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percySearchBuildItems(
  args: {
    build_id: string;
    category?: string;
    browser_ids?: string;
    widths?: string;
    os?: string;
    device_name?: string;
    sort_by?: string;
    limit?: number;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const params: Record<string, string> = { "filter[build-id]": args.build_id };
  if (args.category) params["filter[category]"] = args.category;
  if (args.sort_by) params["filter[sort_by]"] = args.sort_by;
  if (args.limit) params["page[limit]"] = String(args.limit);

  // Array filters
  if (args.browser_ids)
    args.browser_ids.split(",").forEach((id) => {
      params[`filter[browser_ids][]`] = id.trim();
    });
  if (args.widths)
    args.widths.split(",").forEach((w) => {
      params[`filter[widths][]`] = w.trim();
    });
  if (args.os) params["filter[os]"] = args.os;
  if (args.device_name) params["filter[device_name]"] = args.device_name;

  const response = await percyGet("/build-items", config, params);
  const items = response?.data || [];

  if (!items.length) {
    return {
      content: [
        { type: "text", text: "No items match the specified filters." },
      ],
    };
  }

  let output = `## Build Items (${items.length})\n\n`;
  output += `| # | Name | Diff | Review | Items |\n|---|---|---|---|---|\n`;
  items.forEach((item: any, i: number) => {
    const attrs = item.attributes || item;
    const name = attrs.coverSnapshotName || attrs["cover-snapshot-name"] || "?";
    const diff =
      attrs.maxDiffRatio != null
        ? `${(attrs.maxDiffRatio * 100).toFixed(1)}%`
        : "—";
    const review = attrs.reviewState || attrs["review-state"] || "?";
    const count = attrs.itemCount || attrs["item-count"] || 1;
    output += `| ${i + 1} | ${name} | ${diff} | ${review} | ${count} |\n`;
  });

  return { content: [{ type: "text", text: output }] };
}
