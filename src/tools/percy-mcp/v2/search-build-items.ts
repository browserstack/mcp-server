import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import {
  fetchAllBuildItems,
  formatDiffPercent,
  CHANGED_CATEGORY_PARAMS,
} from "../../../lib/percy-api/build-items.js";
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
  const params: Record<string, string | string[]> = {
    "filter[build-id]": args.build_id,
  };
  if (args.category === "changed") {
    // The API resolves the changed category through subcategories; without
    // them filter[category]=changed matches nothing.
    Object.assign(params, CHANGED_CATEGORY_PARAMS);
  } else if (args.category) {
    params["filter[category]"] = args.category;
  }
  if (args.sort_by) params["filter[sort_by]"] = args.sort_by;

  // Array filters
  if (args.browser_ids)
    params["filter[browser_ids][]"] = args.browser_ids
      .split(",")
      .map((id) => id.trim());
  if (args.widths)
    params["filter[widths][]"] = args.widths.split(",").map((w) => w.trim());
  if (args.os) params["filter[os]"] = args.os;
  if (args.device_name) params["filter[device_name]"] = args.device_name;

  let items: any[];
  let truncated = false;
  if (args.limit) {
    params["page[limit]"] = String(args.limit);
    const response = await percyGet("/build-items", config, params);
    items = response?.data || [];
  } else {
    ({ items, truncated } = await fetchAllBuildItems(config, params));
  }

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
    const diff = formatDiffPercent(
      attrs.maxDiffRatio ?? attrs["max-diff-ratio"],
    );
    const review = attrs.reviewState || attrs["review-state"] || "?";
    const count = attrs.itemCount || attrs["item-count"] || 1;
    output += `| ${i + 1} | ${name} | ${diff} | ${review} | ${count} |\n`;
  });

  if (truncated) {
    output += `\n⚠️ Result may be incomplete — pagination could not be fully exhausted.\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
