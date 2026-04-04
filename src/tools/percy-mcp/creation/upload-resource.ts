/**
 * percy_upload_resource — Upload a resource to a Percy build.
 *
 * POST /builds/{build_id}/resources with JSON:API body.
 * Percy API validates SHA matches content server-side.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface UploadResourceArgs {
  build_id: string;
  sha: string;
  base64_content: string;
}

export async function percyUploadResource(
  args: UploadResourceArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { build_id, sha, base64_content } = args;

  const body = {
    data: {
      type: "resources",
      id: sha,
      attributes: {
        "base64-content": base64_content,
      },
    },
  };

  try {
    const client = new PercyClient(config);
    await client.post(`/builds/${build_id}/resources`, body);

    return {
      content: [
        {
          type: "text",
          text: `Resource ${sha} uploaded successfully.`,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to upload resource ${sha} to build ${build_id}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
