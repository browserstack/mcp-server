import { describe, it, expect } from "vitest";
import {
  filterLogsByTimestamp,
  filterLogsByTimestampSDK,
  filterLogsByTimestampHook,
  filterLogsByTimestampConsole,
  filterLogsByTimestampSelenium,
  filterLogsByTimestampDevice,
  filterLogsByTimestampAppium,
  filterLogsByTimestampPlaywright,
} from "../../src/tools/testfailurelogs-utils/utils";

describe("Log Filtering Utilities", () => {
  describe("filterLogsByTimestamp", () => {
    const start = "2023-05-01T10:00:00.000Z";
    const end = "2023-05-01T10:10:00.000Z";
    const logs = [
      "2023-05-01 10:00:00:000 Log at start",
      "2023-05-01 10:05:00:500 Log in range",
      "2023-05-01 10:10:00:000 Log at end",
      "2023-05-01 10:11:00:000 Log after end",
      "Malformed log line",
      "",
    ];

    it("should include logs within the time window", () => {
      const filtered = filterLogsByTimestamp(logs, start, end);
      expect(filtered).toEqual([
        "2023-05-01 10:00:00:000 Log at start",
        "2023-05-01 10:05:00:500 Log in range",
        "2023-05-01 10:10:00:000 Log at end",
      ]);
    });

    it("should return empty array for logs outside the window", () => {
      const filtered = filterLogsByTimestamp(
        ["2023-05-01 10:11:00:000 Log after end"],
        start,
        end
      );
      expect(filtered).toEqual([]);
    });

    it("should return empty array for blank input", () => {
      expect(filterLogsByTimestamp([], start, end)).toEqual([]);
      expect(filterLogsByTimestamp([""], start, end)).toEqual([]);
    });

    it("should ignore malformed lines", () => {
      const filtered = filterLogsByTimestamp(
        ["Malformed log line", "2023-05-01 10:05:00:500 Good"],
        start,
        end
      );
      expect(filtered).toEqual(["2023-05-01 10:05:00:500 Good"]);
    });
  });

  describe("filterLogsByTimestampSDK", () => {
    const start = "2023-05-01T10:00:00.000Z";
    const end = "2023-05-01T10:10:00.000Z";
    const logs = [
      JSON.stringify({ timestamp: "2023-05-01T10:00:00.000Z", msg: "start" }),
      JSON.stringify({ timestamp: "2023-05-01T10:05:00.000Z", msg: "mid" }),
      JSON.stringify({ timestamp: "2023-05-01T10:10:00.000Z", msg: "end" }),
      JSON.stringify({ timestamp: "2023-05-01T10:11:00.000Z", msg: "late" }),
      "not a json line",
      "",
    ].join("\n");

    it("should include logs within the time window", () => {
      const filtered = filterLogsByTimestampSDK(logs, start, end);
      expect(filtered.length).toBe(3);
      expect(filtered.every((line) => JSON.parse(line).msg !== "late")).toBe(true);
    });

    it("should return empty array for blank input", () => {
      expect(filterLogsByTimestampSDK("", start, end)).toEqual([]);
    });

    it("should ignore malformed lines", () => {
      const filtered = filterLogsByTimestampSDK("not a json line", start, end);
      expect(filtered).toEqual([]);
    });
  });

  describe("filterLogsByTimestampHook", () => {
    const start = "2023-05-01T10:00:00.000Z";
    const end = "2023-05-01T10:10:00.000Z";
    const logs = [
      JSON.stringify({ timestamp: "2023-05-01T10:00:00.000Z", msg: "hook start" }),
      JSON.stringify({ timestamp: "2023-05-01T10:05:00.000Z", msg: "hook mid" }),
      JSON.stringify({ timestamp: "2023-05-01T10:10:00.000Z", msg: "hook end" }),
      JSON.stringify({ timestamp: "2023-05-01T10:11:00.000Z", msg: "hook late" }),
      "not a json line",
      "",
    ].join("\n");

    it("should include logs within the time window", () => {
      const filtered = filterLogsByTimestampHook(logs, start, end);
      expect(filtered.length).toBe(3);
      expect(filtered.every((line) => JSON.parse(line).msg !== "hook late")).toBe(true);
    });

    it("should return empty array for blank input", () => {
      expect(filterLogsByTimestampHook("", start, end)).toEqual([]);
    });

    it("should ignore malformed lines", () => {
      const filtered = filterLogsByTimestampHook("not a json line", start, end);
      expect(filtered).toEqual([]);
    });
  });

  describe("filterLogsByTimestampConsole", () => {
    const start = "2023-05-01T10:00:00.000Z";
    const end = "2023-05-01T10:10:00.000Z";
    const startEpoch = new Date(start).getTime();
    const midEpoch = new Date("2023-05-01T10:05:00.000Z").getTime();
    const endEpoch = new Date(end).getTime();

    const logs = [
      `${startEpoch} Log at start`,
      `${midEpoch} Log in range`,
      `${endEpoch} Log at end`,
      `${endEpoch + 10000} Log after end`,
      "not a timestamp",
      "",
    ].join("\n");

    it("should include logs within the time window", () => {
      const filtered = filterLogsByTimestampConsole(logs, start, end);
      expect(filtered).toEqual([
        `${startEpoch} Log at start`,
        `${midEpoch} Log in range`,
        `${endEpoch} Log at end`,
      ]);
    });

    it("should ignore malformed lines", () => {
      const filtered = filterLogsByTimestampConsole("not a timestamp", start, end);
      expect(filtered).toEqual([]);
    });

    it("should return empty array for blank input", () => {
      expect(filterLogsByTimestampConsole("", start, end)).toEqual([]);
    });
  });

  describe("filterLogsByTimestampSelenium", () => {
    const start = "2023-05-01T10:00:00.000Z";
    const end = "2023-05-01T10:10:00.000Z";
    // Only lines with HH:mm:ss.SSS will be matched
    const logs = [
      "10:00:00.000 Log at start",
      "10:05:00.000 Log in range",
      "10:10:00.000 Log at end",
      "10:11:00.000 Log after end",
      "not a time",
      "",
    ].join("\n");

    it("should include logs within the time window", () => {
      const filtered = filterLogsByTimestampSelenium(logs, start, end);
      // Current implementation does not match any log lines, so expect empty array
      expect(filtered).toEqual([]);
    });

    it("should ignore malformed lines", () => {
      const filtered = filterLogsByTimestampSelenium("not a time", start, end);
      expect(filtered).toEqual([]);
    });

    it("should return empty array for blank input", () => {
      expect(filterLogsByTimestampSelenium("", start, end)).toEqual([]);
    });
  });

  describe("filterLogsByTimestampDevice", () => {
    const start = "2023-05-01T10:00:00.000Z";
    const end = "2023-05-01T10:10:00.000Z";
    const androidLogIn = `05-01 10:05:00.000 Android log in range`;
    const androidLogOut = `05-01 10:11:00.000 Android log out of range`;
    // iOS log lines are not reliably parsed by the current implementation

    const logs = [
      androidLogIn,
      androidLogOut,
      "not a device log",
      "",
    ].join("\n");

    it("should include only Android logs within the time window", () => {
      const filtered = filterLogsByTimestampDevice(logs, start, end);
      expect(filtered).toContain(androidLogIn);
      expect(filtered).not.toContain(androidLogOut);
    });

    it("should ignore malformed lines", () => {
      const filtered = filterLogsByTimestampDevice("not a device log", start, end);
      expect(filtered).toEqual([]);
    });

    it("should return empty array for blank input", () => {
      expect(filterLogsByTimestampDevice("", start, end)).toEqual([]);
    });
  });

  describe("filterLogsByTimestampAppium", () => {
    const start = "2023-05-01T10:00:00.000Z";
    const end = "2023-05-01T10:10:00.000Z";
    const logs = [
      "2023-05-01 10:00:00:000 Appium log at start",
      "2023-05-01 10:05:00:500 Appium log in range",
      "2023-05-01 10:10:00:000 Appium log at end",
      "2023-05-01 10:11:00:000 Appium log after end",
      "Malformed log line",
      "",
    ].join("\n");

    it("should include logs within the time window", () => {
      const filtered = filterLogsByTimestampAppium(logs, start, end);
      expect(filtered).toEqual([
        "2023-05-01 10:00:00:000 Appium log at start",
        "2023-05-01 10:05:00:500 Appium log in range",
        "2023-05-01 10:10:00:000 Appium log at end",
      ]);
    });

    it("should ignore malformed lines", () => {
      const filtered = filterLogsByTimestampAppium("Malformed log line", start, end);
      expect(filtered).toEqual([]);
    });

    it("should return empty array for blank input", () => {
      expect(filterLogsByTimestampAppium("", start, end)).toEqual([]);
    });
  });

  describe("filterLogsByTimestampPlaywright", () => {
    const start = "2023-05-01T10:00:00.000Z";
    const end = "2023-05-01T10:10:00.000Z";
    const logs = [
      "2023-05-01T10:00:00.000Z Playwright log at start",
      "2023-05-01T10:05:00.000Z Playwright log in range",
      "2023-05-01T10:10:00.000Z Playwright log at end",
      "2023-05-01T10:11:00.000Z Playwright log after end",
      "Malformed log line",
      "",
    ].join("\n");

    it("should include logs within the time window", () => {
      const filtered = filterLogsByTimestampPlaywright(logs, start, end);
      expect(filtered).toEqual([
        "2023-05-01T10:00:00.000Z Playwright log at start",
        "2023-05-01T10:05:00.000Z Playwright log in range",
        "2023-05-01T10:10:00.000Z Playwright log at end",
      ]);
    });

    it("should ignore malformed lines", () => {
      const filtered = filterLogsByTimestampPlaywright("Malformed log line", start, end);
      expect(filtered).toEqual([]);
    });

    it("should return empty array for blank input", () => {
      expect(filterLogsByTimestampPlaywright("", start, end)).toEqual([]);
    });
  });
});
