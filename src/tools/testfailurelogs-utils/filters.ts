import logger from "../../logger.js";
import {
  HarEntry,
  HarFile,
  validateLogResponse,
} from "../failurelogs-utils/utils.js";
import {
  filterConsoleFailures,
  filterSessionFailures,
} from "../failurelogs-utils/automate.js";
import {
  filterAppiumFailures,
  filterCrashFailures,
  filterDeviceFailures,
} from "../failurelogs-utils/app-automate.js";
import {
  filterSDKFailures,
  filterHookRunFailures,
  filterSeleniumFailures,
  filterPlaywrightFailures,
} from "../failurelogs-utils/automate.js";
import {
  filterLogsByTimestamp,
  filterLogsByTimestampHook,
  filterLogsByTimestampSDK,
  filterLogsByTimestampConsole,
  filterLogsByTimestampSelenium,
  filterLogsByTimestampDevice,
  filterLogsByTimestampAppium,
  filterLogsByTimestampPlaywright
} from "./utils.js";
import { BrowserstackLogTypes } from "../../lib/constants.js";

// Main log filter for BrowserStack logs
export async function filterBrowserstackLogs(
  browserstackLogs: any,
  testStartedAt?: string,
  testFinishedAt?: string,
): Promise<any> {
  if (!browserstackLogs) return {};

  const result: Record<string, any> = {};
  const startTime = testStartedAt || null;
  const endTime = testFinishedAt || null;

  for (const logType in browserstackLogs) {
    try {
      const logData = browserstackLogs[logType];
      let finalLogContent;

      switch (logType) {
        case BrowserstackLogTypes.Text:
          if (logData.url) {
            finalLogContent = await validateAndFilterTextLogs(
              logData.url,
              startTime,
              endTime,
            );
          }
          break;
        case BrowserstackLogTypes.Network:
          if (logData.url) {
            finalLogContent = await validateAndFilterNetworkLogs(
              logData.url,
              startTime,
              endTime,
            );
          }
          break;
        case BrowserstackLogTypes.Selenium:
          if (logData.url) {
            finalLogContent = await validateAndFilterSeleniumLogs(
              logData.url,
              startTime,
              endTime,
            );
          }
          break;
        case BrowserstackLogTypes.Console:
          if (logData.url) {
            finalLogContent = await validateAndFilterConsoleLogs(
              logData.url,
              startTime,
              endTime,
            );
          }
          break;
        case BrowserstackLogTypes.Device:
          if (logData.url) {
            finalLogContent = await validateAndFilterDeviceLogs(
              logData.url,
              startTime,
              endTime,
            );
          }
          break;
        case BrowserstackLogTypes.Appium:
          if (logData.url) {
            finalLogContent = await validateAndFilterAppiumLogs(
              logData.url,
              startTime,
              endTime,
            );
          }
          break;
        case BrowserstackLogTypes.Playwright:
          if (logData.url) {
            finalLogContent = await validateAndFilterPlaywrightLogs(
              logData.url,
              startTime,
              endTime,
            );
          }
          break;
      }
      result[logType] = finalLogContent;
    } catch (error) {
      logger.error(
        `Failed to fetch ${logType} logs: ${error instanceof Error ? error.message : String(error)}`,
      );
      result[logType] = null;
    }
  }
  return result;
}

// Filter SDK logs by timestamp
export async function filterSdkLogs(
  logUrls: string[],
  testStartedAt?: string,
  testFinishedAt?: string,
): Promise<any> {
  if (!testStartedAt || !testFinishedAt) return logUrls;

  const filteredLogs: string[] = [];

  for (const logUrl of logUrls) {
    try {
      const logContent = await fetch(logUrl).then((res) => res.text());
      const filteredLines = filterLogsByTimestampSDK(
        logContent,
        testStartedAt,
        testFinishedAt,
      );
      filteredLogs.push(filteredLines.join("\n"));
    } catch (error) {
      logger.error(
        `Failed to filter SDK log: ${error instanceof Error ? error.message : String(error)}`,
      );
      filteredLogs.push(`Error fetching or filtering log at ${logUrl}`);
    }
  }
  const logs = filterSDKFailures(filteredLogs.join("\n"));
  return logs.length > 0
    ? `Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No failures found";
}

// Filter hook run logs by timestamp
export async function filterHookRunLogs(
  hookRunLogs: string[],
  testStartedAt?: string,
  testFinishedAt?: string,
) {
  if (!testStartedAt || !testFinishedAt) return hookRunLogs;

  const filteredLogs: string[] = [];

  for (const log of hookRunLogs) {
    try {
      const logContent = await fetch(log).then((res) => res.text());
      const filteredLines = filterLogsByTimestampHook(
        logContent,
        testStartedAt,
        testFinishedAt,
      );
      filteredLogs.push(filteredLines.join("\n"));
    } catch (error) {
      logger.error(`Failed to filter hook run log: ${error}`);
      filteredLogs.push(`Error fetching or filtering log at ${log}`);
    }
  }
  const logs = filterHookRunFailures(filteredLogs.join("\n"));
  return logs.length > 0
    ? `Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No failures found";
}

