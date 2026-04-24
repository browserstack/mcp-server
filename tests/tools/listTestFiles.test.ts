import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { addListTestFiles } from "../../src/tools/list-test-files";
import { storedPercyResults } from "../../src/lib/inmemory-store";
import { listTestFiles } from "../../src/tools/percy-snapshot-utils/detect-test-files";
import { updateFileAndStep } from "../../src/tools/percy-snapshot-utils/utils";

vi.mock("../../src/lib/inmemory-store", () => ({
  storedPercyResults: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("../../src/tools/percy-snapshot-utils/detect-test-files", () => ({
  listTestFiles: vi.fn(),
}));
vi.mock("../../src/tools/percy-snapshot-utils/utils", () => ({
  updateFileAndStep: vi.fn(),
}));
vi.mock("../../src/tools/sdk-utils/percy-web/handler", () => ({
  percyWebSetupInstructions: [],
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("addListTestFiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SUCCESS: lists multiple test files and stores them", async () => {
    (storedPercyResults.get as Mock).mockReturnValue({
      detectedLanguage: "javascript",
      detectedTestingFramework: "jest",
      folderPaths: ["/src/tests"],
      filePaths: [],
    });
    (listTestFiles as Mock).mockResolvedValue([
      "/src/tests/a.test.js",
      "/src/tests/b.test.js",
    ]);

    const result = await addListTestFiles();

    expect(result.content[0].text).toContain("2");
    expect(storedPercyResults.set).toHaveBeenCalled();
  });

  it("SUCCESS: handles single test file with updateFileAndStep", async () => {
    (storedPercyResults.get as Mock).mockReturnValue({
      detectedLanguage: "javascript",
      detectedTestingFramework: "jest",
      folderPaths: [],
      filePaths: ["/src/tests/only.test.js"],
    });
    (updateFileAndStep as Mock).mockResolvedValue([
      { type: "text", text: "Updated file" },
    ]);

    const result = await addListTestFiles();

    expect(updateFileAndStep).toHaveBeenCalledWith(
      "/src/tests/only.test.js",
      0,
      1,
      expect.anything(),
    );
    expect(result.content).toEqual([{ type: "text", text: "Updated file" }]);
  });

  it("FAIL: throws when no stored Percy results", async () => {
    (storedPercyResults.get as Mock).mockReturnValue(null);

    await expect(addListTestFiles()).rejects.toThrow(
      "No Framework details found",
    );
  });

  it("FAIL: throws when no test files found", async () => {
    (storedPercyResults.get as Mock).mockReturnValue({
      detectedLanguage: "javascript",
      detectedTestingFramework: "jest",
      folderPaths: ["/empty"],
      filePaths: [],
    });
    (listTestFiles as Mock).mockResolvedValue([]);

    await expect(addListTestFiles()).rejects.toThrow("No test files found");
  });
});
