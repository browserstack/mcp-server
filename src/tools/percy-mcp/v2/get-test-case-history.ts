import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetTestCaseHistory(
  args: { test_case_id: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet("/test-case-histories", config, {
    test_case_id: args.test_case_id,
  });
  const history = response?.data || [];

  if (!history.length) {
    return {
      content: [{ type: "text", text: "No history found for this test case." }],
    };
  }

  let output = `## Test Case History\n\n`;
  output += `| # | Build | State | Total | Failed | Unreviewed |\n|---|---|---|---|---|---|\n`;
  history.forEach((entry: any, i: number) => {
    const attrs = entry.attributes || {};
    const buildId = entry.relationships?.build?.data?.id || "?";
    output += `| ${i + 1} | #${buildId} | ${attrs["review-state"] ?? "?"} | ${attrs["total-snapshots"] ?? "?"} | ${attrs["failed-snapshots"] ?? "?"} | ${attrs["unreviewed-snapshots"] ?? "?"} |\n`;
  });

  return { content: [{ type: "text", text: output }] };
}
