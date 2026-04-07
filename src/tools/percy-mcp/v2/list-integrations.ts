import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyListIntegrations(
  args: { org_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet(`/organizations/${args.org_id}`, config, {
    include: "version-control-integrations,slack-integrations,msteams-integrations,email-integration"
  });

  const included = response?.included || [];
  let output = `## Integrations for Organization\n\n`;

  const vcs = included.filter((i: any) => i.type === "version-control-integrations");
  const slack = included.filter((i: any) => i.type === "slack-integrations");
  const teams = included.filter((i: any) => i.type === "msteams-integrations");
  const email = included.filter((i: any) => i.type === "email-integrations");

  if (vcs.length) {
    output += `### VCS Integrations (${vcs.length})\n`;
    vcs.forEach((v: any) => {
      const attrs = v.attributes || {};
      output += `- **${attrs["integration-type"] || attrs.integrationType || "VCS"}** — ${attrs.status || "active"}\n`;
    });
    output += "\n";
  }
  if (slack.length) {
    output += `### Slack (${slack.length})\n`;
    slack.forEach((s: any) => { output += `- ${s.attributes?.["channel-name"] || "channel"}\n`; });
    output += "\n";
  }
  if (teams.length) {
    output += `### MS Teams (${teams.length})\n`;
    teams.forEach((t: any) => { output += `- ${t.attributes?.["channel-name"] || "channel"}\n`; });
    output += "\n";
  }
  if (email.length) {
    output += `### Email\n- Configured\n\n`;
  }
  if (!vcs.length && !slack.length && !teams.length && !email.length) {
    output += `No integrations found.\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
