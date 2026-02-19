import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Schema for getting a specific test case by ID.
 */
export const GetTestCaseSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "Identifier of the project to fetch the test case from. This id starts with a PR- and is followed by a number.",
    ),
  test_case_id: z
    .string()
    .describe(
      "Identifier of the test case to fetch (e.g., TC-16667 or 2). Multiple IDs can be provided separated by commas.",
    ),
});

export type GetTestCaseArgs = z.infer<typeof GetTestCaseSchema>;

/**
 * Calls BrowserStack Test Management to get a specific test case by ID.
 */
export async function getTestCase(
  args: GetTestCaseArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const tmBaseUrl = await getTMBaseURL(config);
    const url = `${tmBaseUrl}/api/v2/projects/${encodeURIComponent(
      args.project_identifier,
    )}/test-cases?id=${encodeURIComponent(args.test_case_id)}`;

    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");
    const resp = await apiClient.get({
      url,
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
      },
    });

    const resp_data = resp.data;
    if (!resp_data.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get test case: ${JSON.stringify(resp_data)}`,
          },
        ],
        isError: true,
      };
    }

    const { test_cases } = resp_data;

    if (!test_cases || test_cases.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No test case found with ID: ${args.test_case_id}`,
          },
        ],
        isError: true,
      };
    }

    const tc = test_cases[0];

    // Format steps if present
    let stepsText = "";
    if (tc.steps && tc.steps.length > 0) {
      stepsText = tc.steps
        .map(
          (step: any, index: number) =>
            `${index + 1}. ${step.step}\n   Result: ${step.result}`,
        )
        .join("\n\n");
    }

    const summary = `Test Case: ${tc.identifier}
Title: ${tc.title}
Type: ${tc.case_type}
Priority: ${tc.priority}
Status: ${tc.status}
Automation: ${tc.automation_status}
Owner: ${tc.owner || "Unassigned"}

Description:
${tc.description || "N/A"}

Preconditions:
${tc.preconditions || "N/A"}

Steps:${stepsText ? "\n" + stepsText : " None"}

URL: https://test-management.browserstack.com/projects/${args.project_identifier}/folders/${tc.folder_id}/test-cases/${tc.identifier}`;

    return {
      content: [
        {
          type: "text",
          text: summary,
        },
        {
          type: "text",
          text: JSON.stringify(tc, null, 2),
        },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to get test case");
  }
}
