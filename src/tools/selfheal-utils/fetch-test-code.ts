import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import logger from "../../logger.js";

const OBSERVABILITY_API_BASE = "https://api-automation.browserstack.com/ext/v1";

export interface TestCodeEntry {
  testRunId: number;
  code: string | null;
  filename: string | null;
  url: string | null;
}

/**
 * Why a session's test code fetch succeeded or failed, so downstream callers
 * can phrase their "please give me the file" prompt correctly:
 *   - ok:               entries returned with real `code`/`filename`.
 *   - non_sdk_build:    HTTP 200, entries present but every entry has
 *                       `code === null && filename === null`. Classic signature
 *                       of a non-SDK Automate build — the source is not
 *                       introspectable via the API, so ask the user for the
 *                       file path.
 *   - empty:            HTTP 200 with no entries — session had no tests.
 *   - unauthorized:     401 — credentials are wrong/expired. Offer retry.
 *   - forbidden:        403 — credentials valid but no access to this session.
 *   - not_found:        404 — session id is wrong.
 *   - error:            any other transport/network failure.
 */
export type TestCodeFetchStatus =
  | "ok"
  | "non_sdk_build"
  | "empty"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "error";

export interface SessionTestCode {
  sessionId: string;
  tests: TestCodeEntry[];
  status: TestCodeFetchStatus;
  httpStatus?: number;
  errorMessage?: string;
}

function classifyByHttpStatus(status: number): TestCodeFetchStatus {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "error";
}

function classifyOkResponse(
  tests: TestCodeEntry[],
): Exclude<
  TestCodeFetchStatus,
  "unauthorized" | "forbidden" | "not_found" | "error"
> {
  if (tests.length === 0) return "empty";
  const allNullCode = tests.every(
    (t) => t.code === null && t.filename === null,
  );
  return allNullCode ? "non_sdk_build" : "ok";
}

/**
 * Fetches the test code for all tests in a given session from the
 * Observability API.
 *
 * Endpoint: GET /ext/v1/sessions/{sessionId}/testCode
 * Returns: Array of { testRunId, code, filename, url }
 */
