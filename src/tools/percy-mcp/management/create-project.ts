import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Creates a Percy project using the BrowserStack API.
 *
 * Uses `api.browserstack.com/api/app_percy/get_project_token` which:
 * - Creates the project if it doesn't exist
 * - Returns a project token for the project
 * - Requires BrowserStack Basic Auth (username + access key)
 */
export async function percyCreateProject(
  args: {
    name: string;
    type?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const params = new URLSearchParams({ name: args.name });
  if (args.type) {
    params.append("type", args.type);
  }

  const url = `https://api.browserstack.com/api/app_percy/get_project_token?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Failed to create Percy project (${response.status}): ${errorText || response.statusText}`,
    );
  }

  const data = await response.json();

  if (!data?.success) {
    throw new Error(
      data?.message ||
        "Project creation failed — check the project name and type.",
    );
  }

  const token = data.token || "unknown";
  const tokenPrefix = token.split("_")[0] || "unknown";
  const maskedToken =
    token.length > 8 ? `${token.slice(0, 8)}...${token.slice(-4)}` : "****";

  let output = `## Percy Project Created\n\n`;
  output += `| Field | Value |\n`;
  output += `|-------|-------|\n`;
  output += `| **Name** | ${args.name} |\n`;
  output += `| **Type** | ${args.type || "auto (default)"} |\n`;
  output += `| **Token** | \`${maskedToken}\` |\n`;
  output += `| **Token type** | ${tokenPrefix} |\n`;
  output += `| **Capture mode** | ${data.percy_capture_mode || "auto"} |\n`;
  output += `\n### Project Token\n\n`;
  output += `\`\`\`\n${token}\n\`\`\`\n\n`;
  output += `> Save this token — set it as \`PERCY_TOKEN\` env var to use with other Percy tools.\n\n`;
  output += `### Next Steps\n\n`;
  output += `1. Set the token: \`export PERCY_TOKEN=${token}\`\n`;
  output += `2. Create a build: \`percy_create_build\` with project_id from Percy dashboard\n`;
  output += `3. Or run Percy CLI: \`percy exec -- your-test-command\`\n`;

  return { content: [{ type: "text", text: output }] };
}
