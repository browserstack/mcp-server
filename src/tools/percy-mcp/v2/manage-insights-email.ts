import { percyGet, percyPost, percyPatch } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyManageInsightsEmail(
  args: { org_id: string; action?: string; emails?: string; enabled?: boolean },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const action = args.action || "get";

  if (action === "get") {
    const response = await percyGet(`/organizations/${args.org_id}/insights-email-settings`, config);
    const data = response?.data?.attributes || {};
    let output = `## Insights Email Settings\n\n`;
    output += `**Enabled:** ${data["is-enabled"] ?? data.isEnabled ?? "unknown"}\n`;
    output += `**Recipients:** ${(data.emails || []).join(", ") || "none"}\n`;
    return { content: [{ type: "text", text: output }] };
  }

  if (action === "create" || action === "update") {
    const emailList = args.emails ? args.emails.split(",").map(e => e.trim()) : [];
    const body = {
      data: {
        type: "insights-email-settings",
        attributes: {
          emails: emailList,
          "is-enabled": args.enabled !== false,
        },
      },
    };

    if (action === "create") {
      await percyPost(`/organizations/${args.org_id}/insights-email-settings`, config, body);
    } else {
      await percyPatch(`/insights-email-settings/${args.org_id}`, config, body);
    }

    return { content: [{ type: "text", text: `Insights email ${action}d. Recipients: ${emailList.join(", ")}` }] };
  }

  return { content: [{ type: "text", text: `Unknown action: ${action}. Use get, create, or update.` }], isError: true };
}
