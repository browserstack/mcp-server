import { getOrCreateProjectToken } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { setActiveProject } from "../../../lib/percy-api/percy-session.js";

export async function percyCreateProjectV2(
  args: {
    name: string;
    type?: string;
    default_branch?: string;
    workflow?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const token = await getOrCreateProjectToken(args.name, config, args.type);

  const tokenPrefix = token.includes("_") ? token.split("_")[0] : "ci";
  const masked =
    token.length > 8 ? `${token.slice(0, 8)}...${token.slice(-4)}` : "****";
  const projectType = args.type || (tokenPrefix === "app" ? "app" : "web");

  // Store in session — all subsequent calls will use this token
  setActiveProject({
    name: args.name,
    token,
    type: projectType,
  });

  let output = `## Percy Project — ${args.name}\n\n`;
  output += `| Field | Value |\n|---|---|\n`;
  output += `| **Name** | ${args.name} |\n`;
  output += `| **Type** | ${projectType} |\n`;
  output += `| **Token** | \`${masked}\` (${tokenPrefix}) |\n`;
  output += `| **Status** | Active — token set for this session |\n`;

  output += `\n**Full token:**\n\`\`\`\n${token}\n\`\`\`\n`;
  output += `\n> Token is now **active** for all subsequent Percy commands in this session. No need to set PERCY_TOKEN manually.\n`;

  output += `\n### Next Steps\n\n`;
  if (projectType === "app") {
    output += `- \`percy_create_app_build\` with project_name "${args.name}" — Create app BYOS build\n`;
    output += `- \`percy_create_app_build\` with project_name "${args.name}" (no resources_dir) — Quick test with sample data\n`;
  } else {
    output += `- \`percy_create_build\` with project_name "${args.name}" and urls "http://localhost:3000" — Snapshot URLs\n`;
    output += `- \`percy_create_build\` with project_name "${args.name}" and screenshots_dir "./screenshots" — Upload screenshots\n`;
  }
  output += `- \`percy_get_builds\` — List builds for this project\n`;

  return { content: [{ type: "text", text: output }] };
}
