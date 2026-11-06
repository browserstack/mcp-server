import { HttpError } from "../../src/lib/error";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import {
  getBuildIdTool,
  fetchRCADataTool,
  listTestIdsTool,
  listBuildIdTool,
} from "../../src/tools/rca-agent";
import { resolveBuild } from "../../src/tools/rca-agent-utils/resolve-build";
import { mapHashedToTra } from "../../src/tools/automate-utils/resolve-tra-build-id";
import { getTestIds } from "../../src/tools/rca-agent-utils/get-failed-test-id";
import { getRCAData } from "../../src/tools/rca-agent-utils/rca-data";
import { formatRCAData } from "../../src/tools/rca-agent-utils/format-rca";
import { getBrowserStackAuth } from "../../src/lib/get-auth";
import { TestStatus } from "../../src/tools/rca-agent-utils/types";

vi.mock(
  "../../src/tools/rca-agent-utils/resolve-build",
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    resolveBuild: vi.fn(),
  }),
);
vi.mock(
  "../../src/tools/automate-utils/resolve-tra-build-id",
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    mapHashedToTra: vi.fn(),
  }),
);
vi.mock("../../src/tools/rca-agent-utils/get-failed-test-id", () => ({
  getTestIds: vi.fn(),
}));
vi.mock("../../src/tools/rca-agent-utils/rca-data", () => ({
  getRCAData: vi.fn(),
}));
vi.mock("../../src/tools/rca-agent-utils/format-rca", () => ({
  formatRCAData: vi.fn(),
}));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("fake-user:fake-key"),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

describe("RCA Agent Tools", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("getBuildIdTool", () => {
    it("SUCCESS: returns build ID string", async () => {
      (resolveBuild as Mock).mockResolvedValue({ buildId: "build-abc-123" });

      const result = await getBuildIdTool(
        {
          browserStackProjectName: "MyProject",
          browserStackBuildName: "MyBuild",
        },
        mockConfig,
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe("build-abc-123");
      expect(result.content).toHaveLength(1);
      expect(getBrowserStackAuth).toHaveBeenCalledWith(mockConfig);
      // Prefers the caller's own builds.
      expect((resolveBuild as Mock).mock.calls[0][2]).toEqual({
        userName: "fake-user",
      });
    });

    it("FAIL: returns isError on API failure", async () => {
      (resolveBuild as Mock).mockRejectedValue(new Error("Not found"));

      const result = await getBuildIdTool(
        {
          browserStackProjectName: "Bad",
          browserStackBuildName: "Bad",
        },
        mockConfig,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error fetching build ID");
    });
  });

  describe("listTestIdsTool", () => {
    it("SUCCESS: returns test IDs as JSON", async () => {
      (getTestIds as Mock).mockResolvedValue([101, 102, 103]);

      const result = await listTestIdsTool(
        { buildId: "build-123" },
        mockConfig,
      );

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([101, 102, 103]);
    });

    it("SUCCESS: defaults includeFailureDetail to undefined when omitted", async () => {
      (getTestIds as Mock).mockResolvedValue([
        { test_id: 101, test_name: "a" },
      ]);

      await listTestIdsTool(
        { buildId: "build-123", status: TestStatus.FAILED },
        mockConfig,
      );

      expect(getTestIds).toHaveBeenCalledWith(
        "build-123",
        "fake-user:fake-key",
        TestStatus.FAILED,
        undefined,
      );
    });

    it("SUCCESS: threads includeFailureDetail through to getTestIds", async () => {
      (getTestIds as Mock).mockResolvedValue([
        { test_id: 101, test_name: "a", failure: { category: "Assertion" } },
      ]);

      const result = await listTestIdsTool(
        {
          buildId: "build-123",
          status: TestStatus.FAILED,
          includeFailureDetail: true,
        },
        mockConfig,
      );

      expect(getTestIds).toHaveBeenCalledWith(
        "build-123",
        "fake-user:fake-key",
        TestStatus.FAILED,
        true,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].failure.category).toBe("Assertion");
    });

    it("SUCCESS: maps an Automate hashed id to its TRA build on 404", async () => {
      const hashed = "ca9cccc228cf0e3ff3cb90dd62e2e2bfb4b20bc7";
      (getTestIds as Mock)
        .mockRejectedValueOnce(
          new HttpError("Failed to fetch test runs: 404 Not Found", 404),
        )
        .mockResolvedValueOnce([{ test_id: "1" }]);
      (mapHashedToTra as Mock).mockResolvedValue({ traBuildId: "tra-build-1" });

      const result = await listTestIdsTool({ buildId: hashed }, mockConfig);

      expect(result.isError).toBeFalsy();
      expect((getTestIds as Mock).mock.calls[1][0]).toBe("tra-build-1");
      expect(result.content[1].text).toContain("maps to TRA build tra-build-1");
    });

    it("FAIL: does not map non-hex ids on 404", async () => {
      (getTestIds as Mock).mockRejectedValue(
        new HttpError("Failed to fetch test runs: 404 Not Found", 404),
      );

      const result = await listTestIdsTool(
        { buildId: "jlcb5jo8xakocnjyll3n10b1rx5sqnrprh3y6zsp" },
        mockConfig,
      );

      expect(result.isError).toBe(true);
      expect(mapHashedToTra).not.toHaveBeenCalled();
    });

    it("FAIL: returns isError on API failure", async () => {
      (getTestIds as Mock).mockRejectedValue(new Error("Invalid build"));

      const result = await listTestIdsTool({ buildId: "invalid" }, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error listing test IDs");
    });
  });

  describe("listBuildIdTool", () => {
    it("SUCCESS: returns build ID string (all users, no user filter)", async () => {
      (resolveBuild as Mock).mockResolvedValue({
        buildId: "build-xyz-789",
        note: 'Found "junit" #3 by its dashboard name.',
      });

      const result = await listBuildIdTool(
        {
          browserStackProjectName: "MyProject",
          browserStackBuildName: "MyBuild",
        },
        mockConfig,
      );

      expect(result.isError).toBeFalsy();
      // The id stays alone in content[0]; how it was found follows.
      expect(result.content[0].text).toBe("build-xyz-789");
      expect(result.content[1].text).toContain("dashboard name");
      expect((resolveBuild as Mock).mock.calls[0][2]).toBeUndefined();
    });

    it("FAIL: returns isError on API failure", async () => {
      (resolveBuild as Mock).mockRejectedValue(new Error("Not found"));

      const result = await listBuildIdTool(
        {
          browserStackProjectName: "Bad",
          browserStackBuildName: "Bad",
        },
        mockConfig,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error fetching build ID");
    });
  });

  describe("fetchRCADataTool", () => {
    it("SUCCESS: returns formatted RCA data", async () => {
      (getRCAData as Mock).mockResolvedValue({ analysis: "root cause" });
      (formatRCAData as Mock).mockReturnValue("Formatted RCA: root cause");

      const result = await fetchRCADataTool({ testId: [101] }, mockConfig);

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe("Formatted RCA: root cause");
    });

    it("FAIL: returns isError on API failure", async () => {
      (getRCAData as Mock).mockRejectedValue(new Error("RCA failed"));

      const result = await fetchRCADataTool({ testId: [999] }, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error fetching RCA data");
    });
  });
});
