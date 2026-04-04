import { resolvePercyToken, getPercyApiBaseUrl, maskToken } from "../../../lib/percy-api/auth.js";
import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyAuthStatus(
  _args: Record<string, never>,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const baseUrl = getPercyApiBaseUrl();
  let output = `## Percy Auth Status\n\n`;
  output += `**API URL:** ${baseUrl}\n\n`;

  // Check PERCY_TOKEN
  const percyToken = process.env.PERCY_TOKEN;
  const orgToken = process.env.PERCY_ORG_TOKEN;
  const hasBstackCreds = !!(config["browserstack-username"] && config["browserstack-access-key"]);

  output += `### Token Configuration\n\n`;
  output += `| Token | Status | Value |\n`;
  output += `|-------|--------|-------|\n`;
  output += `| PERCY_TOKEN | ${percyToken ? "Set" : "Not set"} | ${percyToken ? maskToken(percyToken) : "—"} |\n`;
  output += `| PERCY_ORG_TOKEN | ${orgToken ? "Set" : "Not set"} | ${orgToken ? maskToken(orgToken) : "—"} |\n`;
  output += `| BrowserStack Credentials | ${hasBstackCreds ? "Set" : "Not set"} | ${hasBstackCreds ? "username + access key" : "—"} |\n`;
  output += "\n";

  // Validate project token by making a lightweight API call
  if (percyToken || hasBstackCreds) {
    output += `### Validation\n\n`;
    try {
      const client = new PercyClient(config, { scope: "project" });
      const builds = await client.get<any>("/builds", { "page[limit]": "1" });
      const buildList = Array.isArray(builds) ? builds : [];

      if (buildList.length > 0) {
        const projectName = buildList[0]?.project?.name || buildList[0]?.project?.slug || "unknown";
        output += `**Project scope:** Valid — project "${projectName}"\n`;
        output += `**Latest build:** #${buildList[0]?.buildNumber || buildList[0]?.id} (${buildList[0]?.state || "unknown"})\n`;
      } else {
        output += `**Project scope:** Valid — no builds found (new project or empty)\n`;
      }
    } catch (e: any) {
      output += `**Project scope:** Failed — ${e.message}\n`;
    }
  }

  if (orgToken) {
    try {
      const client = new PercyClient(config, { scope: "org" });
      // Try listing projects with org token
      const projects = await client.get<any>("/projects", { "page[limit]": "1" });
      output += `**Org scope:** Valid\n`;
    } catch (e: any) {
      output += `**Org scope:** Failed — ${e.message}\n`;
    }
  }

  if (!percyToken && !orgToken && !hasBstackCreds) {
    output += `### Setup Required\n\n`;
    output += `No Percy tokens configured. Set one or more:\n`;
    output += `- \`PERCY_TOKEN\` — for project-scoped operations (builds, snapshots, comparisons)\n`;
    output += `- \`PERCY_ORG_TOKEN\` — for organization-scoped operations (list projects)\n`;
    output += `- BrowserStack credentials — as fallback for token retrieval\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
