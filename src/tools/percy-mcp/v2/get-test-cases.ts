import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetTestCases(
  args: { project_id: string; build_id?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Get test cases
  const params: Record<string, string> = { project_id: args.project_id };
  const response = await percyGet("/test-cases", config, params);
  const testCases = response?.data || [];

  if (!testCases.length) {
    return { content: [{ type: "text", text: "No test cases found for this project." }] };
  }

  let output = `## Test Cases (${testCases.length})\n\n`;
  output += `| # | Name | ID |\n|---|---|---|\n`;
  testCases.forEach((tc: any, i: number) => {
    const name = tc.attributes?.name || tc.name || "?";
    output += `| ${i + 1} | ${name} | ${tc.id} |\n`;
  });

  // If build_id provided, get executions
  if (args.build_id) {
    const execResponse = await percyGet("/test-case-executions", config, { build_id: args.build_id });
    const executions = execResponse?.data || [];
    if (executions.length) {
      output += `\n### Executions for Build ${args.build_id}\n\n`;
      output += `| Test Case | Total | Failed | Unreviewed | State |\n|---|---|---|---|---|\n`;
      executions.forEach((exec: any) => {
        const attrs = exec.attributes || {};
        output += `| ${attrs["test-case-name"] || exec.id} | ${attrs["total-snapshots"] ?? "?"} | ${attrs["failed-snapshots"] ?? "?"} | ${attrs["unreviewed-snapshots"] ?? "?"} | ${attrs["review-state"] ?? "?"} |\n`;
      });
    }
  }

  return { content: [{ type: "text", text: output }] };
}
