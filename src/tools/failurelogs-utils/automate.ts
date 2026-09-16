import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";
import {
  HarEntry,
  HarFile,
  filterLinesByKeywords,
  validateLogResponse,
} from "./utils.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";

// NETWORK LOGS
export async function retrieveNetworkFailures(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/networklogs`;
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    raise_error: false,
  });

  const validationError = validateLogResponse(response, "network logs");
  if (validationError) return validationError.message!;

  const networklogs: HarFile = response.data;
  const failureEntries: HarEntry[] = networklogs.log.entries.filter(
    (entry: HarEntry) =>
      entry.response.status === 0 ||
      entry.response.status >= 400 ||
      entry.response._error !== undefined,
  );

  return failureEntries.length > 0
    ? `Network Failures (${failureEntries.length} found):\n${wrapUntrusted(
        "network logs",
        JSON.stringify(
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
          null,
          2,
        ),
      )}`
    : "No network failures found";
}

// SESSION LOGS
export async function retrieveSessionFailures(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/logs`;
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    raise_error: false,
  });

  const validationError = validateLogResponse(response, "session logs");
  if (validationError) return validationError.message!;

  const logText =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  const logs = filterSessionFailures(logText);
  return logs.length > 0
    ? `Session Failures (${logs.length} found):\n${wrapUntrusted("session logs", JSON.stringify(logs, null, 2))}`
    : "No session failures found";
}

// CONSOLE LOGS
export async function retrieveConsoleFailures(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/consolelogs`;
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    raise_error: false,
  });

  const validationError = validateLogResponse(response, "console logs");
  if (validationError) return validationError.message!;

  const logText =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  const logs = filterConsoleFailures(logText);
  return logs.length > 0
    ? `Console Failures (${logs.length} found):\n${wrapUntrusted("console logs", JSON.stringify(logs, null, 2))}`
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
