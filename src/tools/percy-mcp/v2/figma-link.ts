import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyFigmaLink(
  args: { snapshot_id?: string; comparison_id?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (args.snapshot_id) params.snapshot_id = args.snapshot_id;
  if (args.comparison_id) params.comparison_id = args.comparison_id;

  const result = await percyGet("/design/figma/figma-link", config, params);
  const link = result?.data?.attributes?.["figma-url"] || result?.figma_url || null;

  if (!link) {
    return { content: [{ type: "text", text: "No Figma link found for this snapshot/comparison." }] };
  }

  let output = `## Figma Link\n\n`;
  output += `**Link:** ${link}\n`;
  if (args.snapshot_id) output += `**Snapshot:** ${args.snapshot_id}\n`;
  if (args.comparison_id) output += `**Comparison:** ${args.comparison_id}\n`;

  return { content: [{ type: "text", text: output }] };
}
