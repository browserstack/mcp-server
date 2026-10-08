import {
  HarEntry,
  HarFile,
  fetchLog,
  filterLinesByKeywords,
  formatFailures,
  logDataToText,
} from "./utils.js";
import { BrowserStackConfig } from "../../lib/types.js";

// NETWORK LOGS
export async function retrieveNetworkFailures(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/networklogs`;
  const result = await fetchLog(url, "network logs", config);
  if ("message" in result) return result.message;

  const networklogs: HarFile = result.data;
  const failureEntries: HarEntry[] = (networklogs?.log?.entries ?? []).filter(
    (entry: HarEntry) =>
      entry.response.status === 0 ||
      entry.response.status >= 400 ||
      entry.response._error !== undefined,
  );

  return failureEntries.length > 0
    ? formatFailures(
        "Network Failures",
        "network logs",
        failureEntries.map((entry: any) => ({
          startedDateTime: entry.startedDateTime,
          request: {
            method: entry.request?.method,
            url: entry.request?.url,
            queryString: entry.request?.queryString,
          },
          response: {
            status: entry.response?.status,
            statusText: entry.response?.statusText,
            _error: entry.response?._error,
          },
          serverIPAddress: entry.serverIPAddress,
          time: entry.time,
        })),
      )
    : "No network failures found";
}

// SESSION LOGS
export async function retrieveSessionFailures(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/logs`;
  const result = await fetchLog(url, "session logs", config);
  if ("message" in result) return result.message;

  const logs = filterSessionFailures(logDataToText(result.data));
  return logs.length > 0
    ? formatFailures("Session Failures", "session logs", logs)
    : "No session failures found";
}

// CONSOLE LOGS
export async function retrieveConsoleFailures(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/consolelogs`;
  const result = await fetchLog(url, "console logs", config);
  if ("message" in result) return result.message;

  const logs = filterConsoleFailures(logDataToText(result.data));
  return logs.length > 0
    ? formatFailures("Console Failures", "console logs", logs)
    : "No console failures found";
}

// FILTER: session logs
export function filterSessionFailures(logText: string): string[] {
  const keywords = [
    "error",
    "fail",
    "exception",
    "fatal",
    "unable to",
    "not found",
    '"success":false',
    '"success": false',
    '"msg":',
    "console.error",
    "stderr",
  ];
  return filterLinesByKeywords(logText, keywords);
}

// FILTER: console logs
export function filterConsoleFailures(logText: string): string[] {
  const keywords = [
    "failed to load resource",
    "uncaught",
    "typeerror",
    "referenceerror",
    "scanner is not ready",
    "status of 4",
    "status of 5",
    "not found",
    "undefined",
    "error:",
  ];
  return filterLinesByKeywords(logText, keywords);
}
