/**
 * percy_list_builds — List Percy builds for a project with filtering.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { formatBuildStatus } from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ListBuildsArgs {
  project_id?: string;
  branch?: string;
  state?: string;
  sha?: string;
  limit?: number;
}

export async function percyListBuilds(
  args: ListBuildsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "project" });
  const limit = Math.min(args.limit ?? 10, 30);

  const params: Record<string, string> = {
    "page[limit]": String(limit),
  };

  if (args.branch) {
    params["filter[branch]"] = args.branch;
  }
  if (args.state) {
    params["filter[state]"] = args.state;
  }
  if (args.sha) {
    params["filter[sha]"] = args.sha;
  }

  const path = args.project_id
    ? `/projects/${args.project_id}/builds`
    : "/builds";

  const response = await client.get<{
    data: Record<string, unknown>[] | null;
    meta?: Record<string, unknown>;
  }>(path, params);

  const builds = Array.isArray(response.data) ? response.data : [];

  if (builds.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "_No builds found matching the specified filters._",
        },
      ],
    };
  }

  const lines: string[] = [];
  lines.push(`## Percy Builds (${builds.length})`);
  lines.push("");

  for (const build of builds) {
    lines.push(`- ${formatBuildStatus(build)} (ID: ${build.id})`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
