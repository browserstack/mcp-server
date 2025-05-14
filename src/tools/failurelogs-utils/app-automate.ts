import config from "../../config.js";
import { assertOkResponse, filterLinesByKeywords } from "../../lib/utils.js";

const auth = Buffer.from(
  `${config.browserstackUsername}:${config.browserstackAccessKey}`,
).toString("base64");

// DEVICE LOGS
export async function retrieveDeviceLogs(
  sessionId: string,
  buildId: string,
): Promise<string[]> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/deviceLogs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "device logs");

  const logText = await response.text();
  return filterDeviceFailures(logText);
}

// APPIUM LOGS
export async function retrieveAppiumLogs(
  sessionId: string,
  buildId: string,
): Promise<string[]> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/appiumlogs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "Appium logs");

  const logText = await response.text();
  return filterAppiumFailures(logText);
}

// CRASH LOGS
export async function retrieveCrashLogs(
  sessionId: string,
  buildId: string,
): Promise<string[]> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/crashlogs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "crash logs");

  const logText = await response.text();
  return filterCrashFailures(logText);
}

// FILTER HELPERS

export function filterDeviceFailures(logText: string): string[] {
  const keywords = [
    "error",
    "exception",
    "fatal",
    "anr",
    "not responding",
    "process crashed",
    "crash",
    "force close",
    "signal",
    "java.lang.",
    "unable to",
  ];
  return filterLinesByKeywords(logText, keywords);
}

export function filterAppiumFailures(logText: string): string[] {
  const keywords = [
    "error",
    "fail",
    "exception",
    "not found",
    "no such element",
    "unable to",
    "stacktrace",
    "appium exited",
    "command failed",
    "invalid selector",
  ];
  return filterLinesByKeywords(logText, keywords);
}

export function filterCrashFailures(logText: string): string[] {
  const keywords = [
    "fatal exception",
    "crash",
    "signal",
    "java.lang.",
    "caused by:",
    "native crash",
    "anr",
    "abort message",
    "application has stopped unexpectedly",
  ];
  return filterLinesByKeywords(logText, keywords);
}
