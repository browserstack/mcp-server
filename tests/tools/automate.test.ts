import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { fetchAutomationScreenshotsTool } from "../../src/tools/automate";
import { fetchAutomationScreenshots } from "../../src/tools/automate-utils/fetch-screenshots";
import { SessionType } from "../../src/lib/constants";

vi.mock("../../src/tools/automate-utils/fetch-screenshots", () => ({
  fetchAutomationScreenshots: vi.fn(),
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

describe("fetchAutomationScreenshotsTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SUCCESS: returns screenshots as image content", async () => {
    (fetchAutomationScreenshots as Mock).mockResolvedValue([
      { base64: "abc123", url: "https://example.com/1.png" },
      { base64: "def456", url: "https://example.com/2.png" },
    ]);

    const result = await fetchAutomationScreenshotsTool(
      { sessionId: "sess-123", sessionType: SessionType.Automate },
      mockConfig,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBe(3); // 1 text + 2 images
    expect(result.content[0].type).toBe("text");
    expect(result.content[1].type).toBe("image");
  });

  it("SUCCESS: returns isError when no screenshots found", async () => {
    (fetchAutomationScreenshots as Mock).mockResolvedValue([]);

    const result = await fetchAutomationScreenshotsTool(
      { sessionId: "sess-123", sessionType: SessionType.Automate },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No screenshots found");
  });

  it("FAIL: returns isError on API failure", async () => {
    (fetchAutomationScreenshots as Mock).mockRejectedValue(
      new Error("API error"),
    );

    const result = await fetchAutomationScreenshotsTool(
      { sessionId: "sess-123", sessionType: SessionType.Automate },
      mockConfig,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error");
  });
});
