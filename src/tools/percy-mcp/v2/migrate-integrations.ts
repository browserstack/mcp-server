import { percyPost } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyMigrateIntegrations(
  args: { source_org_id: string; target_org_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  await percyPost("/integration-migrations/migrate", config, {
    data: {
      type: "integration-migrations",
      attributes: {
        "source-organization-id": args.source_org_id,
        "target-organization-id": args.target_org_id,
      },
    },
  });

  return {
    content: [
      {
        type: "text",
        text: `## Integration Migration\n\nIntegrations migrated from org ${args.source_org_id} to ${args.target_org_id}.`,
      },
    ],
  };
}
