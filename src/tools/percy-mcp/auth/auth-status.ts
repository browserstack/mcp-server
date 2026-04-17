import { getPercyApiBaseUrl, maskToken } from "../../../lib/percy-api/auth.js";
import { PercyClient } from "../../../lib/percy-api/client.js";
import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyAuthStatus(
  _args: Record<string, never>,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const baseUrl = getPercyApiBaseUrl();
  let output = `## Percy Auth Status\n\n`;
  output += `**API URL:** ${baseUrl}\n\n`;

  const percyToken = process.env.PERCY_TOKEN;
  const orgToken = process.env.PERCY_ORG_TOKEN;
  const hasBstackCreds = !!(
    config["browserstack-username"] && config["browserstack-access-key"]
  );

  // Token table
  output += `### Token Configuration\n\n`;
  output += `| Token | Status | Value |\n`;
  output += `|-------|--------|-------|\n`;
  output += `| PERCY_TOKEN | ${percyToken ? "Set" : "Not set"} | ${percyToken ? maskToken(percyToken) : "—"} |\n`;
  output += `| PERCY_ORG_TOKEN | ${orgToken ? "Set" : "Not set"} | ${orgToken ? maskToken(orgToken) : "—"} |\n`;
  output += `| BrowserStack Credentials | ${hasBstackCreds ? "Set" : "Not set"} | ${hasBstackCreds ? config["browserstack-username"] : "—"} |\n`;
  output += "\n";

  // Detect token type from prefix
  if (percyToken) {
    const hasPrefix = percyToken.includes("_");
    const prefix = hasPrefix ? percyToken.split("_")[0] : null;
    const tokenTypes: Record<string, string> = {
      web: "Web project (full access — can read and write)",
      auto: "Automate project (full access)",
      app: "App project (full access)",
      ss: "Generic/BYOS project",
      vmw: "Visual Monitoring project",
    };
    if (prefix && tokenTypes[prefix]) {
      output += `**Token type:** ${prefix} — ${tokenTypes[prefix]}\n\n`;
    } else if (!hasPrefix) {
      output += `**Token type:** CI/write-only — can create builds but may not read them\n`;
      output += `  Tip: Use \`percy_create_project\` to get a full-access \`web_*\` token\n\n`;
    } else {
      output += `**Token type:** ${prefix} — custom\n\n`;
    }
  }

  // Validation
  output += `### Validation\n\n`;

  // 1. Try Percy API with token
  if (percyToken) {
    try {
      const client = new PercyClient(config, { scope: "project" });
      const builds = await client.get<any>("/builds", {
        "page[limit]": "1",
      });
      const buildList = Array.isArray(builds) ? builds : [];

      if (buildList.length > 0) {
        const proj =
          buildList[0]?.project?.name ||
          buildList[0]?.project?.slug ||
          "unknown";
        output += `**Percy API (read):** ✓ Valid — project "${proj}"\n`;
        output += `**Latest build:** #${buildList[0]?.buildNumber || buildList[0]?.id} (${buildList[0]?.state || "unknown"})\n`;
      } else {
        output += `**Percy API (read):** ✓ Valid — no builds yet\n`;
      }
    } catch {
      // Read failed — token might be write-only (CI token)
      output += `**Percy API (read):** ✗ No read access (this is normal for CI/write-only tokens)\n`;
    }
  }

  // 2. Try BrowserStack API (project creation / token fetch)
  if (hasBstackCreds) {
    try {
      const authString = getBrowserStackAuth(config);
      const auth = Buffer.from(authString).toString("base64");
      const response = await fetch(
        "https://api.browserstack.com/api/app_percy/get_project_token?name=__mcp_auth_check__",
        {
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (response.ok) {
        output += `**BrowserStack API:** ✓ Valid — can create projects and get tokens\n`;
      } else {
        output += `**BrowserStack API:** ✗ Failed (${response.status})\n`;
      }
    } catch (e: any) {
      output += `**BrowserStack API:** ✗ Error — ${e.message}\n`;
    }
  }

  // 3. Org token check
  if (orgToken) {
    try {
      const client = new PercyClient(config, { scope: "org" });
      await client.get<any>("/projects", { "page[limit]": "1" });
      output += `**Org scope:** ✓ Valid\n`;
    } catch (e: any) {
      output += `**Org scope:** ✗ Failed — ${e.message}\n`;
    }
  }

  output += "\n";

  // Capabilities summary
  output += `### What You Can Do\n\n`;

  if (hasBstackCreds) {
    output += `✓ **Create projects** — \`percy_create_project\`\n`;
    output += `✓ **Create builds with snapshots** — \`percy_create_percy_build\`\n`;
  }

  if (percyToken) {
    const hasPrefix = percyToken.includes("_");
    const prefix = hasPrefix ? percyToken.split("_")[0] : null;
    if (prefix === "web" || prefix === "auto" || prefix === "app") {
      output += `✓ **Read builds, snapshots, comparisons** — all read tools\n`;
      output += `✓ **Approve/reject builds** — \`percy_approve_build\`\n`;
      output += `✓ **AI analysis, RCA, summaries** — all intelligence tools\n`;
      output += `✓ **PR visual report** — \`percy_pr_visual_report\`\n`;
    } else {
      output += `⚠ **Limited read access** — this token can create builds but may not read them\n`;
      output += `  Tip: Run \`percy_create_project\` to get a full-access \`web_*\` token\n`;
    }
  } else if (hasBstackCreds) {
    output += `⚠ **No PERCY_TOKEN set** — read operations will use BrowserStack fallback\n`;
    output += `  Tip: Run \`percy_create_project\` to get a project token\n`;
  }

  if (!percyToken && !orgToken && !hasBstackCreds) {
    output += `### Setup Required\n\n`;
    output += `No credentials configured. Run:\n`;
    output += `\`\`\`bash\ncd mcp-server && ./percy-config/setup.sh\n\`\`\`\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
