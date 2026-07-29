import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { apiClient } from "../../src/lib/apiClient";
import { SessionType } from "../../src/lib/constants";
import { fetchAutomationScreenshots } from "../../src/tools/automate-utils/fetch-screenshots";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

function sessionLogWithScreenshotValue(value: string): string {
  return [
    "REQUEST GET /session/sess-123/screenshot {}",
    `RESPONSE {"value":"${value}"}`,
  ].join("\n");
}

describe("fetchAutomationScreenshots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns inline Playwright PNG screenshot values without fetching them as URLs", async () => {
    const inlinePng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]).toString("base64");

    (apiClient.get as Mock).mockResolvedValueOnce({
      ok: true,
      data: sessionLogWithScreenshotValue(inlinePng),
    });

    await expect(
      fetchAutomationScreenshots(
        "sess-123",
        SessionType.Automate,
        mockConfig,
      ),
    ).resolves.toEqual([{ base64: inlinePng }]);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("continues to fetch screenshot URL values", async () => {
    const screenshotUrl = "https://example.com/screenshot.png";
    const screenshotBytes = Buffer.from("png-bytes");

    (apiClient.get as Mock)
      .mockResolvedValueOnce({
        ok: true,
        data: sessionLogWithScreenshotValue(screenshotUrl),
      })
      .mockResolvedValueOnce({ data: screenshotBytes });

    await expect(
      fetchAutomationScreenshots(
        "sess-123",
        SessionType.Automate,
        mockConfig,
      ),
    ).resolves.toEqual([
      {
        url: screenshotUrl,
        base64: screenshotBytes.toString("base64"),
      },
    ]);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, {
      url: screenshotUrl,
      responseType: "arraybuffer",
    });
  });
});
