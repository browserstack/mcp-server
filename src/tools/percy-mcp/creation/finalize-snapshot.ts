/**
 * percy_finalize_snapshot — Finalize a Percy snapshot after all resources are uploaded.
 *
 * POST /snapshots/{snapshot_id}/finalize — triggers rendering.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface FinalizeSnapshotArgs {
  snapshot_id: string;
}

export async function percyFinalizeSnapshot(
  args: FinalizeSnapshotArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { snapshot_id } = args;

  try {
    const client = new PercyClient(config);
    await client.post(`/snapshots/${snapshot_id}/finalize`);

    return {
      content: [
        {
          type: "text",
          text: `Snapshot ${snapshot_id} finalized. Rendering will begin.`,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to finalize snapshot ${snapshot_id}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
