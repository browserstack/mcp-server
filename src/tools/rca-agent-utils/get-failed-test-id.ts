import logger from "../../logger.js";
import { getAutomationBaseUrl } from "./constants.js";
import {
  TestStatus,
  FailedTestInfo,
  TestRun,
  TestDetails,
  TestFailureSignature,
} from "./types.js";

// Cap on the failure summary line — keep the response payload lean (we never
// return full stack traces into the MCP client's context window).
const ERROR_SUMMARY_MAX = 200;

// Safety bound on pagination — high enough to cover large builds, low enough to
// prevent a runaway loop. Truncation (if ever hit) is logged, never silent.
const MAX_PAGES = 100;

export async function getTestIds(
  buildId: string,
  authString: string,
  status?: TestStatus,
  includeFailureDetail = false,
): Promise<FailedTestInfo[]> {
  // No `status` → no `test_statuses` filter → the endpoint returns ALL tests
  // (the default). A `status` narrows both the query and the extraction.
  const baseUrl = `${getAutomationBaseUrl()}/ext/v1/builds/${buildId}/testRuns`;
  let url = status ? `${baseUrl}?test_statuses=${status}` : baseUrl;
  let allTests: FailedTestInfo[] = [];
  let requestNumber = 0;

  // Construct Basic auth header
  const encodedCredentials = Buffer.from(authString).toString("base64");
  const authHeader = `Basic ${encodedCredentials}`;

  try {
    while (true) {
      requestNumber++;

      const response = await fetch(url, {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch test runs: ${response.status} ${response.statusText}`,
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

      // Paginate to the end. A safety bound prevents a runaway loop, but it is
      // high enough to cover large builds (the old cap of 5 pages silently
      // truncated builds with more than ~5 pages of tests). If we ever hit the
      // bound we log it rather than returning a silently-partial list.
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

    return allTests;
  } catch (error) {
    logger.error("Error fetching test runs:", error);
    throw error;
  }
}

export function extractTestIds(
  hierarchy: TestDetails[],
  status?: TestStatus,
  includeFailureDetail = false,
): FailedTestInfo[] {
  let tests: FailedTestInfo[] = [];

  for (const node of hierarchy) {
    // Include every REAL test node. The observability_url `details=<id>` check
    // already filters out suite/hook nodes (they carry no such URL). We do NOT
    // require run_count: JUnit-uploaded builds report run_count=0 even for
    // genuine tests, which would drop them all.
    // Status filtering is optional: when `status` is omitted we return ALL
    // tests (the default); when provided we narrow to that status.
    const nodeStatus = node.details?.status;
    const statusMatches = status === undefined || nodeStatus === status;
    if (statusMatches && node.details?.observability_url) {
      const idMatch = node.details.observability_url.match(/details=(\d+)/);
      if (idMatch) {
        const entry: FailedTestInfo = {
          test_id: idMatch[1],
          test_name: node.display_name || `Test ${idMatch[1]}`,
          status: nodeStatus,
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

  const errorSummary = extractFirstFailureLine(details);
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

// First non-empty line of the first retry's TEST_FAILURE log, capped. Handles
// both string entries and object entries ({ message } / { text }).
function extractFirstFailureLine(details: any): string | undefined {
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
      const firstLine = String(text)
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (firstLine) return firstLine.slice(0, ERROR_SUMMARY_MAX);
    }
  }

  return undefined;
}
