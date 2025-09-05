interface TestDetails {
  status: string;
  details: any;
  children?: TestDetails[];
  display_name?: string;
}

interface TestRun {
  hierarchy: TestDetails[];
  pagination?: {
    has_next: boolean;
    next_page: string | null;
  };
}

export interface FailedTestInfo {
  id: string;
  displayName: string;
}

export async function getFailedTestIds(
  buildId: string,
  authString: string,
): Promise<FailedTestInfo[]> {
  const baseUrl = `https://api-automation.browserstack.com/ext/v1/builds/${buildId}/testRuns?test_statuses=failed`;
  let nextUrl = baseUrl;
  let allFailedTests: FailedTestInfo[] = [];
  let requestNumber = 0;

  // Construct Basic auth header
  const encodedCredentials = Buffer.from(authString).toString("base64");
  const authHeader = `Basic ${encodedCredentials}`;

  try {
    while (true) {
      requestNumber++;

      const response = await fetch(nextUrl, {
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
        const currentFailedTests = extractFailedTestIds(data.hierarchy);
        allFailedTests = allFailedTests.concat(currentFailedTests);
      }

      // Check for pagination termination conditions
      if (!data.pagination?.has_next || !data.pagination.next_page) {
        break;
      }

      // Safety limit to prevent runaway requests
      if (requestNumber >= 5) {
        break;
      }

      // Prepare next request
      nextUrl = `${baseUrl}?next_page=${encodeURIComponent(data.pagination.next_page)}`;
    }

    // Return unique failed test IDs
    return allFailedTests;
  } catch (error) {
    console.error("Error fetching failed tests:", error);
    throw error;
  }
}

// Recursive function to extract failed test IDs from hierarchy
function extractFailedTestIds(hierarchy: TestDetails[]): FailedTestInfo[] {
  let failedTests: FailedTestInfo[] = [];

  for (const node of hierarchy) {
    if (node.details?.status === "failed" && node.details?.run_count) {
      if (node.details?.observability_url) {
        const idMatch = node.details.observability_url.match(/details=(\d+)/);
        if (idMatch) {
          failedTests.push({
            id: idMatch[1],
            displayName: node.display_name || `Test ${idMatch[1]}`
          });
        }
      }
    }

    if (node.children && node.children.length > 0) {
      failedTests = failedTests.concat(extractFailedTestIds(node.children));
    }
  }

  return failedTests;
}
