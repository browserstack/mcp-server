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

export async function getTestIds(
  buildId: string,
  authString: string,
  status?: TestStatus,
  includeFailureDetail = false,
): Promise<FailedTestInfo[]> {
  const baseUrl = `${getAutomationBaseUrl()}/ext/v1/builds/${buildId}/testRuns`;
  let url = status ? `${baseUrl}?test_statuses=${status}` : baseUrl;
  let allFailedTests: FailedTestInfo[] = [];
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

      // Extract failed IDs from current page
      if (data.hierarchy && data.hierarchy.length > 0) {
        const currentFailedTests = extractFailedTestIds(
          data.hierarchy,
          status,
          includeFailureDetail,
        );
        allFailedTests = allFailedTests.concat(currentFailedTests);
      }

      // Check for pagination termination conditions
      if (
        !data.pagination?.has_next ||
        !data.pagination.next_page ||
        requestNumber >= 5
      ) {
        break;
      }

      const params: Record<string, string> = {
        next_page: data.pagination.next_page,
      };
      if (status) params.test_statuses = status;

      url = `${baseUrl}?${new URLSearchParams(params).toString()}`;
    }

    // Return unique failed test IDs
    return allFailedTests;
  } catch (error) {
    logger.error("Error fetching failed tests:", error);
    throw error;
  }
}

export function extractFailedTestIds(
  hierarchy: TestDetails[],
  status?: TestStatus,
  includeFailureDetail = false,
): FailedTestInfo[] {
  let failedTests: FailedTestInfo[] = [];

  for (const node of hierarchy) {
    // Match on status alone — the observability_url `details=<id>` check below
    // already filters to real test nodes (suite/hook nodes carry no status and
    // no such URL). Do NOT also require run_count: JUnit-uploaded builds report
    // run_count=0 even for genuinely failed tests, which would drop them all.
    if (node.details?.status === status) {
      if (node.details?.observability_url) {
        const idMatch = node.details.observability_url.match(/details=(\d+)/);
        if (idMatch) {
          const entry: FailedTestInfo = {
            test_id: idMatch[1],
            test_name: node.display_name || `Test ${idMatch[1]}`,
          };
          if (includeFailureDetail) {
            const signature = buildFailureSignature(node.details);
            if (signature) entry.failure = signature;
          }
          failedTests.push(entry);
        }
      }
    }

    if (node.children && node.children.length > 0) {
      failedTests = failedTests.concat(
        extractFailedTestIds(node.children, status, includeFailureDetail),
      );
    }
  }

  return failedTests;
}

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