export async function fetchTestCodeBySession(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<SessionTestCode> {
  if (!sessionId) {
    throw new Error("sessionId is required to fetch test code");
  }

  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const url = `${OBSERVABILITY_API_BASE}/sessions/${encodeURIComponent(sessionId)}/testCode`;

  try {
    const response = await apiClient.get<TestCodeEntry[]>({
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      raise_error: false,
    });

    if (!response.ok) {
      logger.warn(
        `Failed to fetch test code for session ${sessionId}: HTTP ${response.status}`,
      );
      return {
        sessionId,
        tests: [],
        status: classifyByHttpStatus(response.status),
        httpStatus: response.status,
      };
    }

    const tests = Array.isArray(response.data) ? response.data : [];
    return {
      sessionId,
      tests,
      status: classifyOkResponse(tests),
      httpStatus: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Error fetching test code for session ${sessionId}: ${message}`,
    );
    return {
      sessionId,
      tests: [],
      status: "error",
      errorMessage: message,
    };
  }
}

/**
 * Builds a directive guidance block for the calling LLM when one or more
 * sessions did not return usable test code. Each status block contains:
 *   - A diagnosis (what happened, per BrowserStack)
 *   - An explicit "do NOT paraphrase this as X" constraint
 *   - A ready-to-say phrasing the LLM can quote when replying to the user
 *
 * Returns empty string when every session returned `status: ok`.
 */
export function describeTestCodeFetchIssues(
  sessionTestCodes: SessionTestCode[],
): string {
  if (sessionTestCodes.length === 0) return "";

  const byStatus = new Map<TestCodeFetchStatus, string[]>();
  for (const s of sessionTestCodes) {
    if (!byStatus.has(s.status)) byStatus.set(s.status, []);
    byStatus.get(s.status)!.push(s.sessionId);
  }

  const notes: string[] = [];

  const nonSdk = byStatus.get("non_sdk_build");
  if (nonSdk && nonSdk.length > 0) {
    const ids = nonSdk.join(", ");
    notes.push(
      [
        `### Non-SDK build — session(s): ${ids}`,
        "",
        "Diagnosis: BrowserStack's test-code API returned HTTP 200 with rows " +
          "where `code` and `filename` are null. This is the KNOWN signature " +
          "of a BrowserStack run that was NOT instrumented with the " +
          "BrowserStack SDK / Observability. The API literally has no source " +
          "code to return for these sessions — this is by design.",
        "",
        "DO NOT tell the user any of the following (all are wrong for this " +
          "status): 'credentials issue', 'credentials or session issue', " +
          "'could not fetch from the API due to auth', '401', 'unauthorized'. " +
          "The credentials are fine; the build just isn't SDK-enabled.",
        "",
        "Say this (or very close to it) to the user, then wait for their reply:",
        '  "This is a non-SDK BrowserStack build, so the test-code API has ' +
          "no source to return for it (this is expected, not a credentials " +
          "problem). Can you tell me the local file path where these tests live? " +
          "Once I have the file, I'll apply the healed locators listed in the plan.\"",
      ].join("\n"),
    );
  }

  const unauthorized = byStatus.get("unauthorized");
  if (unauthorized && unauthorized.length > 0) {
    const ids = unauthorized.join(", ");
    notes.push(
      [
        `### Unauthorized (HTTP 401) — session(s): ${ids}`,
        "",
        "Diagnosis: BrowserStack's test-code API rejected the credentials " +
          "(HTTP 401). This IS an authentication problem for this specific " +
          "API — the healing report endpoint and test-code endpoint use the " +
          "same BrowserStack auth, so if the report fetch above succeeded " +
          "with the same creds, suspect that the access key was rotated or " +
          "that the user supplied a different key for this call.",
        "",
        "DO NOT say 'credentials or session issue' (that hides the real cause). " +
          "Name the 401 explicitly and offer the user a choice.",
        "",
        "Say this (or very close to it) to the user, then wait for their reply:",
        '  "The BrowserStack test-code API returned 401 Unauthorized for ' +
          `session(s) ${ids}. Would you like to: (a) re-run this with an updated ` +
          "BrowserStack username + access key, or (b) skip the API and point me " +
          'at the local test file so I can apply the healed locators there?"',
      ].join("\n"),
    );
  }

  const forbidden = byStatus.get("forbidden");
  if (forbidden && forbidden.length > 0) {
    const ids = forbidden.join(", ");
    notes.push(
      [
        `### Forbidden (HTTP 403) — session(s): ${ids}`,
        "",
        "Diagnosis: BrowserStack's test-code API accepted the credentials " +
          "but denied access to the session's source (HTTP 403). Typically " +
          "the user does not own this session, or the account does not have " +
          "Observability enabled.",
        "",
        "Do NOT blame the credentials broadly — say 'access denied for this " +
          "session' and move on.",
        "",
        "Say this (or very close to it) to the user:",
        `  "BrowserStack denied access (HTTP 403) to session(s) ${ids}. ` +
          "This usually means the account does not own these sessions or " +
          "does not have Observability enabled. Can you either share the " +
          'local test file path, or confirm which account these sessions belong to?"',
      ].join("\n"),
    );
  }

  const notFound = byStatus.get("not_found");
  if (notFound && notFound.length > 0) {
    const ids = notFound.join(", ");
    notes.push(
      [
        `### Not found (HTTP 404) — session(s): ${ids}`,
        "",
        "Diagnosis: BrowserStack returned HTTP 404 — the session id is most " +
          "likely wrong, or the session has been purged.",
        "",
        "Do NOT say 'credentials'. Ask the user to verify the id.",
        "",
        "Say this (or very close to it) to the user:",
        `  "I couldn't find session(s) ${ids} on BrowserStack (HTTP 404). ` +
          "Can you double-check the session id(s), or share the local test " +
          'file directly so I can apply the healed locators?"',
      ].join("\n"),
    );
  }

  const empty = byStatus.get("empty");
  if (empty && empty.length > 0) {
    const ids = empty.join(", ");
    notes.push(
      [
        `### No test runs recorded — session(s): ${ids}`,
        "",
        "Diagnosis: HTTP 200 with an empty array — the session executed but " +
          "no test code was captured (e.g. a raw Selenium session not linked " +
          "to a test framework).",
        "",
        "Say this (or very close to it) to the user:",
        `  "BrowserStack has no test code recorded for session(s) ${ids}. ` +
          'Can you point me at the local test file where these locators live?"',
      ].join("\n"),
    );
  }

  const errored = byStatus.get("error");
  if (errored && errored.length > 0) {
    const details = sessionTestCodes
      .filter((s) => s.status === "error")
      .map((s) => `${s.sessionId}: ${s.errorMessage ?? "unknown error"}`)
      .join("; ");
    notes.push(
      [
        `### Transport error — session(s): ${errored.join(", ")}`,
        "",
        `Diagnosis: network/transport failure — ${details}. This is not an ` +
          "auth issue.",
        "",
        "Say this (or very close to it) to the user:",
        `  "I hit a transport error fetching test code from BrowserStack ` +
          `(${details}). Want me to retry, or would you prefer to share the ` +
          'local test file directly?"',
      ].join("\n"),
    );
  }

  return notes.join("\n\n");
}

/**
 * Fetches test code for multiple sessions in parallel.
 * Failures for individual sessions are logged and skipped (partial results).
 */
export async function fetchTestCodeForSessions(
  sessionIds: string[],
  config: BrowserStackConfig,
): Promise<SessionTestCode[]> {
  const results = await Promise.allSettled(
    sessionIds.map((id) => fetchTestCodeBySession(id, config)),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<SessionTestCode> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);
}

/**
 * Formats test code entries into a concise context string suitable for
 * inclusion in an LLM prompt. Groups by file, includes code snippets.
 */
export function formatTestCodeAsContext(
  sessionTestCodes: SessionTestCode[],
): string {
  const sections: string[] = [];

  for (const session of sessionTestCodes) {
    const testsWithCode = session.tests.filter((t) => t.code);
    if (testsWithCode.length === 0) continue;

    const testLines = testsWithCode.map((t) => {
      const fileInfo = t.filename ? `File: ${t.filename}` : "File: unknown";
      const urlInfo = t.url ? `URL: ${t.url}` : "";
      const header = [fileInfo, urlInfo].filter(Boolean).join("\n");
      return `${header}\n\`\`\`\n${t.code}\n\`\`\``;
    });

    sections.push(`Session: ${session.sessionId}\n${testLines.join("\n\n")}`);
  }

  if (sections.length === 0) {
    return "";
  }

  return `\n--- Test Code Context ---\n${sections.join("\n\n")}\n--- End Test Code Context ---\n`;
}
