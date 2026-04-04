/**
 * percy_finalize_comparison — Finalize a Percy comparison after all tiles are uploaded.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface FinalizeComparisonArgs {
  comparison_id: string;
}

export async function percyFinalizeComparison(
  args: FinalizeComparisonArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "auto" });

  await client.post(`/comparisons/${args.comparison_id}/finalize`);

  return {
    content: [
      {
        type: "text",
        text: `Comparison ${args.comparison_id} finalized. Diff processing will begin.`,
      },
    ],
  };
}
