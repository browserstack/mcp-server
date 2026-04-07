import { percyPost, percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyDiscoverUrls(
  args: { project_id: string; sitemap_url?: string; action?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const action = args.action || (args.sitemap_url ? "create" : "list");

  if (action === "create" && args.sitemap_url) {
    const result = await percyPost("/sitemaps", config, {
      data: {
        type: "sitemaps",
        attributes: { url: args.sitemap_url, "project-id": args.project_id },
      },
    });
    const urls =
      result?.included?.filter((i: any) => i.type === "sitemap-urls") || [];
    let output = `## URLs Discovered from Sitemap\n\n`;
    output += `**Sitemap:** ${args.sitemap_url}\n`;
    output += `**URLs found:** ${urls.length}\n\n`;
    urls.forEach((u: any, i: number) => {
      output += `${i + 1}. ${u.attributes?.url || u.url || "?"}\n`;
    });
    if (urls.length === 0)
      output += `No URLs found in sitemap. Check the URL.\n`;
    output += `\nUse these URLs with \`percy_create_build\` to snapshot them.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // List existing sitemaps
  const response = await percyGet("/sitemaps", config, {
    project_id: args.project_id,
  });
  const sitemaps = response?.data || [];
  let output = `## Sitemaps for Project\n\n`;
  if (!sitemaps.length) {
    output += `No sitemaps found. Create one with \`sitemap_url\` parameter.\n`;
  } else {
    sitemaps.forEach((s: any, i: number) => {
      output += `${i + 1}. ${s.attributes?.url || "?"} (${s.attributes?.state || "?"})\n`;
    });
  }
  return { content: [{ type: "text", text: output }] };
}
