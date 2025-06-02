import axios from "axios";
import config from "../../config.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";

/**
 * Schema for updating a test run with partial fields.
 */
export const UpdateTestRunSchema = z.object({
  project_identifier: z
    .string()
    .describe("Identifier of the project (Starts with 'PR-')"),
  test_run_id: z.string().describe("Test run identifier (e.g., TR-678)"),
  test_run: z.object({
    name: z.string().optional().describe("New name of the test run"),
    run_state: z
      .enum([
        "new_run",
        "in_progress",
        "under_review",
        "rejected",
        "done",
        "closed",
      ])
      .optional()
      .describe("Updated state of the test run"),
  }),
});

type UpdateTestRunArgs = z.infer<typeof UpdateTestRunSchema>;

/**
 * Partially updates an existing test run.
 */
export async function updateTestRun(
  args: UpdateTestRunArgs,
): Promise<CallToolResult> {
  try {
    const body = { test_run: args.test_run };
    const url = `https://test-management.browserstack.com/api/v2/projects/${encodeURIComponent(
      args.project_identifier,
    )}/test-runs/${encodeURIComponent(args.test_run_id)}/update`;

    const resp = await axios.patch(url, body, {
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
            text: `Failed to update test run: ${JSON.stringify(data)}`,
            isError: true,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Successfully updated test run ${args.test_run_id}`,
        },
        { type: "text", text: JSON.stringify(data.testrun || data, null, 2) },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to update test run");
  }
}
