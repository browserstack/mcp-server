import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { setActiveBuild } from "../../../lib/percy-api/percy-session.js";

export async function percyGetBuildsV2(
  args: {
    project_slug?: string;
    branch?: string;
    state?: string;
    limit?: number;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  let path = "/builds";
  const params: Record<string, string> = {};

  if (args.project_slug) {
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
          text: "No builds found. Use `percy_get_projects` to find project slugs, then filter with `project_slug`.",
        },
      ],
    };
  }

  let output = `## Percy Builds (${builds.length})\n\n`;
  output += `| # | Build ID | Build # | Branch | State | Review | Snapshots | Diffs | URL |\n`;
  output += `|---|---|---|---|---|---|---|---|---|\n`;

  builds.forEach((b: any, i: number) => {
    const attrs = b.attributes || {};
    const num = attrs["build-number"] || "—";
    const branch = attrs.branch || "?";
    const state = attrs.state || "?";
    const review = attrs["review-state"] || "—";
    const snaps = attrs["total-snapshots"] ?? "?";
    const diffs = attrs["total-comparisons-diff"] ?? "—";
    const webUrl = attrs["web-url"] || "";
    const urlShort = webUrl ? `[View](${webUrl})` : "—";
    output += `| ${i + 1} | ${b.id} | #${num} | ${branch} | ${state} | ${review} | ${snaps} | ${diffs} | ${urlShort} |\n`;
  });

  // Set the most recent build as active
  const latest = builds[0];
  if (latest) {
    const latestAttrs = latest.attributes || {};
    setActiveBuild({
      id: latest.id,
      number: latestAttrs["build-number"]?.toString(),
      url: latestAttrs["web-url"],
      branch: latestAttrs.branch,
    });
  }

  // Quick access to latest build
  output += `\n### Latest Build: #${latest.attributes?.["build-number"] || latest.id} (ID: ${latest.id})\n\n`;
  if (latest.attributes?.["web-url"]) {
    output += `**URL:** ${latest.attributes["web-url"]}\n\n`;
  }

  output += `### Drill Down\n\n`;
  output += `- \`percy_get_build\` with build_id "${latest.id}" — Full overview\n`;
  output += `- \`percy_get_build\` with build_id "${latest.id}" and detail "snapshots" — All snapshots\n`;
  output += `- \`percy_get_build\` with build_id "${latest.id}" and detail "ai_summary" — AI analysis\n`;
  output += `- \`percy_search_builds\` with build_id "${latest.id}" and category "changed" — Only diffs\n`;

  return { content: [{ type: "text", text: output }] };
}
