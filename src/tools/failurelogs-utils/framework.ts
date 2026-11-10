import { AppAutomateLogType } from "../../lib/constants.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  downloadTestCaseFile,
  failedFirst,
  FrameworkBuild,
  FrameworkTestCase,
  getFrameworkTestCases,
  isBrowserStackUrl,
} from "../appautomate-utils/framework-builds.js";

// Per test-case link field, by the log type the tool was asked for.
const LOG_FIELDS: Partial<Record<AppAutomateLogType, string[]>> = {
  [AppAutomateLogType.AppiumLogs]: ["maestro_log", "instrumentation_log"],
  [AppAutomateLogType.DeviceLogs]: ["device_log"],
};

const MAX_TESTS = 5;
const MAX_LOG_DOWNLOAD = 2 * 1024 * 1024;
// The end of a test log is where a failure shows up.
const TAIL_CHARS = 8_000;

function label(test: FrameworkTestCase): string {
  const name = test.className ? `${test.className} › ${test.name}` : test.name;
  return `${name} (${test.status ?? "unknown"})`;
}

function tail(text: string): string {
  return text.length > TAIL_CHARS
    ? `… (last ${TAIL_CHARS} characters)\n${text.slice(-TAIL_CHARS)}`
    : text;
}

/**
 * Logs of one framework session for a requested log type, read from each test
 * case's links. Failed tests come first; at most MAX_TESTS tests are read.
 */
export async function retrieveFrameworkLogs(
  build: FrameworkBuild,
  sessionId: string,
  logType: AppAutomateLogType,
  config: BrowserStackConfig,
): Promise<string> {
  const cases = await getFrameworkTestCases(build, sessionId, config);
  const framework = build.framework.name;
  if (!cases) {
    return `Session ${sessionId} was not found in ${framework} build ${build.buildId}.`;
  }

  if (logType === AppAutomateLogType.CrashLogs) {
    const crashed = cases.filter(
      (c) =>
        typeof c.fields.crash_logs_count === "number" &&
        c.fields.crash_logs_count > 0,
    );
    return crashed.length
      ? `Crashes recorded in this ${framework} session:\n` +
          wrapUntrusted(
            "test names",
            crashed
              .map((c) => `- ${label(c)}: ${c.fields.crash_logs_count}`)
              .join("\n"),
          ) +
          "\nOpen the session on the dashboard to read the crash reports."
      : `No crashes recorded in this ${framework} session.`;
  }

  const fields = LOG_FIELDS[logType] ?? [];
  const withLog = failedFirst(cases).filter((c) =>
    fields.some((f) => isBrowserStackUrl(c.fields[f])),
  );
  if (!withLog.length) {
    return `This ${framework} session has no ${logType} for its tests. Available per test: ${
      [...new Set(cases.flatMap((c) => Object.keys(c.fields)))]
        .filter((f) => /log|video|screenshots|commands/.test(f))
        .join(", ") || "none"
    }.`;
  }

  const parts: string[] = [];
  for (const test of withLog.slice(0, MAX_TESTS)) {
    const field = fields.find((f) => isBrowserStackUrl(test.fields[f]))!;
    const file = await downloadTestCaseFile(
      test.fields[field] as string,
      config,
      {
        maxBytes: MAX_LOG_DOWNLOAD,
      },
    );
    const text = file.tooLarge
      ? "(log over 2 MB; open the session on the dashboard)"
      : tail(
          typeof file.data === "string" ? file.data : JSON.stringify(file.data),
        );
    parts.push(`### ${label(test)} · ${field}\n${text}`);
  }
  const more =
    withLog.length > MAX_TESTS
      ? `\n\n${withLog.length - MAX_TESTS} more test(s) have this log; failed tests are shown first.`
      : "";
  return (
    `${framework} session ${sessionId}, ${logType}:\n` +
    wrapUntrusted("test logs", parts.join("\n\n")) +
    more
  );
}
