import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetBuildsV2(
  args: {
    project_slug?: string;
    branch?: string;
    state?: string;
    limit?: number;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Need project_slug to list builds
  // Format: org-slug/project-slug (e.g., "9560f98d/rahul-mcp-demo-524aeb26")
  let path = "/builds";
  const params: Record<string, string> = {};

  if (args.project_slug) {
    // Use project-scoped endpoint
    path = `/projects/${args.project_slug}/builds`;
  }
  if (args.branch) params["filter[branch]"] = args.branch;
  if (args.state) params["filter[state]"] = args.state;
  params["page[limit]"] = String(args.limit || 10);

  const response = await percyGet(path, config, params);
  const builds = response?.data || [];

  if (builds.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "No builds found. Provide project_slug (e.g., 'org-id/project-slug') to filter by project.",
        },
      ],
    };
  }

  let output = `## Percy Builds (${builds.length})\n\n`;
  output += `| # | Build | Branch | State | Review | Snapshots | Diffs |\n`;
  output += `|---|---|---|---|---|---|---|\n`;

  builds.forEach((b: any, i: number) => {
    const attrs = b.attributes || {};
    const num = attrs["build-number"] || b.id;
    const branch = attrs.branch || "?";
    const state = attrs.state || "?";
    const review = attrs["review-state"] || "—";
    const snaps = attrs["total-snapshots"] ?? "?";
    const diffs = attrs["total-comparisons-diff"] ?? "—";
    output += `| ${i + 1} | #${num} (${b.id}) | ${branch} | ${state} | ${review} | ${snaps} | ${diffs} |\n`;
  });

  // Add web URL for first build
  if (builds[0]?.attributes?.["web-url"]) {
    output += `\n**View:** ${builds[0].attributes["web-url"]}\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
