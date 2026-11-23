import { getBrowserStackAuth } from "../../lib/get-auth.js";
import {
  filterLinesByKeywords,
  MAX_LOG_BYTES,
  validateLogResponse,
} from "./utils.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";
import { getRegionalHost } from "../../lib/regional-host.js";
import { encodePathSegment } from "../../lib/path-segment.js";

/** The session has no such log here (404). Opt-in, so the caller can try elsewhere. */
export class LogsNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogsNotFoundError";
  }
}

export interface AppLogOptions {
  /** Throw LogsNotFoundError on 404 instead of returning the "not available" text. */
  throwOnNotFound?: boolean;
}

// DEVICE LOGS
export async function retrieveDeviceLogs(
  sessionId: string,
  buildId: string,
  config: BrowserStackConfig,
  options: AppLogOptions = {},
): Promise<string> {
  const url = `${getRegionalHost("appAutomateApi")}/app-automate/builds/${encodePathSegment(buildId, "buildId")}/sessions/${encodePathSegment(sessionId, "sessionId")}/devicelogs`;
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    maxContentLength: MAX_LOG_BYTES,
    raise_error: false,
  });

  const validationError = validateLogResponse(response, "device logs");
  if (validationError) {
    if (response.status === 404 && options.throwOnNotFound) {
      throw new LogsNotFoundError(validationError.message!);
    }
    return validationError.message!;
  }

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
  options: AppLogOptions = {},
): Promise<string> {
  const url = `${getRegionalHost("appAutomateApi")}/app-automate/builds/${encodePathSegment(buildId, "buildId")}/sessions/${encodePathSegment(sessionId, "sessionId")}/appiumlogs`;
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    maxContentLength: MAX_LOG_BYTES,
    raise_error: false,
  });

  const validationError = validateLogResponse(response, "Appium logs");
  if (validationError) {
    if (response.status === 404 && options.throwOnNotFound) {
      throw new LogsNotFoundError(validationError.message!);
    }
    return validationError.message!;
  }

  const logText =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  const { failures, totalLines, omitted } = summarizeAppiumFailures(logText);
  if (failures.length === 0) return "No Appium failures found";
  const omittedNote =
    omitted > 0
      ? `\n${omitted} more distinct failures omitted; open the session in the BrowserStack dashboard for the full log.`
      : "";
  return `Appium Failures (${failures.length} distinct, ${totalLines} lines; each with the command that was running):\n${wrapUntrusted("Appium logs", JSON.stringify(failures, null, 2))}${omittedNote}`;
}

// CRASH LOGS
export async function retrieveCrashLogs(
  sessionId: string,
  buildId: string,
  config: BrowserStackConfig,
  options: AppLogOptions = {},
): Promise<string> {
  const url = `${getRegionalHost("appAutomateApi")}/app-automate/builds/${encodePathSegment(buildId, "buildId")}/sessions/${encodePathSegment(sessionId, "sessionId")}/crashlogs`;
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    maxContentLength: MAX_LOG_BYTES,
    raise_error: false,
  });

  const validationError = validateLogResponse(response, "crash logs");
  if (validationError) {
    if (response.status === 404 && options.throwOnNotFound) {
      throw new LogsNotFoundError(validationError.message!);
    }
    return validationError.message!;
  }

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

export interface AppiumFailure {
  error: string;
  count: number;
  first_seen?: string;
  last_seen?: string;
  command?: string;
  previous_command?: string;
}

const APPIUM_KEYWORDS = [
  "error",
  "fail",
  "exception",
  "not found",
  "no such element",
  "unable to",
  "appium exited",
  "command failed",
  "invalid selector",
];
const APPIUM_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[:.]\d{3})\s*-\s*/;
const APPIUM_TAGS = /^(\[[^\]]*\]\s*)+/;
const APPIUM_CALL = /Calling \w+\.(\w+)\(\) with args: (.*)$/;
const APPIUM_HTTP_REQUEST = /\[HTTP\] --> (GET|POST|PUT|PATCH|DELETE) (\S+)/;
const APPIUM_HTTP_BODY = /\[HTTP\] (\{.*\})\s*$/;
const MAX_APPIUM_FAILURES = 50;
const MAX_APPIUM_TEXT = 600;

function cap(text: string): string {
  return text.length > MAX_APPIUM_TEXT
    ? `${text.slice(0, MAX_APPIUM_TEXT)}…`
    : text;
}

/**
 * Distinct Appium failures, each with the command (and locator) that was running and the
 * command before it. Repeats of the same error under the same command are counted, not listed.
 */
export function summarizeAppiumFailures(logText: string): {
  failures: AppiumFailure[];
  totalLines: number;
  omitted: number;
} {
  const groups = new Map<string, AppiumFailure>();
  let totalLines = 0;
  let command: string | undefined;
  let previousCommand: string | undefined;
  // The HTTP request, its body and the "Calling ..." line that follow describe one command.
  let fromRequest = false;

  const startCommand = (next: string) => {
    if (command && command !== next) previousCommand = command;
    command = next;
  };

  for (const rawLine of logText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const timestamp = line.match(APPIUM_TIMESTAMP)?.[1];
    const body = line.replace(APPIUM_TIMESTAMP, "");

    const request = body.match(APPIUM_HTTP_REQUEST);
    if (request) {
      startCommand(`${request[1]} ${request[2]}`);
      fromRequest = true;
      continue;
    }
    const requestBody = body.match(APPIUM_HTTP_BODY);
    if (requestBody && fromRequest) {
      command = cap(`${command} ${requestBody[1]}`);
      continue;
    }
    const call = body.match(APPIUM_CALL);
    if (call) {
      const next = cap(`${call[1]}(${call[2]})`);
      if (fromRequest) command = next;
      else startCommand(next);
      fromRequest = false;
      continue;
    }

    const message = body.replace(APPIUM_TAGS, "").trim();
    if (/^at\s/.test(message)) continue;
    const lower = message.toLowerCase();
    if (!APPIUM_KEYWORDS.some((keyword) => lower.includes(keyword))) continue;

    totalLines++;
    const error = cap(message);
    const key = `${error}\u0000${command ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (timestamp) existing.last_seen = timestamp;
      continue;
    }
    groups.set(key, {
      error,
      count: 1,
      ...(timestamp && { first_seen: timestamp }),
      ...(command && { command }),
      ...(previousCommand && { previous_command: previousCommand }),
    });
  }

  const failures = [...groups.values()];
  return {
    failures: failures.slice(0, MAX_APPIUM_FAILURES),
    totalLines,
    omitted: Math.max(0, failures.length - MAX_APPIUM_FAILURES),
  };
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
