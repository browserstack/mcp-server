import { describe, it, expect, vi } from "vitest";

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));
vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { post: postMock },
}));
vi.mock("../../src/lib/tm-base-url.js", () => ({
  getTMBaseURL: async () => "https://tm.example",
}));

import { triggerTestCaseGeneration } from "../../src/tools/testmanagement-utils/TCG-utils/api.js";

const bsConfig: any = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
};

describe("triggerTestCaseGeneration", () => {
  it("sends the document's mimeType", async () => {
    postMock.mockResolvedValue({
      status: 200,
      data: { "x-bstack-traceRequestId": "trace-1" },
    });

    const traceId = await triggerTestCaseGeneration(
      "https://dl",
      42,
      "folder-1",
      "123",
      "jira-on-prem",
      bsConfig,
      "text/plain",
    );

    expect(traceId).toBe("trace-1");
    expect(postMock.mock.calls[0][0].body).toMatchObject({
      document: "https://dl",
      documentId: 42,
      mimeType: "text/plain",
    });
  });
});
