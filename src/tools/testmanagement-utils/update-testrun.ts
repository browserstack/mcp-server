import { apiClient } from "../../lib/apiClient.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Selection of test cases (with optional configurations) to add.
 */
const TestCaseSelectionSchema = z.object({
  test_case_ids: z.array(z.string()).describe("Test case IDs, e.g. TC-123"),
  configuration_ids: z
    .array(z.number())
    .optional()
    .describe("Configuration IDs to apply"),
});

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
    add_test_cases: z
      .array(TestCaseSelectionSchema)
      .optional()
      .describe("Test cases to add to the run"),
    preserve_existing_results: z
      .boolean()
      .optional()
      .describe("Keep existing results when adding cases (default true)"),
  }),
});

type UpdateTestRunArgs = z.infer<typeof UpdateTestRunSchema>;

/**
 * Partially updates an existing test run.
 *
 * Dispatches to one of two BrowserStack endpoints based on the fields provided,
 * mirroring how the platform splits these concerns across two endpoints:
 *  - metadata (name / run_state) -> PATCH .../test-runs/{id}/update
 *  - adding test cases -> PATCH .../test-runs/{id}/test-cases
 *
 * Either or both may be supplied in one call; each provided concern hits its
 * own endpoint and both outcomes are reported. At least one must be provided.
 * Removing test cases is intentionally not exposed — this tool is
 * non-destructive.
 */
export async function updateTestRun(
  args: UpdateTestRunArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { name, run_state, add_test_cases } = args.test_run;

  const hasTestCases = (add_test_cases?.length ?? 0) > 0;
  const hasMetadata = name !== undefined || run_state !== undefined;

  if (!hasTestCases && !hasMetadata) {
    return {
      content: [
        {
          type: "text",
          text: "Nothing to update: provide name/run_state and/or add_test_cases.",
        },
      ],
      isError: true,
    };
  }

  const results: CallToolResult[] = [];
  if (hasMetadata) {
    results.push(await updateTestRunMetadata(args, config));
  }
  if (hasTestCases) {
    results.push(await updateTestRunTestCases(args, config));
  }

  if (results.length === 1) {
    return results[0];
  }

  // Both concerns updated: aggregate outcomes; surface an error if either failed.
  return {
    content: results.flatMap((r) => r.content),
    isError: results.some((r) => r.isError),
  };
}

/**
 * Updates test run metadata (name / run_state) via the /update endpoint.
 */
async function updateTestRunMetadata(
  args: UpdateTestRunArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const { name, run_state } = args.test_run;
    const body = { test_run: { name, run_state } };
    const tmBaseUrl = await getTMBaseURL(config);
    const url = `${tmBaseUrl}/api/v2/projects/${encodeURIComponent(
      args.project_identifier,
    )}/test-runs/${encodeURIComponent(args.test_run_id)}/update`;

    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");

    const resp = await apiClient.patch({
      url,
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body,
    });

    const data = resp.data;
    if (!data.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to update test run: ${JSON.stringify(data)}`,
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

/**
 * Adds test cases to a run via the /test-cases endpoint.
 * This call is applied asynchronously by the backend.
 */
async function updateTestRunTestCases(
  args: UpdateTestRunArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const { add_test_cases, preserve_existing_results } = args.test_run;

    const body = {
      test_run: {
        add_test_cases,
        preserve_existing_results: preserve_existing_results ?? true,
      },
    };

    const tmBaseUrl = await getTMBaseURL(config);
    const url = `${tmBaseUrl}/api/v2/projects/${encodeURIComponent(
      args.project_identifier,
    )}/test-runs/${encodeURIComponent(args.test_run_id)}/test-cases`;

    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");

    const resp = await apiClient.patch({
      url,
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body,
    });

    const data = resp.data;
    if (!data.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to update test run test cases: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    const added = add_test_cases?.flatMap((s) => s.test_case_ids) ?? [];

    return {
      content: [
        {
          type: "text",
          text: `Queued test-case update for ${args.test_run_id} (added ${added.length}); changes apply asynchronously.`,
        },
        { type: "text", text: JSON.stringify(data, null, 2) },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to update test run test cases");
  }
}
