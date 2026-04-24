import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import {
  getBuildIdTool,
  fetchRCADataTool,
  listTestIdsTool,
} from "../../src/tools/rca-agent";
import { getBuildId } from "../../src/tools/rca-agent-utils/get-build-id";
import { getTestIds } from "../../src/tools/rca-agent-utils/get-failed-test-id";
import { getRCAData } from "../../src/tools/rca-agent-utils/rca-data";
import { formatRCAData } from "../../src/tools/rca-agent-utils/format-rca";
import { getBrowserStackAuth } from "../../src/lib/get-auth";

vi.mock("../../src/tools/rca-agent-utils/get-build-id", () => ({
  getBuildId: vi.fn(),
}));
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
      (getBuildId as Mock).mockResolvedValue("build-abc-123");

      const result = await getBuildIdTool(
        {
          browserStackProjectName: "MyProject",
          browserStackBuildName: "MyBuild",
        },
        mockConfig,
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe("build-abc-123");
      expect(getBrowserStackAuth).toHaveBeenCalledWith(mockConfig);
    });

    it("FAIL: returns isError on API failure", async () => {
      (getBuildId as Mock).mockRejectedValue(new Error("Not found"));

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

    it("FAIL: returns isError on API failure", async () => {
      (getTestIds as Mock).mockRejectedValue(new Error("Invalid build"));

      const result = await listTestIdsTool(
        { buildId: "invalid" },
        mockConfig,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error listing test IDs");
    });
  });

  describe("fetchRCADataTool", () => {
    it("SUCCESS: returns formatted RCA data", async () => {
      (getRCAData as Mock).mockResolvedValue({ analysis: "root cause" });
      (formatRCAData as Mock).mockReturnValue("Formatted RCA: root cause");

      const result = await fetchRCADataTool(
        { testId: [101] },
        mockConfig,
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe("Formatted RCA: root cause");
    });

    it("FAIL: returns isError on API failure", async () => {
      (getRCAData as Mock).mockRejectedValue(new Error("RCA failed"));

      const result = await fetchRCADataTool(
        { testId: [999] },
        mockConfig,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error fetching RCA data");
    });
  });
});
