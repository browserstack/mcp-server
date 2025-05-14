import config from "../../config.js";
import { HarEntry, HarFile } from "../../lib/utils.js";
import { assertOkResponse, filterLinesByKeywords } from "../../lib/utils.js";

const auth = Buffer.from(
  `${config.browserstackUsername}:${config.browserstackAccessKey}`,
).toString("base64");

// NETWORK LOGS
export async function retrieveNetworkFailures(sessionId: string): Promise<any> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/networklogs`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "network logs");

  const networklogs: HarFile = await response.json();

  // Filter for failure logs
  const failureEntries: HarEntry[] = networklogs.log.entries.filter(
    (entry: HarEntry) => {
      return (
        entry.response.status === 0 ||
        entry.response.status >= 400 ||
        entry.response._error !== undefined
      );
    },
  );

  // Return only the failure entries with some context
  return failureEntries.map((entry: any) => ({
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
  }));
}

// SESSION LOGS
export async function retrieveSessionFailures(
  sessionId: string,
): Promise<string[]> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/logs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "session logs");

  const logText = await response.text();
  return filterSessionFailures(logText);
}

// CONSOLE LOGS
export async function retrieveConsoleFailures(
  sessionId: string,
): Promise<string[]> {
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/consolelogs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "console logs");

  const logText = await response.text();
  return filterConsoleFailures(logText);
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
