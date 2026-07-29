import { assertOkResponse, maybeCompressBase64 } from "../../lib/utils.js";
import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";

async function extractScreenshotValues(
  sessionId: string,
  sessionType: SessionType,
  config: BrowserStackConfig,
): Promise<string[]> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const baseUrl = `https://api.browserstack.com/${sessionType === SessionType.Automate ? "automate" : "app-automate"}`;

  const url = `${baseUrl}/sessions/${sessionId}/logs`;
  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    raise_error: false,
  });

  await assertOkResponse(response, "Session");

  const text =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);

  const values: string[] = [];
  const SCREENSHOT_PATTERN = /REQUEST.*GET.*\/screenshot/;
  const RESPONSE_VALUE_PATTERN = /"value"\s*:\s*"([^"]+)"/;

  // Split logs into lines and process them
  const lines = text.split("\n");

  for (let i = 0; i < lines.length - 1; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1];

    if (SCREENSHOT_PATTERN.test(currentLine)) {
      const match = nextLine.match(RESPONSE_VALUE_PATTERN);
      if (match && match[1]) {
        values.push(match[1]);
      }
    }
  }

  return values;
}

const PNG_BASE64_PREFIX = "iVBORw0KGgo";
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

function extractInlinePngBase64(value: string): string | undefined {
  const base64 = value.startsWith(PNG_DATA_URL_PREFIX)
    ? value.slice(PNG_DATA_URL_PREFIX.length)
    : value;

  return base64.startsWith(PNG_BASE64_PREFIX) ? base64 : undefined;
}

// Converts screenshot URLs or inline Playwright PNG values to base64 images.
async function convertScreenshotValuesToBase64(
  values: string[],
): Promise<Array<{ url?: string; base64: string }>> {
  const screenshots = await Promise.all(
    values.map(async (value) => {
      const inlineBase64 = extractInlinePngBase64(value);
      if (inlineBase64) {
        return {
          base64: await maybeCompressBase64(inlineBase64),
        };
      }

      const response = await apiClient.get({
        url: value,
        responseType: "arraybuffer",
      });
      // Axios returns response.data as a Buffer for binary data
      const base64 = Buffer.from(response.data).toString("base64");

      // Compress the base64 image if needed
      const compressedBase64 = await maybeCompressBase64(base64);

      return {
        url: value,
        base64: compressedBase64,
      };
    }),
  );

  return screenshots;
}

// Fetches and converts screenshot URLs or inline PNG values to base64 images.
export async function fetchAutomationScreenshots(
  sessionId: string,
  sessionType: SessionType = SessionType.Automate,
  config: BrowserStackConfig,
) {
  const values = await extractScreenshotValues(sessionId, sessionType, config);
  if (values.length === 0) {
    return [];
  }

  // Take only the last 5 screenshots
  const lastFiveValues = values.slice(-5);
  return await convertScreenshotValuesToBase64(lastFiveValues);
}
