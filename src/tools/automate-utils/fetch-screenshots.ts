import config from "../../config.js";
import { assertOkResponse, maybeCompressBase64 } from "../../lib/utils.js";
import { SessionType } from "../../lib/constants.js";

//Extracts screenshot URLs from BrowserStack session logs
async function extractScreenshotUrls(
  sessionId: string,
  sessionType: SessionType,
): Promise<string[]> {
  const credentials = `${config.browserstackUsername}:${config.browserstackAccessKey}`;
  const auth = Buffer.from(credentials).toString("base64");

  const baseUrl = `https://api.browserstack.com/${sessionType === SessionType.Automate ? "automate" : "app-automate"}`;

  const url = `${baseUrl}/sessions/${sessionId}/logs`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "Session");

  const text = await response.text();

  const urls: string[] = [];
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
        urls.push(match[1]);
      }
    }
  }

  return urls;
}

//Converts screenshot URLs to base64 encoded images
async function convertUrlsToBase64(
  urls: string[],
): Promise<Array<{ url: string; base64: string }>> {
  const screenshots = await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      // Compress the base64 image if needed
      const compressedBase64 = await maybeCompressBase64(base64);

      return {
        url,
        base64: compressedBase64,
      };
    }),
  );

  return screenshots;
}

//Fetches and converts screenshot URLs to base64 encoded images
export async function fetchAutomationScreenshots(
  sessionId: string,
  sessionType: SessionType = SessionType.Automate,
) {
  const urls = await extractScreenshotUrls(sessionId, sessionType);
  if (urls.length === 0) {
    return [];
  }

  // Take only the last 5 URLs
  const lastFiveUrls = urls.slice(-5);
  return await convertUrlsToBase64(lastFiveUrls);
}
