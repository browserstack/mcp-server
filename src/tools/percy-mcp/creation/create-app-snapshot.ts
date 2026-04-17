/**
 * percy_create_app_snapshot — Create a snapshot for App Percy or BYOS builds.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface CreateAppSnapshotArgs {
  build_id: string;
  name: string;
  test_case?: string;
}

export async function percyCreateAppSnapshot(
  args: CreateAppSnapshotArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "auto" });

  const attributes: Record<string, string> = {
    name: args.name,
  };

  if (args.test_case) {
    attributes["test-case"] = args.test_case;
  }

  const body = {
    data: {
      type: "snapshots",
      attributes,
    },
  };

  const response = await client.post<{
    data: Record<string, unknown> | null;
  }>(`/builds/${args.build_id}/snapshots`, body);

  const id = response.data?.id ?? "unknown";

  return {
    content: [
      {
        type: "text",
        text: `App snapshot '${args.name}' created (ID: ${id}). Create comparisons with percy_create_comparison.`,
      },
    ],
  };
}
