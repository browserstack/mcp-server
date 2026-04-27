import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { fetchFormFields, projectIdentifierToId } from "./TCG-utils/api.js";
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
  owner?: string;
  priority?: string;
  case_type?: string;
  automation_status?: string;
  status?: string;
  tags?: string[];
  issues?: string[];
  custom_fields?: Record<string, string | number | boolean>;
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
  owner: z
    .string()
    .email()
    .optional()
    .describe("Email of the test case owner."),
  priority: z
    .string()
    .optional()
    .describe(
      "Updated priority. Accepts either display name (e.g. 'Medium', 'Critical', 'High', 'Low') or internal name (e.g. 'medium'). Valid values are per-project and discoverable via the form-fields endpoint.",
    ),
  case_type: z
    .string()
    .optional()
    .describe(
      "Updated test case type. Accepts either display name (e.g. 'Functional', 'Regression', 'Smoke & Sanity') or internal name (e.g. 'functional', 'smoke_sanity'). Valid values are per-project.",
    ),
  automation_status: z
    .string()
    .optional()
    .describe(
      "Updated automation status. Use internal name such as 'not_automated', 'automated', 'automation_not_required', 'cannot_be_automated', or 'obsolete'.",
    ),
  status: z
    .string()
    .optional()
    .describe(
      "Updated review status of the test case (e.g. 'active', 'draft', 'in_review', 'outdated', 'rejected').",
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe("Replacement list of tags for the test case."),
  issues: z
    .array(z.string())
    .optional()
    .describe(
      "Replacement list of linked Jira/Asana/Azure issue IDs for the test case.",
    ),
  custom_fields: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    )
    .optional()
    .describe(
      "Map of custom field name/id to value. Valid field names and value types are per-project; discover them via the project's form fields.",
    ),
});

/**
 * Build a normalizer for a default field's accepted value.
 * The TM PATCH endpoint accepts different casings for different default
 * fields (Title-Case display name for priority/case_type, snake_case
 * internal_name for automation_status). We accept either from the caller
 * and emit the form the API actually wants.
 *
 * Returns undefined when no matching option is found — callers should
 * pass the raw value through so the backend can surface its own error.
 */
function normalizeDefaultFieldValue(
  fieldValues: Array<{ internal_name?: string | null; name?: string; value: any }>,
  input: string,
  emit: "name" | "internal_name",
): string | undefined {
  const normalized = input.toLowerCase().trim();
  const match = fieldValues.find(
    (v) =>
      (v.internal_name ?? "").toLowerCase() === normalized ||
      (v.name ?? "").toLowerCase() === normalized,
  );
  if (!match) return undefined;
  if (emit === "name") return match.name;
  return match.internal_name ?? match.name;
}

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

    const out: {
      priority?: string;
      case_type?: string;
      automation_status?: string;
    } = {};

    if (params.priority !== undefined) {
      out.priority =
        normalizeDefaultFieldValue(
          default_fields?.priority?.values ?? [],
          params.priority,
          "name",
        ) ?? params.priority;
    }
    if (params.case_type !== undefined) {
      out.case_type =
        normalizeDefaultFieldValue(
          default_fields?.case_type?.values ?? [],
          params.case_type,
          "name",
        ) ?? params.case_type;
    }
    if (params.automation_status !== undefined) {
      // automation_status.values have null internal_name and the internal
      // name is actually held in `value` (see API inspection). Accept
      // either the display name or the internal snake_case form.
      const values =
        (default_fields?.automation_status?.values as Array<{
          name?: string;
          value?: string;
        }>) ?? [];
      const input = params.automation_status.toLowerCase().trim();
      const match = values.find(
        (v) =>
          (v.value ?? "").toLowerCase() === input ||
          (v.name ?? "").toLowerCase() === input,
      );
      out.automation_status = match?.value ?? params.automation_status;
    }

    return out;
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
    testCaseBody.description = params.description;
  if (params.preconditions !== undefined)
    testCaseBody.preconditions = params.preconditions;
  if (params.test_case_steps !== undefined)
    testCaseBody.steps = params.test_case_steps;
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
