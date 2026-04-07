import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetProjectsV2(
  args: { search?: string; limit?: number },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (args.search) params["filter[search]"] = args.search;
  params["page[limit]"] = String(args.limit || 20);

  const response = await percyGet("/projects", config, params);
  const projects = response?.data || [];

  if (projects.length === 0) {
    return { content: [{ type: "text", text: "No projects found." }] };
  }

  let output = `## Percy Projects (${projects.length})\n\n`;
  output += `| # | Name | Type | Slug |\n|---|---|---|---|\n`;

  projects.forEach((p: any, i: number) => {
    const name = p.attributes?.name || "?";
    const type = p.attributes?.type || "?";
    const slug = p.attributes?.slug || "?";
    output += `| ${i + 1} | ${name} | ${type} | ${slug} |\n`;
  });

  return { content: [{ type: "text", text: output }] };
}
