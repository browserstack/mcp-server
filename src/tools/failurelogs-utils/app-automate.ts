import {
  fetchLog,
  filterLinesByKeywords,
  formatFailures,
  logDataToText,
} from "./utils.js";
import { BrowserStackConfig } from "../../lib/types.js";

// DEVICE LOGS
export async function retrieveDeviceLogs(
  sessionId: string,
  buildId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/deviceLogs`;
  const result = await fetchLog(url, "device logs", config);
  if ("message" in result) return result.message;

  const logs = filterDeviceFailures(logDataToText(result.data));
  return logs.length > 0
    ? formatFailures("Device Failures", "device logs", logs)
    : "No device failures found";
}

// APPIUM LOGS
export async function retrieveAppiumLogs(
  sessionId: string,
  buildId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/appiumlogs`;
  const result = await fetchLog(url, "Appium logs", config);
  if ("message" in result) return result.message;

  const logs = filterAppiumFailures(logDataToText(result.data));
  return logs.length > 0
    ? formatFailures("Appium Failures", "Appium logs", logs)
    : "No Appium failures found";
}

// CRASH LOGS
export async function retrieveCrashLogs(
  sessionId: string,
  buildId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const url = `https://api.browserstack.com/app-automate/builds/${buildId}/sessions/${sessionId}/crashlogs`;
  const result = await fetchLog(url, "crash logs", config);
  if ("message" in result) return result.message;

  const logs = filterCrashFailures(logDataToText(result.data));
  return logs.length > 0
    ? formatFailures("Crash Failures", "crash logs", logs)
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
