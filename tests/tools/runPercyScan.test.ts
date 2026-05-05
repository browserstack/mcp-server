import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { runPercyScan } from "../../src/tools/run-percy-scan";
import { storedPercyResults } from "../../src/lib/inmemory-store";
import { PercyIntegrationTypeEnum } from "../../src/tools/sdk-utils/common/types";

vi.mock("../../src/lib/inmemory-store", () => ({
  storedPercyResults: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("../../src/tools/sdk-utils/percy-web/constants", () => ({
  getFrameworkTestCommand: vi.fn().mockReturnValue("npx percy exec -- jest"),
  PERCY_FALLBACK_STEPS: ["Run percy scan with default settings"],
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

describe("runPercyScan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders PERCY_TOKEN setup instructions with placeholder", async () => {
    (storedPercyResults.get as Mock).mockReturnValue(null);

    const result = await runPercyScan(
      {
        projectName: "my-project",
        integrationType: PercyIntegrationTypeEnum.WEB,
      },
      mockConfig,
    );

    const text = result.content[0].text as string;
    expect(text).toContain("PERCY_TOKEN");
    expect(text).toContain("<your Percy project token>");
    expect(text).toContain(".env");
  });

  it("includes updated file instructions when available", async () => {
    (storedPercyResults.get as Mock).mockReturnValue({
      projectName: "my-project",
      testFiles: { "/tests/login.test.js": true },
      detectedLanguage: "javascript",
      detectedTestingFramework: "jest",
    });

    const result = await runPercyScan(
      {
        projectName: "my-project",
        integrationType: PercyIntegrationTypeEnum.WEB,
      },
      mockConfig,
    );

    const text = result.content[0].text as string;
    expect(text).toContain("Updated files to run");
  });

  it("includes custom instruction steps", async () => {
    (storedPercyResults.get as Mock).mockReturnValue(null);

    const result = await runPercyScan(
      {
        projectName: "my-project",
        integrationType: PercyIntegrationTypeEnum.WEB,
        instruction: "npx percy exec -- npx playwright test",
      },
      mockConfig,
    );

    const text = result.content[0].text as string;
    expect(text).toContain("npx percy exec");
  });
});
