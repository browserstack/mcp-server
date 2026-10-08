import { apiClient, type ApiResponse } from "../../lib/apiClient.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";

// Session logs can run to hundreds of MB. Buffering, re-stringifying and
// splitting one in memory can exhaust the server's memory, so cap the
// download (axios aborts past it) and the size of what we return.
export const MAX_LOG_BYTES = 10 * 1024 * 1024;
export const MAX_FAILURE_ITEMS = 200;
export const MAX_LINE_CHARS = 2000;

export interface LogResponse {
  logs?: any[];
  message?: string;
}

export interface HarFile {
  log: {
    entries: HarEntry[];
  };
}

export interface HarEntry {
  startedDateTime: string;
  request: {
    method: string;
    url: string;
    queryString?: { name: string; value: string }[];
  };
  response: {
    status: number;
    statusText?: string;
    _error?: string;
  };
  serverIPAddress?: string;
  time?: number;
}

export function validateLogResponse(
  response: Response | ApiResponse,
  logType: string,
): LogResponse | null {
  if (!response.ok) {
    if (response.status === 404) {
      return { message: `No ${logType} available for this session` };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        message: `Unable to access ${logType} - please check your credentials`,
      };
    }
    return { message: `Unable to fetch ${logType} at this time` };
  }
  return null;
}

export async function fetchLog(
  url: string,
  logType: string,
  config: BrowserStackConfig,
): Promise<{ data: any } | { message: string }> {
  const auth = Buffer.from(getBrowserStackAuth(config)).toString("base64");
  try {
    const response = await apiClient.get({
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      maxContentLength: MAX_LOG_BYTES,
      raise_error: false,
    });
    const validationError = validateLogResponse(response, logType);
    if (validationError) return { message: validationError.message! };
    return { data: response.data };
  } catch (error: any) {
    if (/maxContentLength/.test(error?.message ?? "")) {
      return {
        message: `The ${logType} for this session are larger than ${MAX_LOG_BYTES / (1024 * 1024)} MB, too large to analyze here. Open the session in the BrowserStack dashboard to view them.`,
      };
    }
    throw error;
  }
}

export function logDataToText(data: unknown): string {
  return typeof data === "string" ? data : JSON.stringify(data);
}

export function filterLinesByKeywords(
  logText: string,
  keywords: string[],
): string[] {
  const matches: string[] = [];
  for (const rawLine of logText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const lower = line.toLowerCase();
    if (keywords.some((keyword) => lower.includes(keyword))) {
      matches.push(line);
    }
  }
  return matches;
}

/**
 * Format matched failures for the client, keeping at most MAX_FAILURE_ITEMS
 * items and MAX_LINE_CHARS per string item.
 */
export function formatFailures(
  title: string,
  logLabel: string,
  items: unknown[],
): string {
  const shown = items
    .slice(0, MAX_FAILURE_ITEMS)
    .map((item) =>
      typeof item === "string" && item.length > MAX_LINE_CHARS
        ? `${item.slice(0, MAX_LINE_CHARS)}… [line truncated]`
        : item,
    );
  const omitted = items.length - shown.length;
  const note =
    omitted > 0
      ? `\nShowing the first ${shown.length}; ${omitted} more not shown.`
      : "";
  return `${title} (${items.length} found):\n${wrapUntrusted(logLabel, JSON.stringify(shown, null, 2))}${note}`;
}
