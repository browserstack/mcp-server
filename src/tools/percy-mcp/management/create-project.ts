import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyCreateProject(
  args: {
    org_id: string;
    name: string;
    type?: string;
    slug?: string;
    default_base_branch?: string;
    auto_approve_branch_filter?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "org" });

  const attributes: Record<string, unknown> = {
    name: args.name,
    type: args.type || "web",
  };

  if (args.slug) attributes["slug"] = args.slug;
  if (args.default_base_branch)
    attributes["default-base-branch"] = args.default_base_branch;
  if (args.auto_approve_branch_filter)
    attributes["auto-approve-branch-filter"] = args.auto_approve_branch_filter;

  const body = {
    data: {
      type: "projects",
      attributes,
      relationships: {
        organization: {
          data: { type: "organizations", id: args.org_id },
        },
      },
    },
  };

  const project = await client.post<any>("/projects", body);

  const id = project?.id || "unknown";
  const name = project?.name || args.name;
  const slug = project?.slug || args.slug || "unknown";
  const projectType = project?.type || args.type || "web";

  let output = `## Project Created Successfully\n\n`;
  output += `| Field | Value |\n`;
  output += `|-------|-------|\n`;
  output += `| **ID** | ${id} |\n`;
  output += `| **Name** | ${name} |\n`;
  output += `| **Slug** | ${slug} |\n`;
  output += `| **Type** | ${projectType} |\n`;
  if (args.default_base_branch)
    output += `| **Default Branch** | ${args.default_base_branch} |\n`;
  output += `\n### Next Steps\n\n`;
  output += `1. **Get project token:** Use \`percy_manage_tokens\` with project_id \`${id}\` to view tokens\n`;
  output += `2. **Create a build:** Use \`percy_create_build\` with project_id \`${id}\`\n`;
  output += `3. **Configure browsers:** Use \`percy_manage_browser_targets\` to add Chrome, Firefox, etc.\n`;

  return { content: [{ type: "text", text: output }] };
}
