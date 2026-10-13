import { assertOkResponse, maybeCompressBase64 } from "../../lib/utils.js";
import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import globalConfig from "../../config.js";

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
    raise_error: false,
  });

  await assertOkResponse(response, "Session");

  const text =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);

  return parseScreenshotUrls(text);
}

const SCREENSHOT_REQUEST_PATTERN = /REQUEST.*GET.*\/screenshot/;
const RESPONSE_VALUE_PATTERN = /RESPONSE.*"value"\s*:\s*"([^"]+)"/;
const DEBUG_SCREENSHOT_PATTERN = /\sDEBUG\s+(https?:\/\/\S+)/;

// Collects, in log order, screenshots requested by the test (REQUEST GET
// /screenshot followed by its RESPONSE) and visual-log screenshots captured
// with browserstack.debug (DEBUG <url>).
export function parseScreenshotUrls(text: string): string[] {
  const urls: string[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const debugMatch = line.match(DEBUG_SCREENSHOT_PATTERN);
    if (debugMatch) {
      urls.push(debugMatch[1]);
      continue;
    }

    if (!SCREENSHOT_REQUEST_PATTERN.test(line)) {
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].includes(" REQUEST ")) {
        break;
      }
      const valueMatch = lines[j].match(RESPONSE_VALUE_PATTERN);
      if (valueMatch) {
        urls.push(valueMatch[1]);
        break;
      }
    }
  }

  return [...new Set(urls)];
}

function detectImageMimeType(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  return "image/png";
}

export type Screenshot = { url: string; base64: string; mimeType: string };

async function fetchAndCompress(url: string): Promise<Screenshot> {
  const response = await apiClient.get({ url, responseType: "arraybuffer" });
  // Axios returns response.data as a Buffer for binary data
  const buffer = Buffer.from(response.data);
  const base64 = await maybeCompressBase64(buffer.toString("base64"));
  return {
    url,
    base64,
    mimeType: detectImageMimeType(Buffer.from(base64, "base64")),
  };
}

//Converts screenshot URLs to base64 encoded images
async function convertUrlsToBase64(urls: string[]): Promise<Screenshot[]> {
  // Hosted pods are memory-constrained: process one image at a time. Local runs
  // keep the concurrent path.
  if (globalConfig.REMOTE_MCP) {
    const screenshots: Screenshot[] = [];
    for (const url of urls) {
      screenshots.push(await fetchAndCompress(url));
    }
    return screenshots;
  }

  return Promise.all(urls.map(fetchAndCompress));
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
