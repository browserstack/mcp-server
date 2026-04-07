import { percyPost, getOrCreateProjectToken } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyCreateProjectV2(
  args: { name: string; type?: string; default_branch?: string; workflow?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Use BrowserStack API to create/get project
  const token = await getOrCreateProjectToken(args.name, config, args.type);

  const tokenPrefix = token.includes("_") ? token.split("_")[0] : "ci";
  const masked = token.length > 8 ? `${token.slice(0, 8)}...${token.slice(-4)}` : "****";

  let output = `## Percy Project\n\n`;
  output += `| Field | Value |\n|---|---|\n`;
  output += `| **Name** | ${args.name} |\n`;
  output += `| **Type** | ${args.type || "auto"} |\n`;
  output += `| **Token** | \`${masked}\` (${tokenPrefix}) |\n`;
  output += `\n**Full token** (save this):\n\`\`\`\n${token}\n\`\`\`\n\n`;
  output += `> Set as PERCY_TOKEN in percy-config/config to use with percy CLI commands.\n`;

  return { content: [{ type: "text", text: output }] };
}
