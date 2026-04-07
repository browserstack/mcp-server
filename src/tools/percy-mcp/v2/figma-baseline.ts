import { percyPost } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyFigmaBaseline(
  args: { project_slug: string; branch: string; build_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const result = await percyPost("/design/figma/update-baseline", config, {
    data: {
      attributes: {
        "project-slug": args.project_slug,
        branch: args.branch,
        "build-id": args.build_id,
      }
    }
  });

  let output = `## Figma Baseline Updated\n\n`;
  output += `**Project:** ${args.project_slug}\n`;
  output += `**Branch:** ${args.branch}\n`;
  output += `**Build:** ${args.build_id}\n`;
  output += `Baseline has been updated from the latest Figma designs.\n`;

  return { content: [{ type: "text", text: output }] };
}
