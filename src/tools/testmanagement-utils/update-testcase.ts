import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { projectIdentifierToId } from "./TCG-utils/api.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import logger from "../../logger.js";

export interface TestCaseUpdateRequest {
  project_identifier: string;
  test_case_identifier: string;
  name?: string;
  description?: string;
  preconditions?: string;
  test_case_steps?: Array<{
    step: string;
    result: string;
  }>;
}

export const UpdateTestCaseSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "The ID of the BrowserStack project containing the test case to update.",
    ),
  test_case_identifier: z
    .string()
    .describe(
      "The ID of the test case to update. This can be found using the listTestCases tool.",
    ),
  name: z.string().optional().describe("Updated name of the test case."),
  description: z
    .string()
    .optional()
    .describe("Updated brief description of the test case."),
  preconditions: z
    .string()
    .optional()
    .describe("Updated preconditions for the test case."),
  test_case_steps: z
    .array(
      z.object({
        step: z.string().describe("The action to perform in this step."),
        result: z.string().describe("The expected result of this step."),
      }),
    )
    .optional()
    .describe("Updated list of test case steps with expected results."),
});

/**
 * Updates an existing test case in BrowserStack Test Management.
 */
export async function updateTestCase(
  params: TestCaseUpdateRequest,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");

  // Build the request body with only the fields to update
  const testCaseBody: any = {};

  if (params.name !== undefined) {
    testCaseBody.name = params.name;
  }

  if (params.description !== undefined) {
    testCaseBody.description = params.description;
  }

  if (params.preconditions !== undefined) {
    testCaseBody.preconditions = params.preconditions;
  }

  if (params.test_case_steps !== undefined) {
    testCaseBody.steps = params.test_case_steps;
  }

  const body = { test_case: testCaseBody };

  try {
    const tmBaseUrl = await getTMBaseURL(config);
    const response = await apiClient.patch({
      url: `${tmBaseUrl}/api/v2/projects/${encodeURIComponent(
        params.project_identifier,
      )}/test-cases/${encodeURIComponent(params.test_case_identifier)}`,
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
      },
      body,
    });

    const { data } = response.data;
    if (!data.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to update test case: ${JSON.stringify(
              response.data,
            )}`,
          },
        ],
        isError: true,
      };
    }

    const tc = data.test_case;

    // Convert project identifier to project ID for dashboard URL
    const projectId = await projectIdentifierToId(
      params.project_identifier,
      config,
    );

    return {
      content: [
        {
          type: "text",
          text: `Test case successfully updated:
          
**Test Case Details:**
- **ID**: ${tc.identifier}
- **Name**: ${tc.title}
- **Description**: ${tc.description || "N/A"}
- **Case Type**: ${tc.case_type}
- **Priority**: ${tc.priority}
- **Status**: ${tc.status}

**View on BrowserStack Dashboard:**
https://test-management.browserstack.com/projects/${projectId}/folders/${tc.folder_id}/test-cases/${tc.identifier}

The test case has been updated successfully and is now available in your BrowserStack Test Management project.`,
        },
      ],
    };
  } catch (err: any) {
    logger.error("Failed to update test case: %s", err);
    logger.error(
      "Error details:",
      JSON.stringify(err.response?.data || err.message),
    );

    if (err.response?.status === 404) {
      return {
        content: [
          {
            type: "text",
            text: `Test case not found. Please verify the project_identifier ("${params.project_identifier}") and test_case_identifier ("${params.test_case_identifier}") are correct. Make sure to use actual values, not placeholders like "your_project_id".

Error details: ${JSON.stringify(err.response?.data || err.message)}`,
          },
        ],
        isError: true,
      };
    }

    if (err.response?.status === 403) {
      return {
        content: [
          {
            type: "text",
            text: "Access denied. You don't have permission to update this test case.",
          },
        ],
        isError: true,
      };
    }

    const errorMessage = formatAxiosError(err, "Failed to update test case");
    return {
      content: [
        {
          type: "text",
          text: `Failed to update test case: ${errorMessage}. Please verify your credentials and try again.`,
        },
      ],
      isError: true,
    };
  }
}
