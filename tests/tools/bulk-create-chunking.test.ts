import { describe, it, expect, vi, beforeEach } from "vitest";

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { post: postMock, get: vi.fn() },
}));
vi.mock("../../src/lib/tm-base-url", () => ({
  getTMBaseURL: vi.fn().mockResolvedValue("https://tm.example.com"),
}));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("user:key"),
}));

import { bulkCreateTestCases } from "../../src/tools/testmanagement-utils/TCG-utils/api";

const fieldMaps = {
  priority: {},
  status: { active: "active" },
  caseType: { functional: "functional" },
} as any;

const context = {
  sendNotification: vi.fn().mockResolvedValue(undefined),
  _meta: {},
};

function scenario(id: string, n: number) {
  return {
    id,
    name: id,
    testcases: Array.from({ length: n }, (_, i) => ({
      name: `tc-${i}`,
      steps: [],
      priority: "Medium",
    })),
  };
}

function callSizes() {
  return postMock.mock.calls.map((c: any) => c[0].body.test_cases.length);
}

describe("bulkCreateTestCases chunking", () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: { success: true } });
    context.sendNotification.mockClear();
  });

  it("splits a >10-case scenario into <=10-case requests (23 -> 10+10+3)", async () => {
    const scenariosMap = { s1: scenario("s1", 23) } as any;
    const result = await bulkCreateTestCases(
      scenariosMap,
      "proj",
      "folder",
      fieldMaps,
      undefined,
      "trace",
      context,
      1,
      {} as any,
    );

    expect(postMock).toHaveBeenCalledTimes(3);
    expect(callSizes()).toEqual([10, 10, 3]);
    expect(callSizes().every((s: number) => s <= 10)).toBe(true);
    expect(result).toContain("Total of 23 test cases created in 1 of 1 scenarios");
  });

  it("counts only created cases and reports a scenario whose batch failed", async () => {
    // 15 cases -> 2 batches (10, 5); first ok, second rejected
    postMock
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error("More than permitted test cases sent"));

    const scenariosMap = { s1: scenario("s1", 15) } as any;
    const result = await bulkCreateTestCases(
      scenariosMap,
      "proj",
      "folder",
      fieldMaps,
      undefined,
      "trace",
      context,
      1,
      {} as any,
    );

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(result).toContain("Total of 10 test cases created");
    expect(result).toContain("Failed to create test cases for 1 scenario");
  });

  it("does not call the API for an empty scenario", async () => {
    const scenariosMap = { s1: scenario("s1", 0) } as any;
    const result = await bulkCreateTestCases(
      scenariosMap,
      "proj",
      "folder",
      fieldMaps,
      undefined,
      "trace",
      context,
      1,
      {} as any,
    );
    expect(postMock).not.toHaveBeenCalled();
    expect(result).toContain("Total of 0 test cases created in 0 of 1 scenarios");
  });
});
