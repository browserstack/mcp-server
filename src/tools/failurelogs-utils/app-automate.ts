import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { filterLinesByKeywords, validateLogResponse } from "./utils.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";

// DEVICE LOGS
export async function retrieveDeviceLogs(
  sessionId: string,
  buildId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/deviceLogs`;
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

  const validationError = validateLogResponse(response, "device logs");
  if (validationError) return validationError.message!;

  const logText =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  const logs = filterDeviceFailures(logText);
  return logs.length > 0
    ? `Device Failures (${logs.length} found):\n${wrapUntrusted("device logs", JSON.stringify(logs, null, 2))}`
    : "No device failures found";
}

// APPIUM LOGS
export async function retrieveAppiumLogs(
  sessionId: string,
  buildId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/appiumlogs`;
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

  const validationError = validateLogResponse(response, "Appium logs");
  if (validationError) return validationError.message!;

  const logText =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  const logs = filterAppiumFailures(logText);
  return logs.length > 0
    ? `Appium Failures (${logs.length} found):\n${wrapUntrusted("Appium logs", JSON.stringify(logs, null, 2))}`
    : "No Appium failures found";
}

// CRASH LOGS
export async function retrieveCrashLogs(
  sessionId: string,
  buildId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/crashlogs`;
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

  const validationError = validateLogResponse(response, "crash logs");
  if (validationError) return validationError.message!;

  const logText =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  const logs = filterCrashFailures(logText);
  return logs.length > 0
    ? `Crash Failures (${logs.length} found):\n${wrapUntrusted("crash logs", JSON.stringify(logs, null, 2))}`
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
