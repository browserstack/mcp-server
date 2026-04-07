import {
  percyGet,
  percyPost,
  percyPatch,
} from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyManageUsageAlerts(
  args: {
    org_id: string;
    action?: string;
    threshold?: number;
    emails?: string;
    enabled?: boolean;
    product?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const action = args.action || "get";

  if (action === "get") {
    const response = await percyGet(
      `/organizations/${args.org_id}/usage_notification_settings`,
      config,
      {
        "data[attributes][type]": args.product || "web",
      },
    );
    const data = response?.data?.attributes || {};
    let output = `## Usage Alert Settings\n\n`;
    output += `**Enabled:** ${data["is-enabled"] ?? "unknown"}\n`;
    output += `**Thresholds:** ${JSON.stringify(data.thresholds || {})}\n`;
    output += `**Emails:** ${(data.emails || []).join(", ") || "none"}\n`;
    return { content: [{ type: "text", text: output }] };
  }

  const emailList = args.emails
    ? args.emails.split(",").map((e) => e.trim())
    : [];
  const body = {
    data: {
      type: "usage-notification-settings",
      attributes: {
        type: args.product || "web",
        "is-enabled": args.enabled !== false,
        thresholds: args.threshold ? { "snapshot-count": args.threshold } : {},
        emails: emailList,
      },
    },
  };

  if (action === "create") {
    await percyPost(
      `/organization/${args.org_id}/usage-notification-settings`,
      config,
      body,
    );
  } else {
    await percyPatch(
      `/usage-notification-settings/${args.org_id}`,
      config,
      body,
    );
  }

  return {
    content: [
      {
        type: "text",
        text: `Usage alerts ${action}d. Threshold: ${args.threshold || "default"}`,
      },
    ],
  };
}
