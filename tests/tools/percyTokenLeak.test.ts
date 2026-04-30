// Regression tests for HackerOne #3576387: the Percy token is fetched from a
// privileged BrowserStack backend and must never appear in any tool output.
// These tests pin the contract for the two SDK handlers so the leak cannot
// silently return.
import { describe, it, expect } from "vitest";
import { runPercyWeb } from "../../src/tools/sdk-utils/percy-web/handler";
import { runPercyAutomateOnly } from "../../src/tools/sdk-utils/percy-automate/handler";
import { PercyIntegrationTypeEnum } from "../../src/tools/sdk-utils/common/types";

const SECRET = "percy-secret-token-DO-NOT-LEAK-abc123";

const collectStepText = (steps: any[] | undefined): string =>
  (steps ?? []).map((s) => s?.content ?? "").join("\n");

describe("Percy SDK handlers — no token leakage", () => {
  it("runPercyWeb does not echo the Percy token in any step", () => {
    const result = runPercyWeb(
      {
        projectName: "demo",
        detectedLanguage: "nodejs",
        detectedBrowserAutomationFramework: "playwright",
        detectedTestingFramework: "jest",
        integrationType: PercyIntegrationTypeEnum.WEB,
        folderPaths: [],
        filePaths: [],
      } as any,
      SECRET,
    );

    const text = collectStepText(result.steps);
    expect(text).not.toContain(SECRET);
    expect(text).toContain("PERCY_TOKEN");
    expect(text).toContain("<your Percy project token>");
  });

  it("runPercyAutomateOnly does not echo the Percy token in any step", () => {
    const result = runPercyAutomateOnly(
      {
        projectName: "demo",
        detectedLanguage: "nodejs",
        detectedBrowserAutomationFramework: "selenium",
        detectedTestingFramework: "jest",
        integrationType: PercyIntegrationTypeEnum.AUTOMATE,
        folderPaths: [],
        filePaths: [],
      } as any,
      SECRET,
    );

    const text = collectStepText(result.steps);
    expect(text).not.toContain(SECRET);
    expect(text).toContain("PERCY_TOKEN");
  });
});
