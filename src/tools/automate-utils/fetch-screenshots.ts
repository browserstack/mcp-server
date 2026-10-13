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

const LOG_PREFIX = String.raw`^\d{4}-\d{2}-\d{2} \d{1,2}:\d{1,2}:\d{1,2}:\d{1,3} `;
const LINE_TYPE_PATTERN = new RegExp(`${LOG_PREFIX}([A-Z_]+) `);
const SCREENSHOT_REQUEST_PATTERN = new RegExp(
  String.raw`${LOG_PREFIX}REQUEST \[[^\]]+\] GET /session/[^/\s]+/screenshot(\s|$)`,
);
const RESPONSE_VALUE_PATTERN = new RegExp(
  String.raw`${LOG_PREFIX}RESPONSE \{"value"\s*:\s*"(https://[^"]+)"`,
);
const DEBUG_SCREENSHOT_PATTERN = new RegExp(
  String.raw`${LOG_PREFIX}DEBUG (https://\S+)$`,
);
const TRUSTED_HOST_PATTERN =
  /(^|\.)browserstack\.com$|\.s3([.-][a-z0-9-]+)*\.amazonaws\.com$|\.backblazeb2\.com$/;

function isTrustedScreenshotUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && TRUSTED_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

export function parseScreenshotUrls(text: string): string[] {
  const urls: string[] = [];
  const lines = text.split("\n").map((line) => line.trimEnd());

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
      const lineType = lines[j].match(LINE_TYPE_PATTERN)?.[1];
      if (lineType === "REQUEST") {
        break;
      }
      if (lineType === "RESPONSE") {
        const valueMatch = lines[j].match(RESPONSE_VALUE_PATTERN);
        if (valueMatch) {
          urls.push(valueMatch[1]);
        }
        break;
      }
    }
  }

  return [...new Set(urls)].filter(isTrustedScreenshotUrl);
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
