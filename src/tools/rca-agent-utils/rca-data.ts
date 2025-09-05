import { FailedTestInfo } from "./get-failed-test-id.js";

export enum RCAState {
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface RCATestCase {
  id: string;
  testRunId: string;
  displayName?: string;
  state: RCAState;
  rcaData?: any;
}

export interface RCAResponse {
  testCases: RCATestCase[];
}

interface ScanProgressContext {
  sendNotification: (notification: any) => Promise<void>;
  _meta?: {
    progressToken?: string | number;
  };
}

// --- Utility functions ---

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function calculateProgress(
  resolvedCount: number,
  totalCount: number,
  baseProgress: number = 10,
): number {
  const progressRange = 90 - baseProgress;
  const completionProgress = (resolvedCount / totalCount) * progressRange;
  return Math.min(100, baseProgress + completionProgress);
}

async function notifyProgress(
  context: ScanProgressContext | undefined,
  message: string,
  progress: number,
) {
  if (!context?.sendNotification) return;

  await context.sendNotification({
    method: "notifications/progress",
    params: {
      progressToken: context._meta?.progressToken?.toString(),
      message,
      progress,
      total: 100,
    },
  });
}

// Helper to send progress based on current test cases
async function updateProgress(
  context: ScanProgressContext | undefined,
  testCases: RCATestCase[],
  message?: string,
) {
  const pending = testCases.filter((tc) => tc.state === RCAState.PENDING);
  const resolvedCount = testCases.length - pending.length;
  await notifyProgress(
    context,
    message ??
      (pending.length === 0
        ? "RCA analysis completed for all test cases"
        : `RCA analysis in progress (${resolvedCount}/${testCases.length} resolved)`),
    pending.length === 0
      ? 100
      : calculateProgress(resolvedCount, testCases.length),
  );
}

// --- Fetch initial RCA for a test case ---
async function fetchInitialRCA(
  testInfo: FailedTestInfo,
  headers: Record<string, string>,
  baseUrl: string,
): Promise<RCATestCase> {
  const url = baseUrl.replace("{testId}", testInfo.id);

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return {
        id: testInfo.id,
        testRunId: testInfo.id,
        displayName: testInfo.displayName,
        state: RCAState.FAILED,
        rcaData: {
          error: `HTTP ${response.status}: Failed to start RCA analysis`,
        },
      };
    }

    const data = await response.json();
    if (data.state && !["pending", "completed"].includes(data.state)) {
      return {
        id: data.id ?? testInfo.id,
        testRunId: data.testRunId ?? testInfo.id,
        displayName: testInfo.displayName,
        state: RCAState.FAILED,
        rcaData: {
          error: `API returned error state: ${data.state}`,
          originalResponse: data,
        },
      };
    }

    return {
      id: data.id ?? testInfo.id,
      testRunId: data.testRunId ?? testInfo.id,
      displayName: testInfo.displayName,
      state: RCAState.PENDING,
    };
  } catch (error) {
    return {
      id: testInfo.id,
      testRunId: testInfo.id,
      displayName: testInfo.displayName,
      state: RCAState.FAILED,
      rcaData: {
        error:
          error instanceof Error ? error.message : "Network or parsing error",
      },
    };
  }
}

// --- Poll all test cases until completion or timeout ---
async function pollRCAResults(
  testCases: RCATestCase[],
  headers: Record<string, string>,
  baseUrl: string,
  context: ScanProgressContext | undefined,
  pollInterval: number,
  timeout: number,
  initialDelay: number,
): Promise<RCAResponse> {
  const startTime = Date.now();

  await delay(initialDelay);

  try {
    while (true) {
      const pendingCases = testCases.filter(
        (tc) => tc.state === RCAState.PENDING,
      );
      await updateProgress(context, testCases);

      if (pendingCases.length === 0) break;

      if (Date.now() - startTime >= timeout) {
        pendingCases.forEach((tc) => {
          tc.state = RCAState.FAILED;
          tc.rcaData = { error: `Timeout after ${timeout}ms` };
        });
        await updateProgress(context, testCases, "RCA analysis timed out");
        break;
      }

      // Poll all pending cases in parallel
      await Promise.allSettled(
        pendingCases.map(async (tc) => {
          try {
            const response = await fetch(baseUrl.replace("{testId}", tc.id), {
              headers,
            });
            if (!response.ok) {
              tc.state = RCAState.FAILED;
              tc.rcaData = { error: `HTTP ${response.status}: Polling failed` };
              return;
            }
            const data = await response.json();
            if (tc.state === RCAState.PENDING) {
              if (data.state === "completed") {
                tc.state = RCAState.COMPLETED;
                tc.rcaData = data;
              } else if (data.state && data.state !== "pending") {
                tc.state = RCAState.FAILED;
                tc.rcaData = {
                  error: `API returned error state: ${data.state}`,
                  originalResponse: data,
                };
              }
            }
          } catch (err) {
            if (tc.state === RCAState.PENDING) {
              tc.state = RCAState.FAILED;
              tc.rcaData = {
                error:
                  err instanceof Error
                    ? err.message
                    : "Network or parsing error",
              };
            }
          }
        }),
      );

      await delay(pollInterval);
    }
  } catch (err) {
    // Fallback in case of unexpected error
    testCases
      .filter((tc) => tc.state === RCAState.PENDING)
      .forEach((tc) => {
        tc.state = RCAState.FAILED;
        tc.rcaData = {
          error: err instanceof Error ? err.message : "Unexpected error",
        };
      });
    await updateProgress(
      context,
      testCases,
      "RCA analysis failed due to unexpected error",
    );
  }

  return { testCases };
}

// --- Public API function ---
export async function getRCAData(
  testInfos: FailedTestInfo[],
  authString: string,
  context?: ScanProgressContext,
): Promise<RCAResponse> {
  const pollInterval = 5000;
  const timeout = 30000;
  const initialDelay = 20000;

  const baseUrl =
    "https://api-observability.browserstack.com/ext/v1/testRun/{testId}/testRca";
  const headers = {
    Authorization: `Basic ${Buffer.from(authString).toString("base64")}`,
    "Content-Type": "application/json",
  };

  await notifyProgress(context, "Starting RCA analysis for test cases...", 0);

  // Step 1: Fire initial RCA requests in parallel
  const testCases = await Promise.all(
    testInfos.map((testInfo) => fetchInitialRCA(testInfo, headers, baseUrl)),
  );

  const pendingCount = testCases.filter(
    (tc) => tc.state === RCAState.PENDING,
  ).length;
  await notifyProgress(
    context,
    `Initial RCA requests completed. ${pendingCount} cases pending analysis...`,
    10,
  );

  if (pendingCount === 0) {
    await notifyProgress(
      context,
      "RCA analysis completed for all test cases",
      100,
    );
    return { testCases };
  }

  // Step 2: Poll pending test cases
  return pollRCAResults(
    testCases,
    headers,
    baseUrl,
    context,
    pollInterval,
    timeout,
    initialDelay,
  );
}
