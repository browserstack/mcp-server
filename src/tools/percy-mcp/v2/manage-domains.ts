import { percyGet, percyPatch } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyManageDomains(
  args: { project_id: string; action?: string; allowed_domains?: string; error_domains?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  if (!args.action || args.action === "get") {
    const response = await percyGet(`/project-domain-configs/${args.project_id}`, config);
    const attrs = response?.data?.attributes || {};
    let output = `## Domain Configuration\n\n`;
    output += `**Allowed domains:** ${attrs["allowed-domains"] || attrs.allowedDomains || "none"}\n`;
    output += `**Error domains:** ${attrs["error-domains"] || attrs.errorDomains || "none"}\n`;
    return { content: [{ type: "text", text: output }] };
  }

  if (args.action === "update") {
    const body: any = { data: { type: "project-domain-configs", attributes: {} } };
    if (args.allowed_domains) body.data.attributes["allowed-domains"] = args.allowed_domains;
    if (args.error_domains) body.data.attributes["error-domains"] = args.error_domains;
    await percyPatch(`/project-domain-configs/${args.project_id}`, config, body);
    return { content: [{ type: "text", text: `Domain configuration updated for project ${args.project_id}.` }] };
  }

  return { content: [{ type: "text", text: "Use action: get or update" }], isError: true };
}
