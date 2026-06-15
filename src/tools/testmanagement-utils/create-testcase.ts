import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import {
  fetchFormFields,
  normalizeDefaultFieldValue,
  projectIdentifierToId,
} from "./TCG-utils/api.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";
import logger from "../../logger.js";

interface TestCaseStep {
  step: string;
  result: string;
}

interface IssueTracker {
  name: string;
  host: string;
}

// A custom field value may be a scalar or, for multi-select fields, an array
// of option values. The TM API accepts arrays only when keyed by field NAME.
export type CustomFieldValue =
  | string
  | number
  | boolean
  | Array<string | number>;

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
  custom_fields?: Record<string, CustomFieldValue>;
  automation_status?: string;
  priority?: string;
  template?: string;
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

// Scalar value, or an array of values for multi-select custom fields.
export const customFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

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
    .record(z.string(), customFieldValueSchema)
    .optional()
    .describe(
      "Map of custom field NAME to value; use an array for multi-select fields.",
    ),
  automation_status: z
    .string()
    .optional()
    .describe(
      "Automation status of the test case. Common values include 'not_automated', 'automated', 'automation_not_required'.",
    ),
  priority: z
    .string()
    .optional()
    .describe(
      "Priority of the test case. Accepts either display name (e.g. 'Critical', 'High', 'Medium', 'Low') or internal name (e.g. 'medium'). If omitted, the project default (usually 'Medium') is applied. Valid values are per-project and discoverable via the form-fields endpoint.",
    ),
  template: z
    .string()
    .optional()
    .describe(
      "Template internal slug, e.g. 'test_case_steps' or 'test_case_bdd'. Use the slug, not the display name.",
    ),
});

export function sanitizeArgs(args: any) {
  const cleaned = { ...args };

  if (cleaned.description === null) delete cleaned.description;
  if (cleaned.owner === null) delete cleaned.owner;
  if (cleaned.preconditions === null) delete cleaned.preconditions;
  if (cleaned.automation_status === null) delete cleaned.automation_status;
  if (cleaned.template === null) delete cleaned.template;

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

import { getBrowserStackAuth } from "../../lib/get-auth.js";

/**
 * Normalize priority to the display name the create endpoint accepts (it
 * rejects lowercase). On lookup failure, pass the raw value through.
 */
async function normalizePriority(
  projectIdentifier: string,
  priority: string,
  config: BrowserStackConfig,
): Promise<string> {
  try {
    const numericProjectId = await projectIdentifierToId(
      projectIdentifier,
      config,
    );
    const { default_fields } = await fetchFormFields(numericProjectId, config);
    return (
      normalizeDefaultFieldValue(
        default_fields?.priority?.values ?? [],
        priority,
        "name",
      ) ?? priority
    );
  } catch (err) {
    logger.warn(
      "Failed to normalize priority value; passing through as given: %s",
      err instanceof Error ? err.message : String(err),
    );
    return priority;
  }
}

export async function createTestCase(
  params: TestCaseCreateRequest,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const testCaseParams: TestCaseCreateRequest = { ...params };

  if (testCaseParams.priority !== undefined) {
    testCaseParams.priority = await normalizePriority(
      params.project_identifier,
      testCaseParams.priority,
      config,
    );
  }

  const body = { test_case: testCaseParams };
  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");

  try {
    const tmBaseUrl = await getTMBaseURL(config);
    const response = await apiClient.post({
      url: `${tmBaseUrl}/api/v2/projects/${encodeURIComponent(
        params.project_identifier,
      )}/folders/${encodeURIComponent(params.folder_id)}/test-cases`,
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
            text: `Failed to create test case: ${JSON.stringify(
              response.data,
            )}`,
          },
        ],
        isError: true,
      };
    }

    const tc = data.test_case;
    const projectId = await projectIdentifierToId(
      params.project_identifier,
      config,
    );

    const content: Array<{ type: "text"; text: string }> = [];

    // The TM API silently ignores an unrecognized template slug and falls back
    // to the default. Surface that instead of letting it pass as success.
    if (
      params.template &&
      tc.template &&
      String(tc.template).toLowerCase() !==
        String(params.template).toLowerCase()
    ) {
      content.push({
        type: "text",
        text: `Warning: requested template "${params.template}" was not applied — the test case was created with "${tc.template}". BrowserStack expects the template's internal slug (e.g. "test_case_steps", "test_case_bdd") and silently uses the default for unrecognized values.`,
      });
    }

    content.push({
      type: "text",
      text: `Test case successfully created:
            - Identifier: ${tc.identifier}
            - Title: ${tc.title}

          You can view it here: ${tmBaseUrl}/projects/${projectId}/folder/search?q=${tc.identifier}`,
    });
    content.push({ type: "text", text: JSON.stringify(tc, null, 2) });

    return { content };
  } catch (err) {
    // Delegate to our centralized Axios error formatter
    return formatAxiosError(err, "Failed to create test case");
  }
}
