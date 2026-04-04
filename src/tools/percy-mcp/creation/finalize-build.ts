/**
 * percy_finalize_build — Finalize a Percy build after all snapshots are complete.
 *
 * POST /builds/{build_id}/finalize — triggers processing.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface FinalizeBuildArgs {
  build_id: string;
}

export async function percyFinalizeBuild(
  args: FinalizeBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { build_id } = args;

  try {
    const client = new PercyClient(config);
    await client.post(`/builds/${build_id}/finalize`);

    return {
      content: [
        {
          type: "text",
          text: `Build ${build_id} finalized. Processing will begin.`,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to finalize build ${build_id}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
