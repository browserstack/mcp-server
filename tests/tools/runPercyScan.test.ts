import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { runPercyScan } from "../../src/tools/run-percy-scan";
import { fetchPercyToken } from "../../src/tools/sdk-utils/percy-web/fetchPercyToken";
import { storedPercyResults } from "../../src/lib/inmemory-store";
import { PercyIntegrationTypeEnum } from "../../src/tools/sdk-utils/common/types";

vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn().mockReturnValue("fake-user:fake-key"),
}));
vi.mock("../../src/tools/sdk-utils/percy-web/fetchPercyToken", () => ({
  fetchPercyToken: vi.fn(),
}));
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

  it("SUCCESS: returns Percy token and run instructions", async () => {
    (fetchPercyToken as Mock).mockResolvedValue("percy-token-abc");
    (storedPercyResults.get as Mock).mockReturnValue(null);

    const result = await runPercyScan(
      {
        projectName: "my-project",
        integrationType: PercyIntegrationTypeEnum.WEB,
      },
      mockConfig,
    );

    expect(result.content[0].text).toContain("percy-token-abc");
    expect(result.content[0].text).toContain("PERCY_TOKEN");
  });

  it("SUCCESS: includes updated file instructions when available", async () => {
    (fetchPercyToken as Mock).mockResolvedValue("percy-token-abc");
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

    expect(result.content[0].text).toContain("percy-token-abc");
  });

  it("SUCCESS: includes custom instruction steps", async () => {
    (fetchPercyToken as Mock).mockResolvedValue("percy-token-abc");
    (storedPercyResults.get as Mock).mockReturnValue(null);

    const result = await runPercyScan(
      {
        projectName: "my-project",
        integrationType: PercyIntegrationTypeEnum.WEB,
        instruction: "npx percy exec -- npx playwright test",
      },
      mockConfig,
    );

    expect(result.content[0].text).toContain("percy-token-abc");
    expect(result.content[0].text).toContain("npx percy exec");
  });

  it("FAIL: throws when Percy token fetch fails", async () => {
    (fetchPercyToken as Mock).mockRejectedValue(
      new Error("Percy token not found"),
    );
    (storedPercyResults.get as Mock).mockReturnValue(null);

    await expect(
      runPercyScan(
        {
          projectName: "bad-project",
          integrationType: PercyIntegrationTypeEnum.WEB,
        },
        mockConfig,
      ),
    ).rejects.toThrow("Percy token not found");
  });
});
