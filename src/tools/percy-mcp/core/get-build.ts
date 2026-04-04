/**
 * percy_get_build — Get detailed Percy build information.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { formatBuild } from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetBuildArgs {
  build_id: string;
}

export async function percyGetBuild(
  args: GetBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "project" });

  const response = await client.get<{
    data: Record<string, unknown> | null;
  }>(
    `/builds/${args.build_id}`,
    { "include-metadata": "true" },
    ["build-summary", "browsers"],
  );

  const build = response.data;

  return {
    content: [{ type: "text", text: formatBuild(build) }],
  };
}
