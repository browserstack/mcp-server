import { parseISO } from "date-fns";

// Filters log lines by timestamp range (YYYY-MM-DD HH:mm:ss:SSS)
export function filterLogsByTimestamp(
  logs: string[],
  startTime: string | null,
  endTime: string | null,
): string[] {
  if (!startTime || !endTime) return [];

  const startDate = parseISO(startTime);
  const endDate = parseISO(endTime);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return [];

  return logs.filter((line) => {
    const match = line.match(
      /^(\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}:\d{2}):(\d{1,3})/,
    );
    if (!match) return false;

    const [year, month, day, hour, minute, second] = match[1]
      .split(/[- :]/)
      .map(Number);
    const ms = parseInt(match[2].padStart(3, "0"));
    const logTime = new Date(
      Date.UTC(year, month - 1, day, hour, minute, second, ms),
    );
    return logTime >= startDate && logTime <= endDate;
  });
}

// Filters SDK log lines by timestamp (expects JSON lines with .timestamp)
export function filterLogsByTimestampSDK(
  logContent: string,
  testStartedAt: string,
  testFinishedAt: string,
): string[] {
  const startTime = new Date(testStartedAt);
  const endTime = new Date(testFinishedAt);
  const logLines = logContent.split("\n").filter((line) => line.trim());

  return logLines.filter((line) => {
    try {
      const parsed = JSON.parse(line);
      const logTime = new Date(parsed.timestamp);
      return logTime >= startTime && logTime <= endTime;
    } catch {
      return false;
    }
  });
}

// Filters hook run log lines by timestamp (expects JSON lines with .timestamp)
export function filterLogsByTimestampHook(
  logContent: string,
  testStartedAt: string,
  testFinishedAt: string,
): string[] {
  const startTime = new Date(testStartedAt);
  const endTime = new Date(testFinishedAt);
  const logLines = logContent.split("\n").filter((line) => line.trim());

  return logLines.filter((line) => {
    try {
      const parsed = JSON.parse(line);
      const logTime = new Date(parsed.timestamp);
      return logTime >= startTime && logTime <= endTime;
    } catch {
      return false;
    }
  });
}

// Filters console log lines by millisecond timestamp (first 13 digits)
export function filterLogsByTimestampConsole(
  logContent: string,
  testStartedAt: string,
  testFinishedAt: string,
): string[] {
  const startEpoch = new Date(testStartedAt).getTime();
  const endEpoch = new Date(testFinishedAt).getTime();
  const logLines = logContent.split("\n").filter((line) => line.trim());

  return logLines.filter((line) => {
    const match = line.match(/^(\d{13})/);
    if (match) {
      const timestamp = parseInt(match[1], 10);
      return timestamp >= startEpoch && timestamp <= endEpoch;
    }
    return false;
  });
}

// Filters Selenium log lines by time (HH:mm:ss.SSS)
export function filterLogsByTimestampSelenium(
  logContent: string,
  testStartedAt: string,
  testFinishedAt: string,
): string[] {
  const formatTimeOnly = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toTimeString().slice(0, 12);
  };

  const start = formatTimeOnly(testStartedAt);
  const end = formatTimeOnly(testFinishedAt);
  const logLines = logContent.split("\n").filter((line) => line.trim());

  return logLines.filter((line) => {
    const match = line.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (!match) return false;
    const time = match[1];
    return time >= start && time <= end;
  });
}

// Filters device log lines by timestamp (MM-DD HH:mm:ss.SSS, assumes year from testStartedAt)
export function filterLogsByTimestampDevice(
  logContent: string,
  testStartedAt: string,
  testFinishedAt: string,
): string[] {
  const startTime = new Date(testStartedAt);
  const endTime = new Date(testFinishedAt);
  const year = startTime.getUTCFullYear();
  const logLines = logContent.split("\n").filter((line) => line.trim());

  const androidRgx = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/;
  const iosRgx = /^(\w{3} [0-9 ]{1,2} \d{2}:\d{2}:\d{2})/;

  return logLines.filter((line) => {
    let logTime: Date | null = null;

    let match = line.match(androidRgx);
    if (match) {
      const monthDayTime = match[1];
      const fullTimestampStr = `${year}-${monthDayTime.replace(" ", "T")}Z`;
      logTime = new Date(fullTimestampStr);
    } else {
      match = line.match(iosRgx);
      if (match) {
        const iosTimestamp = match[1];
        const padded = iosTimestamp.replace(
          /^(\w{3}) ([0-9 ])(\d{2}:\d{2}:\d{2})$/,
          (_, m, d, t) => `${m} ${d.trim().padStart(2, "0")} ${t}`
        );
        const fullTimestampStr = `${year} ${padded}`;
        logTime = new Date(fullTimestampStr);
      }
    }

    if (!logTime || isNaN(logTime.getTime())) return false;
    return logTime >= startTime && logTime <= endTime;
  });
}

// Filters Appium log lines by timestamp (YYYY-MM-DD HH:mm:ss:SSS)
export function filterLogsByTimestampAppium(
  logContent: string,
  testStartedAt: string,
  testFinishedAt: string,
): string[] {
  const startTime = new Date(testStartedAt);
  const endTime = new Date(testFinishedAt);
  const logLines = logContent.split("\n").filter((line) => line.trim());

  return logLines.filter((line) => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):(\d{3})/);
    if (!match) return false;
    const [, datePart, millisPart] = match;
    const isoString = `${datePart.replace(" ", "T")}.${millisPart}Z`;
    const logTime = new Date(isoString);
    return logTime >= startTime && logTime <= endTime;
  });
}

// Filters Playwright log lines by ISO 8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)
export function filterLogsByTimestampPlaywright(
  logContent: string,
  testStartedAt: string,
  testFinishedAt: string,
): string[] {
  const startTime = new Date(testStartedAt);
  const endTime = new Date(testFinishedAt);
  const logLines = logContent.split("\n").filter((line) => line.trim());

  return logLines.filter((line) => {
    // Match ISO 8601 timestamp at the start of the line
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
    if (!match) return false;
    const logTime = new Date(match[1]);
    return logTime >= startTime && logTime <= endTime;
  });
}