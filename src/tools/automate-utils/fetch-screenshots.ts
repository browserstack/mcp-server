import { assertOkResponse, maybeCompressBase64 } from "../../lib/utils.js";
import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import globalConfig from "../../config.js";
import { MAX_LOG_BYTES } from "../failurelogs-utils/utils.js";

export const MAX_SCREENSHOT_BYTES = globalConfig.REMOTE_MCP
  ? 10 * 1024 * 1024
  : undefined;

async function extractScreenshotUrls(
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
    maxContentLength: MAX_LOG_BYTES,
    raise_error: false,
  });

  if (response.status === 413) {
    throw new Error(
      "The logs for this session are too large (over 5 MB) to find screenshots here. Open the session in the BrowserStack dashboard to view them.",
    );
  }
  await assertOkResponse(response, "Session");

  const text =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);

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

type Screenshot = { url: string; base64: string };

// Returns null for a screenshot over MAX_SCREENSHOT_BYTES so the rest still load.
async function fetchAndCompress(url: string): Promise<Screenshot | null> {
  const response = await apiClient.get({
    url,
    responseType: "arraybuffer",
    maxContentLength: MAX_SCREENSHOT_BYTES,
    raise_error: false,
  });
  if (response.status === 413) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download screenshot: ${response.status} ${response.statusText}`,
    );
  }
  // Axios returns response.data as a Buffer for binary data
  const base64 = Buffer.from(response.data).toString("base64");
  return { url, base64: await maybeCompressBase64(base64) };
}

//Converts screenshot URLs to base64 encoded images
async function convertUrlsToBase64(urls: string[]): Promise<Screenshot[]> {
  let results: Array<Screenshot | null>;
  // Hosted pods are memory-constrained: process one image at a time. Local runs
  // keep the concurrent path.
  if (globalConfig.REMOTE_MCP) {
    results = [];
    for (const url of urls) {
      results.push(await fetchAndCompress(url));
    }
  } else {
    results = await Promise.all(urls.map(fetchAndCompress));
  }

  const screenshots = results.filter((s): s is Screenshot => s !== null);
  if (urls.length > 0 && screenshots.length === 0) {
    throw new Error(
      "The screenshots in this session are too large (over 10 MB each) to fetch here. Open the session in the BrowserStack dashboard to view them.",
    );
  }
  return screenshots;
}

//Fetches and converts screenshot URLs to base64 encoded images
export async function fetchAutomationScreenshots(
  sessionId: string,
  sessionType: SessionType = SessionType.Automate,
  config: BrowserStackConfig,
) {
  const urls = await extractScreenshotUrls(sessionId, sessionType, config);
  if (urls.length === 0) {
    return [];
  }

  // Take only the last 5 URLs
  const lastFiveUrls = urls.slice(-5);
  return await convertUrlsToBase64(lastFiveUrls);
}
