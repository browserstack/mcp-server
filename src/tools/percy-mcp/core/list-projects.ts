/**
 * percy_list_projects — List Percy projects in an organization.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ListProjectsArgs {
  org_id?: string;
  search?: string;
  limit?: number;
}

export async function percyListProjects(
  args: ListProjectsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "auto" });
  const limit = Math.min(args.limit ?? 10, 50);

  const params: Record<string, string> = {
    "page[limit]": String(limit),
  };

  if (args.search) {
    params["filter[name]"] = args.search;
  }

  const path = args.org_id
    ? `/organizations/${args.org_id}/projects`
    : "/projects";

  const response = await client.get<{
    data: Record<string, unknown>[] | null;
    meta?: Record<string, unknown>;
  }>(path, params);

  const projects = Array.isArray(response.data) ? response.data : [];

  if (projects.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "_No projects found._",
        },
      ],
    };
  }

  const lines: string[] = [];
  lines.push(`## Percy Projects (${projects.length})`);
  lines.push("");
  lines.push("| # | Name | ID | Type | Default Branch |");
  lines.push("|---|------|----|------|----------------|");

  projects.forEach((project: any, i: number) => {
    const name = project.name ?? "Unnamed";
    const id = project.id ?? "?";
    const type = project.type ?? "web";
    const branch = project.defaultBaseBranch ?? "main";
    lines.push(`| ${i + 1} | ${name} | ${id} | ${type} | ${branch} |`);
  });

  if (response.meta) {
    const total =
      (response.meta as any).totalPages ?? (response.meta as any).total;
    if (total != null) {
      lines.push("");
      lines.push(`_Showing ${projects.length} of ${total} projects._`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
