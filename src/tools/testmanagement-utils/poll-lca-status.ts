import { apiClient } from "../../lib/apiClient.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Interface for the test case response structure
 */
interface TestCaseResponse {
  data: {
    success: boolean;
    test_case?: {
      id: number;
      identifier: string;
      name: string;
      lcnc_build_map?: {
        resource_path: string;
        status: string;
      };
    };
    metadata?: {
      lcnc_build_map?: {
        resource_path: string;
        status: string;
      };
    };
  };
}

/**
 * Poll test case details to check LCA build status
 */
export async function pollLCAStatus(
  projectId: string,
  folderId: string,
  testCaseId: string,
  context: any,
  maxWaitTimeMs: number = 10 * 60 * 1000, // 10 minutes default
  initialWaitMs: number = 2 * 60 * 1000, // 2 minutes initial wait
  pollIntervalMs: number = 10 * 1000, // 10 seconds interval
  config: BrowserStackConfig,
): Promise<{ resource_path: string; status: string } | null> {
  const tmBaseUrl = await getTMBaseURL(config);
  const url = `${tmBaseUrl}/api/v1/projects/${projectId}/folder/${folderId}/test-cases/${testCaseId}`;

  const startTime = Date.now();

  // Send initial notification that polling is starting
  const notificationInterval = Math.min(initialWaitMs, pollIntervalMs);
  const notificationStartTime = Date.now();

  const notificationIntervalId = setInterval(async () => {
    const elapsedTime = Date.now() - notificationStartTime;
    const progressPercentage = Math.min(
      90,
      Math.floor((elapsedTime / maxWaitTimeMs) * 90),
    );

    await context.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken: context._meta?.progressToken ?? `lca-${testCaseId}`,
        message: `Generating Low Code Automation Test..`,
        progress: progressPercentage,
        total: 100,
      },
    });

    if (elapsedTime >= initialWaitMs) {
      clearInterval(notificationIntervalId);
    }
  }, notificationInterval);

  // Wait for initial period before starting to poll
  await new Promise((resolve) => setTimeout(resolve, initialWaitMs));
  clearInterval(notificationIntervalId);

  return new Promise((resolve) => {
    // Set up timeout to handle max wait time
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      // Send timeout notification
      context.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: context._meta?.progressToken ?? `lca-${testCaseId}`,
          message: `LCA build polling timed out after ${Math.floor(maxWaitTimeMs / 60000)} minutes`,
          progress: 100,
          total: 100,
        },
      });
      resolve(null);
    }, maxWaitTimeMs);

    // Set up polling interval
    const intervalId = setInterval(async () => {
      try {
        const authString = getBrowserStackAuth(config);
        const response = await apiClient.get({
          url,
          headers: {
            "API-TOKEN": authString,
            accept: "application/json, text/plain, */*",
          },
        });

        const responseData: TestCaseResponse = response.data;

        if (responseData.data.success && responseData.data.test_case) {
          const testCase = responseData.data.test_case;

          // Check lcnc_build_map in both possible locations
          const lcncBuildMap =
            testCase.lcnc_build_map ||
            responseData.data.metadata?.lcnc_build_map;

          if (lcncBuildMap) {
            if (lcncBuildMap.status === "done") {
              // Clean up timers
              clearInterval(intervalId);
              clearTimeout(timeoutId);

              // Send completion notification
              await context.sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken:
                    context._meta?.progressToken ?? `lca-${testCaseId}`,
                  message: `LCA build completed successfully!`,
                  progress: 100,
                  total: 100,
                },
              });

              resolve({
                resource_path: lcncBuildMap.resource_path,
                status: lcncBuildMap.status,
              });
              return;
            }

            // Send progress notification with current status
            const elapsedTime = Date.now() - startTime;
            const progressPercentage = Math.min(
              90,
              Math.floor((elapsedTime / maxWaitTimeMs) * 90) + 10,
            );

            // Cycle through different numbers of dots (2, 3, 4, 5, then back to 2)
            const dotCount = (Math.floor(elapsedTime / pollIntervalMs) % 4) + 2;
            const dots = ".".repeat(dotCount);

            await context.sendNotification({
              method: "notifications/progress",
              params: {
                progressToken:
                  context._meta?.progressToken ?? `lca-${testCaseId}`,
                message: `Generating Low Code Automation Test${dots}`,
                progress: progressPercentage,
                total: 100,
              },
            });
          }
        }
      } catch (error) {
        console.error("Error polling LCA status:", error);

        // Send error notification but continue polling
        await context.sendNotification({
          method: "notifications/progress",
          params: {
            progressToken: context._meta?.progressToken ?? `lca-${testCaseId}`,
            message: `Error occurred while polling, retrying... (${error instanceof Error ? error.message : "Unknown error"})`,
            progress: Math.min(
              90,
              Math.floor(((Date.now() - startTime) / maxWaitTimeMs) * 90) + 10,
            ),
            total: 100,
          },
        });
      }
    }, pollIntervalMs);
  });
}
