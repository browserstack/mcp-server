import { PercyClient } from "../../../lib/percy-api/client.js";
import { formatNetworkLogs } from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetNetworkLogs(
  args: { comparison_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);

  const data = await client.get<any>("/network-logs", {
    comparison_id: args.comparison_id,
  });

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return {
      content: [{ type: "text", text: "No network requests recorded for this comparison." }],
    };
  }

  const logs = Array.isArray(data) ? data : Object.values(data);
  const output = formatNetworkLogs(logs);

  return { content: [{ type: "text", text: output }] };
}
