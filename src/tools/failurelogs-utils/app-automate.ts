import config from "../../config.js";
import { filterLinesByKeywords, validateLogResponse } from "./utils.js";

const auth = Buffer.from(
  `${config.browserstackUsername}:${config.browserstackAccessKey}`,
).toString("base64");

// DEVICE LOGS
export async function retrieveDeviceLogs(
  sessionId: string,
  buildId: string,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/deviceLogs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  const validationError = validateLogResponse(response, "device logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const logs = filterDeviceFailures(logText);
  return logs.length > 0
    ? `Device Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No device failures found";
}

// APPIUM LOGS
export async function retrieveAppiumLogs(
  sessionId: string,
  buildId: string,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/appiumlogs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  const validationError = validateLogResponse(response, "Appium logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const logs = filterAppiumFailures(logText);
  return logs.length > 0
    ? `Appium Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No Appium failures found";
}

// CRASH LOGS
export async function retrieveCrashLogs(
  sessionId: string,
  buildId: string,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/crashlogs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  const validationError = validateLogResponse(response, "crash logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const logs = filterCrashFailures(logText);
  return logs.length > 0
    ? `Crash Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No crash failures found";
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
