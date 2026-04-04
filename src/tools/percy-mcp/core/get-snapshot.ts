/**
 * percy_get_snapshot — Get a Percy snapshot with all comparisons and screenshots.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import {
  formatSnapshot,
  formatComparison,
} from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetSnapshotArgs {
  snapshot_id: string;
}

export async function percyGetSnapshot(
  args: GetSnapshotArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "project" });

  const includes = [
    "comparisons.head-screenshot.image",
    "comparisons.base-screenshot.lossy-image",
    "comparisons.diff-image",
    "comparisons.browser.browser-family",
    "comparisons.comparison-tag",
  ];

  const response = await client.get<{
    data: Record<string, unknown> | null;
  }>(`/snapshots/${args.snapshot_id}`, undefined, includes);

  const snapshot = response.data as any;

  if (!snapshot) {
    return {
      content: [{ type: "text", text: `_Snapshot ${args.snapshot_id} not found._` }],
    };
  }

  const comparisons = snapshot.comparisons ?? [];

  const lines: string[] = [];
  lines.push(formatSnapshot(snapshot, comparisons));

  if (comparisons.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("### Comparison Details");
    for (const comparison of comparisons) {
      lines.push("");
      lines.push(formatComparison(comparison, { includeRegions: true }));
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
