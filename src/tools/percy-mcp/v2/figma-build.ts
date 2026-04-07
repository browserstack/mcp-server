import { percyPost } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyFigmaBuild(
  args: { project_slug: string; branch: string; figma_url: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Step 1: Fetch design from Figma URL
  const fetchResult = await percyPost("/design/figma/fetch-design", config, {
    data: { attributes: { "figma-url": args.figma_url } }
  });

  const nodes = fetchResult?.data?.attributes?.nodes || fetchResult?.nodes || [];
  if (!nodes.length && !fetchResult?.data) {
    return { content: [{ type: "text", text: `No design nodes found at ${args.figma_url}. Check the Figma URL and ensure it points to a frame or component.` }], isError: true };
  }

  // Step 2: Create build from design data
  const figmaData = Array.isArray(nodes) ? nodes : [nodes];
  const buildResult = await percyPost("/design/figma/create-build", config, {
    data: {
      attributes: {
        branch: args.branch,
        "project-slug": args.project_slug,
        "figma-url": args.figma_url,
        "figma-data": figmaData,
      }
    }
  });

  const buildId = buildResult?.data?.id || "unknown";
  let output = `## Figma Build Created\n\n`;
  output += `**Build ID:** ${buildId}\n`;
  output += `**Project:** ${args.project_slug}\n`;
  output += `**Branch:** ${args.branch}\n`;
  output += `**Figma URL:** ${args.figma_url}\n`;
  output += `**Design nodes:** ${figmaData.length}\n`;

  return { content: [{ type: "text", text: output }] };
}
