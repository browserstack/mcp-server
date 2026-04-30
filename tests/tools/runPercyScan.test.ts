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

  // SECURITY (HackerOne #3576387): the Percy token is fetched from a privileged
  // BrowserStack backend and must never appear in tool output text.
  it("SECURITY: never echoes the fetched Percy token in output", async () => {
    const SECRET = "percy-secret-token-DO-NOT-LEAK";
    (fetchPercyToken as Mock).mockResolvedValue(SECRET);
    (storedPercyResults.get as Mock).mockReturnValue(null);

    const result = await runPercyScan(
      {
        projectName: "my-project",
        integrationType: PercyIntegrationTypeEnum.WEB,
      },
      mockConfig,
    );

    const text = result.content[0].text as string;
    expect(text).not.toContain(SECRET);
    // Output should still mention PERCY_TOKEN as the env var name and use a
    // placeholder so users know what to set.
    expect(text).toContain("PERCY_TOKEN");
    expect(text).toContain("<your Percy project token>");
  });

  it("SUCCESS: includes updated file instructions when available", async () => {
    const SECRET = "percy-secret-token-DO-NOT-LEAK";
    (fetchPercyToken as Mock).mockResolvedValue(SECRET);
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
    expect(text).not.toContain(SECRET);
    expect(text).toContain("Updated files to run");
  });

  it("SUCCESS: includes custom instruction steps", async () => {
    const SECRET = "percy-secret-token-DO-NOT-LEAK";
    (fetchPercyToken as Mock).mockResolvedValue(SECRET);
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
    expect(text).not.toContain(SECRET);
    expect(text).toContain("npx percy exec");
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
