import { assertOkResponse, maybeCompressBase64 } from "../../lib/utils.js";
import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import globalConfig from "../../config.js";
import { getRegionalHost } from "../../lib/regional-host.js";
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

  const isAutomate = sessionType === SessionType.Automate;
  const host = getRegionalHost(isAutomate ? "automateApi" : "appAutomateApi");
  const baseUrl = `${host}/${isAutomate ? "automate" : "app-automate"}`;

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
  const buffer = Buffer.from(response.data);
  const base64 = await maybeCompressBase64(buffer.toString("base64"));
  // Detect AFTER compression: sharp re-encodes anything over 1 MB to PNG, so
  // reading the original bytes would label a large JPEG with the wrong type.
  return {
    url,
    base64,
    mimeType: detectImageMimeType(Buffer.from(base64, "base64")),
  };
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
