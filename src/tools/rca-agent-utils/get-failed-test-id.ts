import { HttpError } from "../../lib/error.js";
import logger from "../../logger.js";
import { getAutomationBaseUrl } from "./constants.js";
import {
  TestStatus,
  FailedTestInfo,
  TestRun,
  TestDetails,
  TestFailureSignature,
} from "./types.js";
import { trackedFetch } from "../../lib/upstream-status.js";

// The error message is kept whole up to this length; stack traces are reduced to one frame.
const ERROR_SUMMARY_MAX = 1000;
const STACK_FRAME_MAX = 300;
// All summaries in one response share this budget, down to ERROR_SUMMARY_MIN per test.
const ERROR_SUMMARY_BUDGET = 20_000;
const ERROR_SUMMARY_MIN = 200;
const STACK_FRAME = /^(at\s|File\s"|from\s\S+:\d+)/;
const LIBRARY_FRAME = /node_modules|node:internal|\(internal\//;

// Safety bound on pagination; hitting it is logged, never silent.
const MAX_PAGES = 100;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await trackedFetch(url, init);
  } catch {
    return await trackedFetch(url, init);
  }
}

export async function getTestIds(
  buildId: string,
  authString: string,
  status?: TestStatus,
  includeFailureDetail = false,
  host: string = getAutomationBaseUrl(),
): Promise<FailedTestInfo[]> {
  // No `status` → returns ALL tests; a `status` narrows the query.
  const baseUrl = `${host}/ext/v1/builds/${buildId}/testRuns`;
  let url = status ? `${baseUrl}?test_statuses=${status}` : baseUrl;
  let allTests: FailedTestInfo[] = [];
  let requestNumber = 0;

  // Construct Basic auth header
  const encodedCredentials = Buffer.from(authString).toString("base64");
  const authHeader = `Basic ${encodedCredentials}`;

  try {
    while (true) {
      requestNumber++;

      const response = await fetchWithRetry(url, {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new HttpError(
          `Failed to fetch test runs: ${response.status} ${response.statusText}`,
          response.status,
        );
      }

      const data = (await response.json()) as TestRun;

      // Extract test IDs from the current page (all tests unless narrowed).
      if (data.hierarchy && data.hierarchy.length > 0) {
        const currentTests = extractTestIds(
          data.hierarchy,
          status,
          includeFailureDetail,
        );
        allTests = allTests.concat(currentTests);
      }

      if (!data.pagination?.has_next || !data.pagination.next_page) {
        break;
      }
      if (requestNumber >= MAX_PAGES) {
        logger.warn(
          `listTestIds: hit MAX_PAGES (${MAX_PAGES}) for build ${buildId}; result may be partial`,
        );
        break;
      }

      const params: Record<string, string> = {
        next_page: data.pagination.next_page,
      };
      if (status) params.test_statuses = status;

      url = `${baseUrl}?${new URLSearchParams(params).toString()}`;
    }

    fitErrorSummaries(allTests);
    return allTests;
  } catch (error) {
    logger.error("Error fetching test runs:", error);
    throw error;
  }
}

export function fitErrorSummaries(tests: FailedTestInfo[]): void {
  const withSummary = tests.filter((test) => test.failure?.error_summary);
  const total = withSummary.reduce(
    (sum, test) => sum + test.failure!.error_summary!.length,
    0,
  );
  if (total <= ERROR_SUMMARY_BUDGET) return;
  const perTest = Math.max(
    ERROR_SUMMARY_MIN,
    Math.floor(ERROR_SUMMARY_BUDGET / withSummary.length),
  );
  for (const test of withSummary) {
    const summary = test.failure!.error_summary!;
    if (summary.length > perTest) {
      test.failure!.error_summary = `${summary.slice(0, perTest)}…`;
    }
  }
}

/**
 * The test listing API serialises a missing BrowserStack session id as the
 * literal string "null", so treat that (and blanks) as absent.
 */
function extractSessionId(rawSessionId: unknown): string | undefined {
  if (typeof rawSessionId !== "string") return undefined;
  const sessionId = rawSessionId.trim();
  return sessionId && sessionId !== "null" ? sessionId : undefined;
}

export function extractTestIds(
  hierarchy: TestDetails[],
  status?: TestStatus,
  includeFailureDetail = false,
): FailedTestInfo[] {
  let tests: FailedTestInfo[] = [];

  for (const node of hierarchy) {
    // observability_url `details=<id>` filters out suite/hook nodes. run_count
    // is not required — JUnit-uploaded builds report run_count=0 for real tests too.
    const nodeStatus = node.details?.status;
    const statusMatches = status === undefined || nodeStatus === status;
    if (statusMatches && node.details?.observability_url) {
      const idMatch = node.details.observability_url.match(/details=(\d+)/);
      if (idMatch) {
        const sessionId = extractSessionId(node.details.session_id);
        const entry: FailedTestInfo = {
          test_id: idMatch[1],
          test_name: node.display_name || `Test ${idMatch[1]}`,
          status: nodeStatus,
          ...(sessionId && { session_id: sessionId }),
        };
        // Failure signatures only exist for failed tests; include when asked.
        if (includeFailureDetail && nodeStatus === TestStatus.FAILED) {
          const signature = buildFailureSignature(node.details);
          if (signature) entry.failure = signature;
        }
        tests.push(entry);
      }
    }

    if (node.children && node.children.length > 0) {
      tests = tests.concat(
        extractTestIds(node.children, status, includeFailureDetail),
      );
    }
  }

  return tests;
}

// Back-compat alias — prefer extractTestIds. Kept so existing imports/tests
// referencing the old name continue to resolve.
export const extractFailedTestIds = extractTestIds;

// Build a trimmed failure signature from a test node's `details`. Returns
// undefined when no signal is available so the field is simply omitted.
function buildFailureSignature(details: any): TestFailureSignature | undefined {
  if (!details) return undefined;

  const signature: TestFailureSignature = {};

  if (details.failure_categories != null) {
    signature.category = Array.isArray(details.failure_categories)
      ? details.failure_categories.filter(Boolean).join(", ")
      : String(details.failure_categories);
  }

  const errorSummary = extractErrorSummary(details);
  if (errorSummary) signature.error_summary = errorSummary;

  if (details.file_path) signature.file_path = String(details.file_path);
  if (typeof details.is_flaky === "boolean")
    signature.is_flaky = details.is_flaky;
  if (typeof details.is_always_failing === "boolean")
    signature.is_always_failing = details.is_always_failing;
  if (typeof details.is_new_failure === "boolean")
    signature.is_new_failure = details.is_new_failure;

  return Object.keys(signature).length > 0 ? signature : undefined;
}

// The first retry's TEST_FAILURE log: the message up to the stack trace, then the first
// stack frame outside libraries. Handles string entries and { message } / { text } objects.
function extractErrorSummary(details: any): string | undefined {
  const retries = details?.retries;
  if (!Array.isArray(retries)) return undefined;

  for (const retry of retries) {
    const failures = retry?.logs?.TEST_FAILURE;
    if (!failures) continue;
    const entries = Array.isArray(failures) ? failures : [failures];
    for (const failure of entries) {
      const text =
        typeof failure === "string"
          ? failure
          : (failure?.message ?? failure?.text ?? "");
      const summary = summarizeError(String(text));
      if (summary) return summary;
    }
  }

  return undefined;
}

function summarizeError(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;

  const firstFrame = lines.findIndex((line) => STACK_FRAME.test(line));
  const messageLines = firstFrame === -1 ? lines : lines.slice(0, firstFrame);
  const frames =
    firstFrame === -1
      ? []
      : lines.slice(firstFrame).filter((line) => STACK_FRAME.test(line));
  const found = frames.find((line) => !LIBRARY_FRAME.test(line)) ?? frames[0];
  const frame =
    found && found.length > STACK_FRAME_MAX
      ? `${found.slice(0, STACK_FRAME_MAX)}…`
      : found;

  let message = messageLines.join("\n");
  if (message.length > ERROR_SUMMARY_MAX) {
    message = `${message.slice(0, ERROR_SUMMARY_MAX)}…`;
  }
  if (!message) return frame;
  return frame ? `${message}\n${frame}` : message;
}
