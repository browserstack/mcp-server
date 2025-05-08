import axios from "axios";
import config from "../../config";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error";

/**
 * Schema for creating a test run.
 */
export const CreateTestRunSchema = z.object({
  project_identifier: z
    .string()
    .describe("Identifier of the project in which to create the test run."),
  test_run: z.object({
    name: z.string().describe("Name of the test run"),
    description: z
      .string()
      .optional()
      .describe("Brief information about the test run"),
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
      .describe(
        "State of the test run. One of new_run, in_progress, under_review, rejected, done, closed",
      ),
    issues: z.array(z.string()).optional().describe("Linked issue IDs"),
    issue_tracker: z
      .object({ name: z.string(), host: z.string().url() })
      .optional()
      .describe("Issue tracker configuration"),
    test_cases: z
      .array(z.string())
      .optional()
      .describe("List of test case IDs"),
    folder_ids: z
      .array(z.number())
      .optional()
      .describe("Folder IDs to include"),
  }),
});

export type CreateTestRunArgs = z.infer<typeof CreateTestRunSchema>;

/**
 * Creates a test run via BrowserStack Test Management API.
 */
export async function createTestRun(
  rawArgs: CreateTestRunArgs,
): Promise<CallToolResult> {
  try {
    const inputArgs = {
      ...rawArgs,
      test_run: {
        ...rawArgs.test_run,
        include_all: false,
      },
    };
    const args = CreateTestRunSchema.parse(inputArgs);

    const url = `https://test-management.browserstack.com/api/v2/projects/${encodeURIComponent(
      args.project_identifier,
    )}/test-runs`;

    const response = await axios.post(
      url,
      { test_run: args.test_run },
      {
        auth: {
          username: config.browserstackUsername,
          password: config.browserstackAccessKey,
        },
        headers: { "Content-Type": "application/json" },
      },
    );

    const data = response.data;
    if (!data.success) {
      throw new Error(
        `API returned unsuccessful response: ${JSON.stringify(data)}`,
      );
    }

    // Assume data.test_run contains created run info
    const created = data.test_run || data;
    const runId = created.identifier || created.id || created.name;

    const summary = `Successfully created test run ${runId}`;
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: JSON.stringify(created, null, 2) },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to create test run");
  }
}
