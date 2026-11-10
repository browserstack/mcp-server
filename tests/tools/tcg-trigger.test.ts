import { describe, it, expect, vi } from "vitest";

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));
vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { post: postMock },
}));
vi.mock("../../src/lib/tm-base-url.js", () => ({
  getTMBaseURL: async () => "https://tm.example",
}));

import {
  triggerTestCaseGeneration,
  bulkCreateTestCases,
} from "../../src/tools/testmanagement-utils/TCG-utils/api.js";

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
      "mcp",
      bsConfig,
      "text/plain",
    );

    expect(traceId).toBe("trace-1");
    expect(postMock.mock.calls[0][0].body).toMatchObject({
      document: "https://dl",
      documentId: 42,
      mimeType: "text/plain",
      source: "mcp",
    });
    expect(postMock.mock.calls[0][0].headers["request-source"]).toBe("mcp");
  });
});

describe("bulkCreateTestCases", () => {
  it("sends the request-source header", async () => {
    postMock.mockReset();
    postMock.mockResolvedValue({ status: 200, data: { success: true } });

    await bulkCreateTestCases(
      {
        "sc-1": {
          id: "sc-1",
          name: "Scenario",
          traceId: "trace-1",
          testcases: [{ id: "tc-1", name: "Case", steps: [] } as any],
        },
      },
      "123",
      "folder-1",
      { priority: {}, status: {}, caseType: {} },
      undefined,
      "trace-1",
      { sendNotification: vi.fn() },
      42,
      "mcp",
      bsConfig,
    );

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][0].headers["request-source"]).toBe("mcp");
  });
});
