/**
 * percy_create_build — Create a new Percy build for visual testing.
 *
 * POST /projects/{project_id}/builds with JSON:API body.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface CreateBuildArgs {
  project_id: string;
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
  const { project_id, branch, commit_sha, commit_message, pull_request_number, type } = args;

  const body = {
    data: {
      type: "builds",
      attributes: {
        branch,
        "commit-sha": commit_sha,
        ...(commit_message ? { "commit-message": commit_message } : {}),
        ...(pull_request_number ? { "pull-request-number": pull_request_number } : {}),
        ...(type ? { type } : {}),
      },
      relationships: {},
    },
  };

  try {
    const client = new PercyClient(config);
    const result = (await client.post(
      `/projects/${project_id}/builds`,
      body,
    )) as { data: Record<string, unknown> | null };

    const buildId = result?.data?.id ?? "unknown";

    return {
      content: [
        {
          type: "text",
          text: `Build #${buildId} created. Finalize URL: /builds/${buildId}/finalize`,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create build for project ${project_id}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
