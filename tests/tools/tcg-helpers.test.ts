import { describe, it, expect } from "vitest";
import { createTestCasePayload } from "../../src/tools/testmanagement-utils/TCG-utils/helpers";

const fieldMaps = {
  priority: { medium: 2 },
  status: { active: 1 },
  caseType: { functional: 3 },
};

describe("createTestCasePayload", () => {
  // Teststack's AI details fetch reads ai_prompt.attachment_ids (an array, as
  // the web app sends it); the singular key leaves the fetch without a
  // documentId and TCG rejects it with a 400.
  it("sends the document as ai_prompt.attachment_ids", () => {
    const payload = createTestCasePayload(
      { name: "TC", steps: [], uuid: "tc-uuid" },
      "scenario-1",
      "folder-1",
      fieldMaps,
      123,
      undefined,
      "trace-1",
    );

    const aiPrompt = JSON.parse(payload.metadata).ai_prompt;
    expect(aiPrompt.attachment_ids).toEqual([123]);
    expect(aiPrompt).not.toHaveProperty("attachment_id");
    expect(aiPrompt.uuid).toBe("tc-uuid");
    expect(payload.fetch_ai_test_case_details).toBe(true);
    expect(payload.attachments).toEqual([123]);
  });
});
