import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorText } from "../../lib/error.js";
import {
  fetchFormFields,
  normalizeDefaultFields as normalizeDefaultFieldsFromForm,
  projectIdentifierToId,
} from "./TCG-utils/api.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { wrapRichText, wrapTestCaseSteps } from "./rich-text.js";
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
  owner?: string;
  priority?: string;
  case_type?: string;
  automation_status?: string;
  status?: string;
  tags?: string[];
  issues?: string[];
  custom_fields?: Record<
    string,
    string | number | boolean | Array<string | number>
  >;
}

export const UpdateTestCaseSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "Project ID of the test case.",
    ),
  test_case_identifier: z
    .string()
    .describe(
      "Test case ID (from listTestCases).",
    ),
  name: z.string().optional().describe("Updated name of the test case."),
  description: z
    .string()
    .optional()
    .describe("Updated description."),
  preconditions: z
    .string()
    .optional()
    .describe("Updated preconditions."),
  test_case_steps: z
    .array(
      z.object({
        step: z.string().describe("Step action."),
        result: z.string().describe("Expected result."),
      }),
    )
    .optional()
    .describe("Updated steps and expected results."),
  owner: z
    .string()
    .email()
    .optional()
    .describe("Owner email."),
  priority: z
    .string()
    .optional()
    .describe("Priority, e.g. 'High' or 'medium'; values vary per project."),
  case_type: z
    .string()
    .optional()
    .describe(
      "Type, e.g. 'Functional' or 'smoke_sanity'; values vary per project.",
    ),
  automation_status: z
    .string()
    .optional()
    .describe(
      "e.g. not_automated, automated, automation_not_required, obsolete.",
    ),
  status: z
    .string()
    .optional()
    .describe(
      "e.g. 'active', 'draft', 'in_review', 'outdated', 'rejected'.",
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe("Replacement tags."),
  issues: z
    .array(z.string())
    .optional()
    .describe(
      "Replacement Jira/Asana/Azure issue IDs.",
    ),
  custom_fields: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.union([z.string(), z.number()])),
      ]),
    )
    .optional()
    .describe(
      "Custom field NAME to value; array for multi-select.",
    ),
});

/**
 * Normalise default-field inputs (priority/case_type/automation_status) to
 * what the TM PATCH endpoint accepts. Fetches the project's form-fields
 * on demand; on failure, returns inputs unchanged and lets the backend
 * surface validation errors.
 */
async function normalizeDefaultFields(
  params: TestCaseUpdateRequest,
  config: BrowserStackConfig,
): Promise<{
  priority?: string;
  case_type?: string;
  automation_status?: string;
}> {
  const needsLookup =
    params.priority !== undefined ||
    params.case_type !== undefined ||
    params.automation_status !== undefined;
  if (!needsLookup) return {};

  try {
    const numericProjectId = await projectIdentifierToId(
      params.project_identifier,
      config,
    );
    const { default_fields } = await fetchFormFields(numericProjectId, config);

    return normalizeDefaultFieldsFromForm(default_fields, {
      priority: params.priority,
      case_type: params.case_type,
      automation_status: params.automation_status,
    });
  } catch (err) {
    logger.warn(
      "Failed to normalize default field values; passing through as given: %s",
      err instanceof Error ? err.message : String(err),
    );
    return {
      priority: params.priority,
      case_type: params.case_type,
      automation_status: params.automation_status,
    };
  }
}

/**
 * Updates an existing test case in BrowserStack Test Management.
 */
export async function updateTestCase(
  params: TestCaseUpdateRequest,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");

  const testCaseBody: Record<string, any> = {};

  if (params.name !== undefined) testCaseBody.name = params.name;
  if (params.description !== undefined)
    testCaseBody.description = wrapRichText(params.description);
  if (params.preconditions !== undefined)
    testCaseBody.preconditions = wrapRichText(params.preconditions);
  if (params.test_case_steps !== undefined)
    testCaseBody.test_case_steps = wrapTestCaseSteps(params.test_case_steps);
  if (params.owner !== undefined) testCaseBody.owner = params.owner;
  if (params.status !== undefined) testCaseBody.status = params.status;
  if (params.tags !== undefined) testCaseBody.tags = params.tags;
  if (params.issues !== undefined) testCaseBody.issues = params.issues;
  if (params.custom_fields !== undefined)
    testCaseBody.custom_fields = params.custom_fields;

  // Default fields need value normalization (see notes above the helper).
  const normalized = await normalizeDefaultFields(params, config);
  if (normalized.priority !== undefined)
    testCaseBody.priority = normalized.priority;
  if (normalized.case_type !== undefined)
    testCaseBody.case_type = normalized.case_type;
  if (normalized.automation_status !== undefined)
    testCaseBody.automation_status = normalized.automation_status;

  if (Object.keys(testCaseBody).length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "No updatable fields provided. Pass at least one of: name, description, preconditions, test_case_steps, owner, priority, case_type, automation_status, status, tags, issues, custom_fields.",
        },
      ],
      isError: true,
    };
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
- **Automation Status**: ${tc.automation_status ?? "N/A"}

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

    const status = err.response?.status;
    const detail = errorText(err, "unknown error");
    const hint =
      status === 401 ? " Check the BrowserStack credentials in use." : "";
    return {
      content: [
        {
          type: "text",
          text: `Failed to update test case${status ? ` (HTTP ${status})` : ""}: ${detail}.${hint}`,
        },
      ],
      isError: true,
    };
  }
}