// Text log validation and filtering
export async function validateAndFilterTextLogs(
  url: string,
  startTime: string | null = null,
  endTime: string | null = null,
) {
  try {
    const response = await fetch(url);
    const validationError = validateLogResponse(response, "text logs");
    if (validationError) return validationError.message!;

    const logText = await response.text();
    const logLines = logText.split("\n");
    const filteredLines =
      startTime && endTime
        ? filterLogsByTimestamp(logLines, startTime, endTime)
        : logLines;
    const logs = filterSessionFailures(filteredLines.join("\n"));
    return logs.length > 0
      ? `Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
      : "No failures found";
  } catch (error) {
    logger.error(
      `Error processing text logs: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

// Network log validation and filtering
export async function validateAndFilterNetworkLogs(
  url: string,
  startTime: string | null = null,
  endTime: string | null = null,
): Promise<string> {
  const response = await fetch(url);
  const validationError = validateLogResponse(response, "network logs");
  if (validationError) return validationError.message!;

  const networklogs: HarFile = await response.json();
  const startDate = startTime ? new Date(startTime) : null;
  const endDate = endTime ? new Date(endTime) : null;

  const failureEntries: HarEntry[] = networklogs.log.entries.filter(
    (entry: HarEntry) => {
      if (startDate && endDate) {
        const entryTime = new Date(entry.startedDateTime).getTime();
        return (
          entryTime >= startDate.getTime() &&
          entryTime <= endDate.getTime() &&
          (entry.response.status === 0 ||
            entry.response.status >= 400 ||
            entry.response._error !== undefined)
        );
      }
      return (
        entry.response.status === 0 ||
        entry.response.status >= 400 ||
        entry.response._error !== undefined
      );
    },
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

// Console log validation and filtering
export async function validateAndFilterConsoleLogs(
  url: string,
  startTime: string | null = null,
  endTime: string | null = null,
): Promise<string> {
  const response = await fetch(url);
  const validationError = validateLogResponse(response, "console logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const filteredLines =
    startTime && endTime
      ? filterLogsByTimestampConsole(logText, startTime, endTime)
      : logText.split("\n").filter((line) => line.trim());
  const logs = filterConsoleFailures(filteredLines.join("\n"));

  return logs.length > 0
    ? `Console Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No console failures found";
}

// Device log validation and filtering
export async function validateAndFilterDeviceLogs(
  url: string,
  startTime: string | null = null,
  endTime: string | null = null,
): Promise<string> {
  const response = await fetch(url);
  const validationError = validateLogResponse(response, "device logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const filteredLines =
    startTime && endTime
      ? filterLogsByTimestampDevice(logText, startTime, endTime)
      : logText.split("\n").filter((line) => line.trim());
  const logs = filterDeviceFailures(filteredLines.join("\n"));

  return logs.length > 0
    ? `Device Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No device failures found";
}

// Appium log validation and filtering
export async function validateAndFilterAppiumLogs(
  url: string,
  startTime: string | null = null,
  endTime: string | null = null,
): Promise<string> {
  const response = await fetch(url);
  const validationError = validateLogResponse(response, "Appium logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const filteredLines =
    startTime && endTime
      ? filterLogsByTimestampAppium(logText, startTime, endTime)
      : logText.split("\n").filter((line) => line.trim());
  const logs = filterAppiumFailures(filteredLines.join("\n"));

  return logs.length > 0
    ? `Appium Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No Appium failures found";
}

// Crash log validation and filtering
export async function validateAndFilterCrashLogs(
  url: string,
  startTime: string | null = null,
  endTime: string | null = null,
): Promise<string> {
  const response = await fetch(url);
  const validationError = validateLogResponse(response, "crash logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const logLines = logText.split("\n");
  const filteredLines =
    startTime && endTime
      ? filterLogsByTimestamp(logLines, startTime, endTime)
      : logLines;
  const logs = filterCrashFailures(filteredLines.join("\n"));

  return logs.length > 0
    ? `Crash Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No crash failures found";
}

// Selenium log validation and filtering
export async function validateAndFilterSeleniumLogs(
  url: string,
  startTime: string | null = null,
  endTime: string | null = null,
): Promise<string> {
  const response = await fetch(url);
  const validationError = validateLogResponse(response, "Selenium logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const filteredLines =
    startTime && endTime
      ? filterLogsByTimestampSelenium(logText, startTime, endTime)
      : logText.split("\n").filter((line) => line.trim());

  const logs = filterSeleniumFailures(filteredLines.join("\n"));
  return filteredLines.length > 0
    ? `Selenium Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No Selenium failures found";
}

export async function validateAndFilterPlaywrightLogs(
  url: string,
  startTime: string | null = null,
  endTime: string | null = null,
): Promise<string> {
  const response = await fetch(url);
  const validationError = validateLogResponse(response, "Playwright logs");
  if (validationError) return validationError.message!;

  const logText = await response.text();
  const filteredLines =
    startTime && endTime
      ? filterLogsByTimestampPlaywright(logText, startTime, endTime)
      : logText.split("\n").filter((line) => line.trim());
  const logs = filterPlaywrightFailures(filteredLines.join("\n"));
  return filteredLines.length > 0
    ? `Playwright Failures (${logs.length} found):\n${JSON.stringify(logs, null, 2)}`
    : "No Playwright failures found";
}
