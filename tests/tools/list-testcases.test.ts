import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock("../../src/lib/tm-base-url", () => ({
  getTMBaseURL: vi
    .fn()
    .mockResolvedValue("https://test-management.browserstack.com"),
}));

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient";
import { listTestCases } from "../../src/tools/testmanagement-utils/list-testcases";

const mockConfig = {
  "browserstack-username": "config-user",
  "browserstack-access-key": "config-key",
} as any;

describe("listTestCases — linked issues in summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("labels linked issues by tracker type (Linear)", async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        success: true,
        info: { count: 1 },
        test_cases: [
          {
            identifier: "TC-1",
            title: "Login works",
            case_type: "Functional",
            priority: "Critical",
            issues: [{ jira_id: "TES-5", issue_type: "linear" }],
          },
        ],
      },
    });

    const result = await listTestCases(
      { project_identifier: "PR-1", folder_id: "51030419" },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain(
      "• TC-1: Login works [Functional | Critical] {linked: linear:TES-5}",
    );
  });

  it("omits the linked segment when a test case has no issues", async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        success: true,
        info: { count: 1 },
        test_cases: [
          {
            identifier: "TC-2",
            title: "No links",
            case_type: "Functional",
            priority: "Low",
            issues: [],
          },
        ],
      },
    });

    const result = await listTestCases(
      { project_identifier: "PR-1" },
      mockConfig,
    );

    expect(result.content?.[0]?.text).toContain(
      "• TC-2: No links [Functional | Low]",
    );
    expect(result.content?.[0]?.text).not.toContain("{linked:");
  });

  it("skips malformed issue entries instead of rendering undefined", async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        success: true,
        info: { count: 1 },
        test_cases: [
          {
            identifier: "TC-3",
            title: "Malformed link",
            case_type: "Functional",
            priority: "Medium",
            issues: [{}, { jira_id: "TES-9", issue_type: "linear" }],
          },
        ],
      },
    });

    const result = await listTestCases(
      { project_identifier: "PR-1" },
      mockConfig,
    );

    expect(result.content?.[0]?.text).toContain("{linked: linear:TES-9}");
    expect(result.content?.[0]?.text).not.toContain("undefined");
  });
});
