import { percyPost } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyPreviewComparison(
  args: { comparison_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  await percyPost("/comparison-previews", config, {
    data: { type: "comparison-previews", attributes: { "comparison-id": args.comparison_id } }
  });

  return { content: [{ type: "text", text: `## Comparison Preview\n\nRecomputation triggered for comparison ${args.comparison_id}.\nThe diff will be re-processed with current AI and region settings.\nRefresh the build in Percy to see updated results.` }] };
}
