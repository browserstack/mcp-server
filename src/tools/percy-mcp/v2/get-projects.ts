import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { setOrg } from "../../../lib/percy-api/percy-session.js";

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
    return {
      content: [
        {
          type: "text",
          text: "No projects found. Use `percy_create_project` to create one.",
        },
      ],
    };
  }

  // Extract org slug from the first project's full-slug
  const firstSlug = projects[0]?.attributes?.["full-slug"] || "";
  const orgSlug = firstSlug.split("/")[0] || "";
  if (orgSlug) setOrg({ slug: orgSlug });

  let output = `## Percy Projects (${projects.length})\n\n`;
  output += `| # | Name | ID | Type | Slug (for builds) |\n|---|---|---|---|---|\n`;

  projects.forEach((p: any, i: number) => {
    const name = p.attributes?.name || "?";
    const type = p.attributes?.type || "?";
    const fullSlug = p.attributes?.["full-slug"] || p.attributes?.slug || "?";
    output += `| ${i + 1} | ${name} | ${p.id} | ${type} | \`${fullSlug}\` |\n`;
  });

  if (orgSlug) {
    output += `\n**Organization:** ${orgSlug}\n`;
  }

  output += `\n### Usage\n\n`;
  output += `- \`percy_get_builds\` with project_slug "${firstSlug}" — List builds for a project\n`;
  output += `- \`percy_create_project\` with name "my-project" — Create new project & activate token\n`;
  output += `- \`percy_create_build\` with project_name "my-project" — Create a build\n`;

  return { content: [{ type: "text", text: output }] };
}
