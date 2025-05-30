import config from "../../config.js";
import {
  HarEntry,
  HarFile,
  filterLinesByKeywords,
  validateLogResponse,
} from "./utils.js";

const auth = Buffer.from(
  `${config.browserstackUsername}:${config.browserstackAccessKey}`,
).toString("base64");

// NETWORK LOGS
export async function retrieveNetworkFailures(
  sessionId: string,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/networklogs`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  const validationError = validateLogResponse(response, "network logs");
  if (validationError) return validationError.message!;

  const networklogs: HarFile = await response.json();
  const failureEntries: HarEntry[] = networklogs.log.entries.filter(
    (entry: HarEntry) =>
      entry.response.status === 0 ||
      entry.response.status >= 400 ||
      entry.response._error !== undefined,
  );

  return failureEntries.length > 0
    ? `Network Failures (${failureEntries.length} found):\n${JSON.stringify(
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
      )}`
    : "No network failures found";
}

// SESSION LOGS
export async function retrieveSessionFailures(
  sessionId: string,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/logs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  const validationError = validateLogResponse(response, "session logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const logs = filterSessionFailures(logText);
  return logs.length > 0
    ? `Session Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No session failures found";
}

// CONSOLE LOGS
export async function retrieveConsoleFailures(
  sessionId: string,
): Promise<string> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/consolelogs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  const validationError = validateLogResponse(response, "console logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const logs = filterConsoleFailures(logText);
  return logs.length > 0
    ? `Console Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
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

export function filterSDKFailures(logText: string): string[] {
  const keywords = [
    "fail",
    "error",
    "exception",
    "fatal",
    "unable to",
    "not found",
    "timeout",
    "crash",
    "rejected",
    "denied",
    "broken",
    "unsuccessful",
    "panic",
  ];
  return filterLinesByKeywords(logText, keywords);
}

export function filterHookRunFailures(logText: string): string[] {
  const keywords = [
    "except block error",
    "unable to",
    "cannot find module",
    "doesn't exist",
    "error while loading",
    "error:",
    "failed to",
    "not found",
    "missing",
    "rejected",
    "no such file",
    "npm ERR!",
    "stderr",
    "fatal",
  ];

  return filterLinesByKeywords(logText, keywords);
}

export function filterSeleniumFailures(logText: string): string[] {
  const keywords = [
    "NoSuchElementException",
    "TimeoutException",
    "StaleElementReferenceException",
    "ElementNotInteractableException",
    "ElementClickInterceptedException",
    "InvalidSelectorException",
    "SessionNotCreatedException",
    "InvalidSessionIdException",
    "WebDriverException",
    "error",
    "exception",
    "fail"
  ];
  return filterLinesByKeywords(logText, keywords);
}


export function filterPlaywrightFailures(logText: string): string[] {
  const keywords = [
    "TimeoutError",
    "page crashed",
    "browser closed",
    "navigation timeout",
    "element handle is detached",
    "protocol error",
    "execution context was destroyed",
    "strict mode violation",
    "network error",
    "error",
    "exception",
    "fail"
  ];
  return filterLinesByKeywords(logText, keywords);
}
