import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getSession,
  formatActiveProject,
  formatActiveBuild,
} from "../../../lib/percy-api/percy-session.js";

export async function percyAuthStatusV2(
  _args: Record<string, never>,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  let output = `## Percy Auth Status\n\n`;

  const hasCreds = !!(
    config["browserstack-username"] && config["browserstack-access-key"]
  );

  output += `| Credential | Status |\n|---|---|\n`;
  output += `| BrowserStack Username | ${hasCreds ? config["browserstack-username"] : "Not set"} |\n`;
  output += `| BrowserStack Access Key | ${hasCreds ? "Set" : "Not set"} |\n`;
  output += "\n";

  // Note about PERCY_TOKEN — it's per-project, not global
  output += `> **Note:** PERCY_TOKEN is set per-project, not globally. Use \`percy_create_project\` to get a project token — it will be activated automatically for subsequent calls.\n\n`;

  if (hasCreds) {
    output += `### Validation\n\n`;

    // Test BrowserStack API by checking user info (lightweight, won't 500)
    const bsAuth = Buffer.from(
      `${config["browserstack-username"]}:${config["browserstack-access-key"]}`,
    ).toString("base64");

    try {
      const response = await fetch(
        "https://api.browserstack.com/api/app_percy/user",
        { headers: { Authorization: `Basic ${bsAuth}` } },
      );
      if (response.ok) {
        const userData = await response.json();
        const orgName = userData?.organizations?.[0]?.name;
        const orgId = userData?.organizations?.[0]?.id;
        output += `**BrowserStack API:** Connected\n`;
        if (orgName) output += `**Organization:** ${orgName}`;
        if (orgId) output += ` (ID: ${orgId})`;
        output += `\n`;
      } else {
        output += `**BrowserStack API:** ${response.status} ${response.statusText}\n`;
      }
    } catch (e: any) {
      output += `**BrowserStack API:** Failed — ${e.message}\n`;
    }

    // Test Percy API read access (use a lightweight endpoint)
    try {
      await percyGet("/organizations", config, { "page[limit]": "1" });
      output += `**Percy API (Basic Auth):** Connected\n`;
    } catch (e: any) {
      // If /organizations fails, try a simpler endpoint
      try {
        await percyGet("/user", config);
        output += `**Percy API (Basic Auth):** Connected\n`;
      } catch {
        output += `**Percy API (Basic Auth):** Limited — ${e.message}\n`;
        output += `This is OK. All project-scoped tools work via BrowserStack API.\n`;
      }
    }
  }

  output += "\n### Capabilities\n\n";
  if (hasCreds) {
    output += `All Percy MCP tools are available:\n`;
    output += `- Create/manage projects and tokens\n`;
    output += `- Create builds (URL, screenshot, app BYOS)\n`;
    output += `- Read builds, snapshots, comparisons\n`;
    output += `- AI analysis, RCA, insights\n`;
    output += `- Clone builds, Figma integration\n`;
  } else {
    output += `No BrowserStack credentials found.\n\n`;
    output += `Set your credentials in MCP server config or environment:\n`;
    output += `\`\`\`bash\nexport BROWSERSTACK_USERNAME="your_username"\nexport BROWSERSTACK_ACCESS_KEY="your_key"\n\`\`\`\n`;
  }

  // Show active session context
  const session = getSession();
  if (session.projectName || session.buildId) {
    output += `\n### Active Session\n`;
    output += formatActiveProject();
    output += formatActiveBuild();
  }

  output += `\n### Getting Started\n\n`;
  output += `1. \`percy_create_project\` — Create/access a project (sets active token)\n`;
  output += `2. \`percy_create_build\` — Create a web build with URLs or screenshots\n`;
  output += `3. \`percy_create_app_build\` — Create an app BYOS build (works with sample data)\n`;
  output += `4. \`percy_get_projects\` — List all projects in your org\n`;

  return { content: [{ type: "text", text: output }] };
}
