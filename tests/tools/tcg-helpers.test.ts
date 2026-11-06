import { describe, it, expect } from "vitest";
import { createTestCasePayload } from "../../src/tools/testmanagement-utils/TCG-utils/helpers";

const fieldMaps = {
  priority: { medium: 2 },
  status: { active: 1 },
  caseType: { functional: 3 },
};

const steps = [{ step: "Open the app", result: "App opens" }];

function build(tc: any) {
  const payload = createTestCasePayload(
    tc,
    "scenario-1",
    "folder-1",
    fieldMaps,
    123,
    undefined,
    "trace-1",
  );
  return { payload, aiPrompt: JSON.parse(payload.metadata).ai_prompt };
}

describe("createTestCasePayload", () => {
  // Teststack's AI details fetch reads ai_prompt.attachment_ids (an array, as
  // the web app sends it); the singular key leaves the fetch without a
  // documentId and TCG rejects it with a 400.
  it("sends the document as ai_prompt.attachment_ids", () => {
    const { payload, aiPrompt } = build({ name: "TC", id: "tc-1", steps });

    expect(aiPrompt.attachment_ids).toEqual([123]);
    expect(aiPrompt).not.toHaveProperty("attachment_id");
    expect(payload.attachments).toEqual([123]);
  });

  it("sends the generated test case id as ai_prompt.uuid", () => {
    expect(build({ name: "TC", id: "tc-1", steps }).aiPrompt.uuid).toBe(
      "tc-1",
    );
    expect(
      build({ name: "TC", test_case_id: 42, steps }).aiPrompt.uuid,
    ).toBe("42");
  });

  it("omits ai_prompt.uuid when the test case has no generated id", () => {
    const { aiPrompt } = build({ name: "TC", steps });
    expect(aiPrompt).not.toHaveProperty("uuid");
  });

  it("only requests AI details when steps are missing", () => {
    expect(
      build({ name: "TC", id: "tc-1", steps }).payload
        .fetch_ai_test_case_details,
    ).toBe(false);
    expect(
      build({ name: "TC", id: "tc-1", steps: [] }).payload
        .fetch_ai_test_case_details,
    ).toBe(true);
    expect(
      build({ name: "TC", id: "tc-1" }).payload.fetch_ai_test_case_details,
    ).toBe(true);
  });
});
