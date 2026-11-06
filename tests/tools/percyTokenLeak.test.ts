import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { runPercyWeb } from "../../src/tools/sdk-utils/percy-web/handler";
import { runPercyAutomateOnly } from "../../src/tools/sdk-utils/percy-automate/handler";
import { runPercyScan } from "../../src/tools/run-percy-scan";
import { storedPercyResults } from "../../src/lib/inmemory-store";
import {
  PercyIntegrationTypeEnum,
  SDKSupportedLanguageEnum,
  SDKSupportedBrowserAutomationFrameworkEnum,
  SDKSupportedTestingFrameworkEnum,
} from "../../src/tools/sdk-utils/common/types";

vi.mock("../../src/lib/inmemory-store", () => ({
  storedPercyResults: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("../../src/tools/sdk-utils/percy-web/constants", async (importOriginal) => {
  // Preserve real instruction strings (consumed by frameworks.ts at load
  // time) and override only the two symbols runPercyScan reaches for.
  const actual = await importOriginal<
    typeof import("../../src/tools/sdk-utils/percy-web/constants")
  >();
  return {
    ...actual,
    getFrameworkTestCommand: vi.fn().mockReturnValue("npx percy exec -- jest"),
    PERCY_FALLBACK_STEPS: ["Run percy scan with default settings"],
  };
});
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const LEAKED_PERCY_TOKEN_RE =
  /PERCY_TOKEN\s*=\s*["']?[A-Za-z0-9_-]{16,}["']?/;
const TOKEN_PLACEHOLDER = "<your Percy project token>";

// Walk strings/arrays/objects and concatenate every string so the guard
// covers structured payloads (e.g. CallToolResult.content) too.
function flattenContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenContent).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map(flattenContent)
      .join("\n");
  }
  return "";
}

describe("PERCY_TOKEN leak — no Percy setup handler echoes a real token", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runPercyWeb emits only the placeholder, never a high-entropy token literal", () => {
    const result = runPercyWeb({
      projectName: "test",
      detectedLanguage: SDKSupportedLanguageEnum.nodejs,
      detectedBrowserAutomationFramework:
        SDKSupportedBrowserAutomationFrameworkEnum.selenium,
      detectedTestingFramework: SDKSupportedTestingFrameworkEnum.jest,
      integrationType: PercyIntegrationTypeEnum.WEB,
    });
    const text = flattenContent(result.steps);
    expect(text).not.toMatch(LEAKED_PERCY_TOKEN_RE);
    expect(text).toContain(TOKEN_PLACEHOLDER);
  });

  it("runPercyAutomateOnly emits only the placeholder, never a high-entropy token literal", () => {
    const result = runPercyAutomateOnly({
      projectName: "test",
      detectedLanguage: SDKSupportedLanguageEnum.python,
      detectedBrowserAutomationFramework:
        SDKSupportedBrowserAutomationFrameworkEnum.selenium,
      detectedTestingFramework: SDKSupportedTestingFrameworkEnum.pytest,
      integrationType: PercyIntegrationTypeEnum.AUTOMATE,
    });
    const text = flattenContent(result.steps);
    expect(text).not.toMatch(LEAKED_PERCY_TOKEN_RE);
    expect(text).toContain(TOKEN_PLACEHOLDER);
  });

  it("runPercyScan emits only the placeholder, never a high-entropy token literal", async () => {
    (storedPercyResults.get as Mock).mockReturnValue(null);
    const result = await runPercyScan({
      projectName: "test",
      integrationType: PercyIntegrationTypeEnum.WEB,
    });
    const text = flattenContent(result.content);
    expect(text).not.toMatch(LEAKED_PERCY_TOKEN_RE);
    expect(text).toContain(TOKEN_PLACEHOLDER);
  });

  // Sanity-check the guard regex itself so a typo can't silently let leaks
  // through. The placeholder must NOT trip the regex; a realistic token must.
  it("LEAKED_PERCY_TOKEN_RE catches a real-looking token and ignores the placeholder", () => {
    expect('export PERCY_TOKEN="abc123_xyz_secretvalue_456789"').toMatch(
      LEAKED_PERCY_TOKEN_RE,
    );
    expect("PERCY_TOKEN=abcdef0123456789ABCDEF").toMatch(
      LEAKED_PERCY_TOKEN_RE,
    );
    expect(`PERCY_TOKEN=${TOKEN_PLACEHOLDER}`).not.toMatch(
      LEAKED_PERCY_TOKEN_RE,
    );
  });
});
