import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: {
    patch: vi.fn(),
  },
}));

vi.mock("../../src/lib/tm-base-url", () => ({
  getTMBaseURL: vi.fn().mockResolvedValue("https://test-management.browserstack.com"),
}));

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient";
import { updateTestRun } from "../../src/tools/testmanagement-utils/update-testrun";

const mockConfig = {
  "browserstack-username": "config-user",
  "browserstack-access-key": "config-key",
} as any;

describe("updateTestRun — endpoint dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes metadata (name/run_state) to the /update endpoint", async () => {
    (apiClient.patch as any).mockResolvedValue({
      data: { success: true, testrun: { name: "New" } },
    });

    const result = await updateTestRun(
      {
        project_identifier: "PR-1",
        test_run_id: "TR-1",
        test_run: { name: "New", run_state: "in_progress" },
      },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    const call = (apiClient.patch as any).mock.calls[0][0];
    expect(call.url).toMatch(/\/test-runs\/TR-1\/update$/);
    expect(call.body).toEqual({
      test_run: { name: "New", run_state: "in_progress" },
    });
    expect(result.content?.[0]?.text).toContain(
      "Successfully updated test run TR-1",
    );
  });

  it("routes add_test_cases to the /test-cases endpoint with preserve default", async () => {
    (apiClient.patch as any).mockResolvedValue({
      data: { success: true, async: true, unique_id: "abc" },
    });

    const result = await updateTestRun(
      {
        project_identifier: "PR-1",
        test_run_id: "TR-9",
        test_run: {
          add_test_cases: [{ test_case_ids: ["TC-1", "TC-2"] }],
        },
      },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    const call = (apiClient.patch as any).mock.calls[0][0];
    expect(call.url).toMatch(/\/test-runs\/TR-9\/test-cases$/);
    expect(call.body.test_run.add_test_cases).toEqual([
      { test_case_ids: ["TC-1", "TC-2"] },
    ]);
    expect(call.body.test_run.preserve_existing_results).toBe(true);
    expect(result.content?.[0]?.text).toContain("added 2");
  });

  it("honors the preserve_existing_results flag when adding", async () => {
    (apiClient.patch as any).mockResolvedValue({
      data: { success: true, async: true, unique_id: "def" },
    });

    const result = await updateTestRun(
      {
        project_identifier: "PR-1",
        test_run_id: "TR-9",
        test_run: {
          add_test_cases: [{ test_case_ids: ["TC-3"] }],
          preserve_existing_results: false,
        },
      },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    const call = (apiClient.patch as any).mock.calls[0][0];
    expect(call.url).toMatch(/\/test-runs\/TR-9\/test-cases$/);
    expect(call.body.test_run.preserve_existing_results).toBe(false);
    expect(result.content?.[0]?.text).toContain("added 1");
  });

  it("updates both metadata and test cases when both are provided", async () => {
    (apiClient.patch as any)
      .mockResolvedValueOnce({ data: { success: true, testrun: { name: "New" } } })
      .mockResolvedValueOnce({ data: { success: true, async: true, unique_id: "z" } });

    const result = await updateTestRun(
      {
        project_identifier: "PR-1",
        test_run_id: "TR-1",
        test_run: {
          name: "New",
          add_test_cases: [{ test_case_ids: ["TC-1"] }],
        },
      },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    expect(apiClient.patch).toHaveBeenCalledTimes(2);
    const urls = (apiClient.patch as any).mock.calls.map((c: any) => c[0].url);
    expect(urls.some((u: string) => /\/test-runs\/TR-1\/update$/.test(u))).toBe(true);
    expect(urls.some((u: string) => /\/test-runs\/TR-1\/test-cases$/.test(u))).toBe(true);
    const combined = (result.content ?? []).map((c: any) => c.text).join("\n");
    expect(combined).toContain("Successfully updated test run TR-1");
    expect(combined).toContain("added 1");
  });

  it("reports an error if one of the two updates fails", async () => {
    (apiClient.patch as any)
      .mockResolvedValueOnce({ data: { success: true, testrun: {} } })
      .mockResolvedValueOnce({ data: { success: false, error: "closed_run" } });

    const result = await updateTestRun(
      {
        project_identifier: "PR-1",
        test_run_id: "TR-1",
        test_run: {
          run_state: "in_progress",
          add_test_cases: [{ test_case_ids: ["TC-1"] }],
        },
      },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(apiClient.patch).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty update with no actionable fields", async () => {
    const result = await updateTestRun(
      {
        project_identifier: "PR-1",
        test_run_id: "TR-1",
        test_run: {},
      },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(result.content?.[0]?.text).toContain("Nothing to update");
  });

  it("surfaces an unsuccessful membership response as an error", async () => {
    (apiClient.patch as any).mockResolvedValue({
      data: { success: false, error: "closed_run" },
    });

    const result = await updateTestRun(
      {
        project_identifier: "PR-1",
        test_run_id: "TR-9",
        test_run: { add_test_cases: [{ test_case_ids: ["TC-1"] }] },
      },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(
      "Failed to update test run test cases",
    );
  });
});
