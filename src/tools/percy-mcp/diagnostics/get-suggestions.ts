import { PercyClient } from "../../../lib/percy-api/client.js";
import { formatSuggestions } from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetSuggestions(
  args: { build_id: string; reference_type?: string; reference_id?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);

  const params: Record<string, string> = { build_id: args.build_id };
  if (args.reference_type) params.reference_type = args.reference_type;
  if (args.reference_id) params.reference_id = args.reference_id;

  const data = await client.get<any>("/suggestions", params);

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return {
      content: [{ type: "text", text: "No diagnostic suggestions available for this build." }],
    };
  }

  const suggestions = Array.isArray(data) ? data : [data];
  const output = formatSuggestions(suggestions);

  return { content: [{ type: "text", text: output }] };
}
