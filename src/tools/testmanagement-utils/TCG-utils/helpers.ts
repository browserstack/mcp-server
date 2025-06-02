import { DefaultFieldMaps } from "./types.js";

/**
 * Build mappings for default fields for priority, status, and case type.
 */
export function buildDefaultFieldMaps(defaultFields: any): DefaultFieldMaps {
  const priority = Object.fromEntries(
    defaultFields.priority.values.map((v: any) => [
      v.name.toLowerCase(),
      v.value,
    ]),
  );
  const status = Object.fromEntries(
    defaultFields.status.values.map((v: any) => [v.internal_name, v.value]),
  );
  const caseType = Object.fromEntries(
    defaultFields.case_type.values.map((v: any) => [v.internal_name, v.value]),
  );
  return { priority, status, caseType };
}

/**
 * Find a boolean custom field ID if present.
 */
export function findBooleanFieldId(customFields: any[]): number | undefined {
  const boolField = customFields.find((f) => f.field_type === "field_boolean");
  return boolField?.id;
}

/**
 * Construct payload for creating a single test case in bulk.
 */
export function createTestCasePayload(
  tc: any,
  scenarioId: string,
  folderId: string,
  fieldMaps: DefaultFieldMaps,
  documentId: number,
  booleanFieldId?: number,
  traceId?: string,
): Record<string, any> {
  const pri = tc.priority ?? "Medium";
  const stat = fieldMaps.status["active"];
  const ct = fieldMaps.caseType["functional"];

  return {
    attachments: [documentId],
    name: tc.name,
    description: tc.description,
    test_case_folder_id: folderId,
    priority: pri,
    status: stat,
    case_type: ct,
    automation_status: "not_automated",
    fetch_ai_test_case_details: true,
    template: "test_case_steps",
    metadata: JSON.stringify({
      ai_prompt: {
        attachment_id: documentId,
        rich_text_id: null,
        scenario: scenarioId,
        test_case_count: tc.test_case_count || 1,
        uuid: tc.uuid || crypto.randomUUID?.() || "unknown-uuid",
        "x-bstack-traceRequestId": traceId,
      },
    }),
    tags: ["AI Generated", "MCP Generated"],
    custom_fields: booleanFieldId ? { [booleanFieldId]: false } : undefined,
    test_case_steps: tc.steps,
    preconditions: tc.preconditions,
  };
}
