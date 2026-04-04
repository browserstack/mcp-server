/**
 * percy_create_build — Create a new Percy build for visual testing.
 *
 * Supports two modes:
 * 1. With project_id: POST /projects/{project_id}/builds
 * 2. Without project_id: POST /builds (uses PERCY_TOKEN project scope)
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface CreateBuildArgs {
  project_id?: string;
  branch: string;
  commit_sha: string;
  commit_message?: string;
  pull_request_number?: string;
  type?: string;
}

export async function percyCreateBuild(
  args: CreateBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const {
    project_id,
    branch,
    commit_sha,
    commit_message,
    pull_request_number,
    type,
  } = args;

  const body = {
    data: {
      type: "builds",
      attributes: {
        branch,
        "commit-sha": commit_sha,
        ...(commit_message ? { "commit-message": commit_message } : {}),
        ...(pull_request_number
          ? { "pull-request-number": pull_request_number }
          : {}),
        ...(type ? { type } : {}),
      },
      relationships: {
        resources: {
          data: [],
        },
      },
    },
  };

  try {
    const client = new PercyClient(config);

    // Use project-scoped endpoint if project_id given, otherwise token-scoped
    const endpoint = project_id ? `/projects/${project_id}/builds` : "/builds";

    const result = await client.post<any>(endpoint, body);

    // Handle both raw JSON:API response and deserialized response
    const buildData = result?.data || result;
    const buildId =
      buildData?.id ?? (typeof buildData === "object" ? "created" : "unknown");
    const buildNumber =
      buildData?.buildNumber || buildData?.["build-number"] || "";
    const webUrl = buildData?.webUrl || buildData?.["web-url"] || "";

    let output = `## Percy Build Created\n\n`;
    output += `| Field | Value |\n`;
    output += `|-------|-------|\n`;
    output += `| **Build ID** | ${buildId} |\n`;
    if (buildNumber) output += `| **Build Number** | ${buildNumber} |\n`;
    output += `| **Branch** | ${branch} |\n`;
    output += `| **Commit** | ${commit_sha} |\n`;
    if (webUrl) output += `| **URL** | ${webUrl} |\n`;
    output += `\n### Next Steps\n\n`;
    output += `1. Create snapshots: \`percy_create_snapshot\` with build_id \`${buildId}\`\n`;
    output += `2. Upload resources: \`percy_upload_resource\` for each missing resource\n`;
    output += `3. Finalize: \`percy_finalize_build\` with build_id \`${buildId}\`\n`;

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create build: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
