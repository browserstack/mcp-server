import { percyGet, getOrCreateProjectToken } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyAuthStatusV2(
  _args: Record<string, never>,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  let output = `## Percy Auth Status\n\n`;

  const hasCreds = !!(config["browserstack-username"] && config["browserstack-access-key"]);
  const percyToken = process.env.PERCY_TOKEN;

  output += `| Credential | Status |\n|---|---|\n`;
  output += `| BrowserStack Username | ${hasCreds ? config["browserstack-username"] : "Not set"} |\n`;
  output += `| BrowserStack Access Key | ${hasCreds ? "Set" : "Not set"} |\n`;
  output += `| PERCY_TOKEN | ${percyToken ? `Set (****${percyToken.slice(-4)})` : "Not set"} |\n`;
  output += "\n";

  // Test Basic Auth (this is what all read/write tools use)
  if (hasCreds) {
    output += `### Validation\n\n`;
    try {
      const response = await percyGet("/projects", config, { "page[limit]": "1" });
      const projects = response?.data || [];
      if (projects.length > 0) {
        output += `**Percy API (Basic Auth):** Connected — ${projects[0].attributes?.name || "project found"}\n`;
      } else {
        output += `**Percy API (Basic Auth):** Connected — no projects yet\n`;
      }
    } catch (e: any) {
      output += `**Percy API (Basic Auth):** Failed — ${e.message}\n`;
    }

    // Test BrowserStack project API
    try {
      await getOrCreateProjectToken("__auth_check__", config);
      output += `**BrowserStack API:** Can create projects\n`;
    } catch (e: any) {
      output += `**BrowserStack API:** Failed — ${e.message}\n`;
    }
  }

  output += "\n### Capabilities\n\n";
  if (hasCreds) {
    output += `- Create projects, builds, snapshots\n`;
    output += `- Read builds, snapshots, comparisons\n`;
    output += `- Approve/reject builds\n`;
    output += `- All Percy MCP tools\n`;
  } else {
    output += `No BrowserStack credentials. Run:\n`;
    output += `\`\`\`bash\ncd mcp-server && ./percy-config/setup.sh\n\`\`\`\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
