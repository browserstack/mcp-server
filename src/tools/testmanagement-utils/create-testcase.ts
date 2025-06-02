import axios from "axios";
import config from "../../config.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js"; // or correct
import { projectIdentifierToId } from "./TCG-utils/api.js";

interface TestCaseStep {
  step: string;
  result: string;
}

interface IssueTracker {
  name: string;
  host: string;
}

export interface TestCaseCreateRequest {
  project_identifier: string;
  folder_id: string;
  name: string;
  description?: string;
  owner?: string;
  preconditions?: string;
  test_case_steps: TestCaseStep[];
  issues?: string[];
  issue_tracker?: IssueTracker;
  tags?: string[];
  custom_fields?: Record<string, string>;
}

export interface TestCaseResponse {
  data: {
    success: boolean;
    test_case: {
      case_type: string;
      priority: string;
      status: string;
      folder_id: number;
      issues: Array<{
        jira_id: string;
        issue_type: string;
      }>;
      tags: string[];
      template: string;
      description: string;
      preconditions: string;
      title: string;
      identifier: string;
      automation_status: string;
      owner: string;
      steps: TestCaseStep[];
      custom_fields: Array<{
        name: string;
        value: string;
      }>;
    };
  };
}

export const CreateTestCaseSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "The ID of the BrowserStack project where the test case should be created. If no project identifier is provided, ask the user if they would like to create a new project using the createProjectOrFolder tool.",
    ),
  folder_id: z
    .string()
    .describe(
      "The ID of the folder within the project where the test case should be created. If not provided, ask the user if they would like to create a new folder using the createProjectOrFolder tool.",
    ),
  name: z.string().describe("Name of the test case."),
  description: z
    .string()
    .optional()
    .describe("Brief description of the test case."),
  owner: z
    .string()
    .email()
    .describe("Email of the test case owner.")
    .optional(),
  preconditions: z
    .string()
    .optional()
    .describe("Any preconditions (HTML allowed)."),
  test_case_steps: z
    .array(
      z.object({
        step: z.string().describe("Action to perform in this step."),
        result: z.string().describe("Expected result of this step."),
      }),
    )
    .describe("List of steps and expected results."),
  issues: z
    .array(z.string())
    .optional()
    .describe(
      "List of the linked Jira, Asana or Azure issues ID's. This should be strictly in array format not the string of json.",
    ),
  issue_tracker: z
    .object({
      name: z
        .string()
        .describe(
          "Issue tracker name,  For example, use jira for Jira, azure for Azure DevOps, or asana for Asana.",
        ),
      host: z.string().url().describe("Base URL of the issue tracker."),
    })
    .optional(),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Tags to attach to the test case. This should be strictly in array format not the string of json",
    ),
  custom_fields: z
    .record(z.string(), z.string())
    .optional()
    .describe("Map of custom field names to values."),
});

export function sanitizeArgs(args: any) {
  const cleaned = { ...args };

  if (cleaned.description === null) delete cleaned.description;
  if (cleaned.owner === null) delete cleaned.owner;
  if (cleaned.preconditions === null) delete cleaned.preconditions;

  if (cleaned.issue_tracker) {
    if (
      cleaned.issue_tracker.name === undefined ||
      cleaned.issue_tracker.host === undefined
    ) {
      delete cleaned.issue_tracker;
    }
  }

  return cleaned;
}

export async function createTestCase(
  params: TestCaseCreateRequest,
): Promise<CallToolResult> {
  const body = { test_case: params };

  try {
    const response = await axios.post<TestCaseResponse>(
      `https://test-management.browserstack.com/api/v2/projects/${encodeURIComponent(
        params.project_identifier,
      )}/folders/${encodeURIComponent(params.folder_id)}/test-cases`,
      body,
      {
        auth: {
          username: config.browserstackUsername,
          password: config.browserstackAccessKey,
        },
        headers: { "Content-Type": "application/json" },
      },
    );

    const { data } = response.data;
    if (!data.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to create test case: ${JSON.stringify(
              response.data,
            )}`,
            isError: true,
          },
        ],
        isError: true,
      };
    }

    const tc = data.test_case;
    const projectId = await projectIdentifierToId(params.project_identifier);

    return {
      content: [
        {
          type: "text",
          text: `Test case successfully created:
            - Identifier: ${tc.identifier}
            - Title: ${tc.title}

          You can view it here: https://test-management.browserstack.com/projects/${projectId}/folder/search?q=${tc.identifier}`,
        },
        {
          type: "text",
          text: JSON.stringify(tc, null, 2),
        },
      ],
    };
  } catch (err) {
    // Delegate to our centralized Axios error formatter
    return formatAxiosError(err, "Failed to create test case");
  }
}
