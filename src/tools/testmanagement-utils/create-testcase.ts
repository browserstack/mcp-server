import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import {
  fetchFormFields,
  normalizeDefaultFields as normalizeDefaultFieldsFromForm,
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
  case_type?: string;
  template?: string;
  template_id?: number;
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
      template_id?: number;
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
  case_type: z
    .string()
    .optional()
    .describe(
      "Test case type display or internal name (per-project). Omit for project default.",
    ),
  template: z
    .string()
    .optional()
    .describe(
      "System template slug only: 'test_case_steps' or 'test_case_bdd'. For a custom template, use template_id instead.",
    ),
  template_id: z
    .number()
    .optional()
    .describe(
      "Numeric ID of a custom template (from listTestCaseTemplates); applies that template. Overrides 'template'.",
    ),
});

export function sanitizeArgs(args: any) {
  const cleaned = { ...args };

  if (cleaned.description === null) delete cleaned.description;
  if (cleaned.owner === null) delete cleaned.owner;
  if (cleaned.preconditions === null) delete cleaned.preconditions;
  if (cleaned.automation_status === null) delete cleaned.automation_status;
  if (cleaned.template === null) delete cleaned.template;
  if (cleaned.template_id === null) delete cleaned.template_id;

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
 * Fetch the project's form-fields and normalize priority/case_type to the
 * display names the create endpoint accepts (it rejects lowercase internal
 * names). On lookup failure, passes raw values through.
 */
async function normalizeDefaultFields(
  projectIdentifier: string,
  fields: { priority?: string; case_type?: string },
  config: BrowserStackConfig,
): Promise<{ priority?: string; case_type?: string }> {
  try {
    const numericProjectId = await projectIdentifierToId(
      projectIdentifier,
      config,
    );
    const { default_fields } = await fetchFormFields(numericProjectId, config);
    return normalizeDefaultFieldsFromForm(default_fields, fields);
  } catch (err) {
    logger.warn(
      "Failed to normalize default fields; passing through as given: %s",
      err instanceof Error ? err.message : String(err),
    );
    return { priority: fields.priority, case_type: fields.case_type };
  }
}

/**
 * Read a freshly-created test case back to learn which template was actually
 * applied. The create response does not echo template_id, but the v1 search
 * endpoint does. Returns undefined on any failure (caller then skips the
 * verification warning rather than blocking the success path).
 */
async function fetchAppliedTemplateId(
  numericProjectId: string,
  identifier: string,
  config: BrowserStackConfig,
): Promise<number | undefined> {
  try {
    const tmBaseUrl = await getTMBaseURL(config);
    const resp = await apiClient.get({
      url: `${tmBaseUrl}/api/v1/projects/${encodeURIComponent(
        numericProjectId,
      )}/test-cases/search?q%5Bquery%5D=${encodeURIComponent(identifier)}`,
      headers: {
        "API-TOKEN": getBrowserStackAuth(config),
        accept: "application/json, text/plain, */*",
      },
    });
    const cases: Array<{ identifier?: string; template_id?: number }> =
      resp.data?.test_cases ?? [];
    const match = cases.find((c) => c.identifier === identifier);
    return match?.template_id;
  } catch {
    return undefined;
  }
}

/**
 * The v1 create endpoint (used when a template_id is requested) keys
 * custom_fields by numeric field id with option *ids* — unlike the v2 endpoint,
 * which keys by field name with option *values*. Translate the MCP's by-name
 * shape into v1's by-id shape using the project's form fields. Best-effort:
 * unknown fields/options pass through unchanged.
 */
async function toV1CustomFields(
  customFields: Record<string, CustomFieldValue>,
  numericProjectId: string,
  config: BrowserStackConfig,
): Promise<Record<string, CustomFieldValue>> {
  let defs: any[] = [];
  try {
    const formFields = await fetchFormFields(numericProjectId, config);
    defs = Array.isArray(formFields?.custom_fields)
      ? formFields.custom_fields
      : [];
  } catch {
    return customFields;
  }

  const byName = new Map<string, any>(defs.map((f) => [f.field_name, f]));
  const out: Record<string, CustomFieldValue> = {};

  for (const [name, value] of Object.entries(customFields)) {
    const def = byName.get(name);
    if (!def) {
      out[name] = value; // unknown field name — leave as-is
      continue;
    }
    const isOptionField =
      def.field_type === "field_dropdown" ||
      def.field_type === "field_multi_dropdown";
    if (isOptionField) {
      const optionIdByValue = new Map<string, string | number>();
      for (const o of (def.option_values ?? []) as Array<{
        option_value: string | number;
        id: string | number;
      }>) {
        optionIdByValue.set(String(o.option_value), o.id);
      }
      const toOptionId = (v: string | number): string | number =>
        optionIdByValue.get(String(v)) ?? v;
      out[String(def.id)] = Array.isArray(value)
        ? value.map(toOptionId)
        : toOptionId(value as string | number);
    } else {
      out[String(def.id)] = value;
    }
  }
  return out;
}

export async function createTestCase(
  params: TestCaseCreateRequest,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const testCaseParams: TestCaseCreateRequest = { ...params };

  testCaseParams.tags = Array.from(
    new Set([...(testCaseParams.tags ?? []), "MCP Generated"]),
  );

  if (
    testCaseParams.priority !== undefined ||
    testCaseParams.case_type !== undefined
  ) {
    const normalized = await normalizeDefaultFields(
      params.project_identifier,
      {
        priority: testCaseParams.priority,
        case_type: testCaseParams.case_type,
      },
      config,
    );
    if (normalized.priority !== undefined)
      testCaseParams.priority = normalized.priority;
    if (normalized.case_type !== undefined)
      testCaseParams.case_type = normalized.case_type;
  }

  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");

  try {
    const tmBaseUrl = await getTMBaseURL(config);

    // The public v2 create endpoint silently drops template_id, so a specific
    // (custom) template cannot be applied through it. The v1 create endpoint
    // DOES honour template_id — but it needs the numeric project id, the folder
    // in the body, API-TOKEN auth, and custom_fields keyed by id. Use v1 only
    // when a template_id is requested; otherwise keep the proven v2 path so
    // existing behaviour (incl. custom_fields by name) is unchanged.
    let request: { url: string; headers: Record<string, string>; body: any };
    if (testCaseParams.template_id !== undefined) {
      const numericProjectId = await projectIdentifierToId(
        params.project_identifier,
        config,
      );
      const v1TestCase: Record<string, any> = { ...testCaseParams };
      delete v1TestCase.project_identifier;
      delete v1TestCase.folder_id;
      delete v1TestCase.custom_fields;
      v1TestCase.test_case_folder_id = Number(params.folder_id);
      if (testCaseParams.custom_fields) {
        v1TestCase.custom_fields = await toV1CustomFields(
          testCaseParams.custom_fields,
          numericProjectId,
          config,
        );
      }
      request = {
        url: `${tmBaseUrl}/api/v1/projects/${encodeURIComponent(
          numericProjectId,
        )}/test-cases`,
        headers: {
          "Content-Type": "application/json",
          "API-TOKEN": authString,
        },
        body: { folder_id: Number(params.folder_id), test_case: v1TestCase },
      };
    } else {
      request = {
        url: `${tmBaseUrl}/api/v2/projects/${encodeURIComponent(
          params.project_identifier,
        )}/folders/${encodeURIComponent(params.folder_id)}/test-cases`,
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " +
            Buffer.from(`${username}:${password}`).toString("base64"),
        },
        body: { test_case: testCaseParams },
      };
    }

    const response = await apiClient.post(request);

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

    // A specific custom template is selected by numeric template_id. The create
    // response does not echo template_id, so read the case back to learn which
    // template was actually applied and warn on mismatch — the public create
    // endpoint may silently ignore the requested template.
    if (params.template_id !== undefined) {
      const appliedId =
        tc.template_id !== undefined
          ? Number(tc.template_id)
          : await fetchAppliedTemplateId(projectId, tc.identifier, config);
      if (appliedId !== undefined && appliedId !== Number(params.template_id)) {
        content.push({
          type: "text",
          text: `Warning: requested template_id ${params.template_id} was not applied — the test case uses template_id ${appliedId}. Confirm the id via listTestCaseTemplates and that the template is linked to this project.`,
        });
      }
    }

    // The TM API silently ignores an unrecognized template slug and falls back
    // to the default. Surface that instead of letting it pass as success.
    // Note: the `template` slug only ever selects a SYSTEM template; a custom
    // template must be selected with template_id.
    if (
      params.template_id === undefined &&
      params.template &&
      tc.template &&
      String(tc.template).toLowerCase() !==
        String(params.template).toLowerCase()
    ) {
      content.push({
        type: "text",
        text: `Warning: requested template "${params.template}" was not applied — the test case was created with "${tc.template}". The 'template' field accepts only the system slugs "test_case_steps" or "test_case_bdd"; for a custom template pass template_id (see listTestCaseTemplates).`,
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
