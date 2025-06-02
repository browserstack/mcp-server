import axios from "axios";
import config from "../../config.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";

/**
 * Schema for listing test runs with optional filters.
 */
export const ListTestRunsSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "Identifier of the project to fetch test runs from (usually starts with PR-).",
    ),
  run_state: z
    .string()
    .optional()
    .describe("Return all test runs with this state (comma-separated)"),
});

type ListTestRunsArgs = z.infer<typeof ListTestRunsSchema>;

/**
 * Fetches and formats the list of test runs for a project.
 */
export async function listTestRuns(
  args: ListTestRunsArgs,
): Promise<CallToolResult> {
  try {
    const params = new URLSearchParams();
    if (args.run_state) {
      params.set("run_state", args.run_state);
    }

    const url =
      `https://test-management.browserstack.com/api/v2/projects/${encodeURIComponent(
        args.project_identifier,
      )}/test-runs?` + params.toString();

    const resp = await axios.get(url, {
      auth: {
        username: config.browserstackUsername,
        password: config.browserstackAccessKey,
      },
    });

    const data = resp.data;
    if (!data.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to list test runs: ${JSON.stringify(data)}`,
            isError: true,
          },
        ],
        isError: true,
      };
    }

    const runs = data.test_runs;
    const count = runs.length;
    const summary = runs
      .map((tr: any) => `• ${tr.identifier}: ${tr.name} [${tr.run_state}]`)
      .join("\n");

    return {
      content: [
        { type: "text", text: `Found ${count} test run(s):\n\n${summary}` },
        { type: "text", text: JSON.stringify(runs, null, 2) },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to list test runs");
  }
}
