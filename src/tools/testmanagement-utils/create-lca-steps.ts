import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { apiClient } from "../../lib/apiClient.js";
import {
  projectIdentifierToId,
  testCaseIdentifierToDetails,
} from "./TCG-utils/api.js";
import { pollLCAStatus } from "./poll-lca-status.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Schema for creating LCA steps for a test case
 */
export const CreateLCAStepsSchema = z.object({
  project_identifier: z
    .string()
    .describe("ID of the project (Starts with 'PR-')"),
  test_case_identifier: z
    .string()
    .describe("Identifier of the test case (e.g., 'TC-12345')"),
  base_url: z.string().describe("Base URL for the test (e.g., 'google.com')"),
  credentials: z
    .object({
      username: z.string().describe("Username for authentication"),
      password: z.string().describe("Password for authentication"),
    })
    .optional()
    .describe(
      "Optional credentials for authentication. Extract from the test case details if provided in it. This is required for the test cases which require authentication.",
    ),
  local_enabled: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether local testing is enabled"),
  test_name: z.string().describe("Name of the test"),
  test_case_details: z
    .object({
      name: z.string().describe("Name of the test case"),
      description: z.string().describe("Description of the test case"),
      preconditions: z.string().describe("Preconditions for the test case"),
      test_case_steps: z
        .array(
          z.object({
            step: z.string().describe("Test step description"),
            result: z.string().describe("Expected result"),
          }),
        )
        .describe("Array of test case steps with expected results"),
    })
    .describe("Test case details including steps"),
  wait_for_completion: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to wait for LCA build completion (default: true)"),
});

export type CreateLCAStepsArgs = z.infer<typeof CreateLCAStepsSchema>;

/**
 * Creates LCA (Low Code Automation) steps for a test case in BrowserStack Test Management
 */
export async function createLCASteps(
  args: CreateLCAStepsArgs,
  context: any,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    // Get the project ID from identifier
    const projectId = await projectIdentifierToId(
      args.project_identifier,
      config,
    );

    // Get the test case ID and folder ID from identifier
    const { testCaseId, folderId } = await testCaseIdentifierToDetails(
      projectId,
      args.test_case_identifier,
      config,
    );

    const tmBaseUrl = await getTMBaseURL(config);
    const url = `${tmBaseUrl}/api/v1/projects/${projectId}/test-cases/${testCaseId}/lcnc`;

    const payload = {
      base_url: args.base_url,
      credentials: args.credentials,
      local_enabled: args.local_enabled,
      test_name: args.test_name,
      test_case_details: args.test_case_details,
      version: "v2",
      webhook_path: `${tmBaseUrl}/api/v1/projects/${projectId}/test-cases/${testCaseId}/webhooks/lcnc`,
    };

    await apiClient.post({
      url,
      headers: {
        "API-TOKEN": getBrowserStackAuth(config),
        accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      body: payload,
    });

    // Check if user wants to wait for completion
    if (!args.wait_for_completion) {
      return {
        content: [
          {
            type: "text",
            text: `LCA steps creation initiated for test case ${args.test_case_identifier} (ID: ${testCaseId})`,
          },
          {
            type: "text",
            text: "LCA build started. Check the BrowserStack Lowcode Automation UI for completion status.",
          },
        ],
      };
    }

    // Start polling for LCA build completion
    try {
      const max_wait_minutes = 10; // Maximum wait time in minutes
      const maxWaitMs = max_wait_minutes * 60 * 1000;
      const lcaResult = await pollLCAStatus(
        projectId,
        folderId,
        testCaseId,
        context,
        maxWaitMs, // max wait time
        2 * 60 * 1000, // 2 minutes initial wait
        10 * 1000, // 10 seconds interval
        config,
      );

      if (lcaResult && lcaResult.status === "done") {
        return {
          content: [
            {
              type: "text",
              text: `Successfully created LCA steps for test case ${args.test_case_identifier} (ID: ${testCaseId})`,
            },
            {
              type: "text",
              text: `LCA build completed! Resource URL: ${lcaResult.resource_path}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `LCA steps creation initiated for test case ${args.test_case_identifier} (ID: ${testCaseId})`,
            },
            {
              type: "text",
              text: `Warning: LCA build did not complete within ${max_wait_minutes} minutes. You can check the status later in the BrowserStack Test Management UI.`,
            },
          ],
        };
      }
    } catch (pollError) {
      console.error("Error during LCA polling:", pollError);
      return {
        content: [
          {
            type: "text",
            text: `LCA steps creation initiated for test case ${args.test_case_identifier} (ID: ${testCaseId})`,
          },
          {
            type: "text",
            text: "Warning: Error occurred while polling for LCA build completion. Check the BrowserStack Test Management UI for status.",
          },
        ],
      };
    }
  } catch (error: any) {
    // Add more specific error handling
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}. Please verify that the project identifier "${args.project_identifier}" and test case identifier "${args.test_case_identifier}" are correct.`,
            },
          ],
          isError: true,
        };
      }
    }
    const msg =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create LCA steps: ${msg}`,
        },
      ],
      isError: true,
    };
  }
}
