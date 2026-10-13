import { RCAState, RCATestCase, RCAResponse } from "./types.js";
import { encodePathSegment } from "../../lib/url-path.js";

interface ScanProgressContext {
  sendNotification: (notification: any) => Promise<void>;
  _meta?: {
    progressToken?: string | number;
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isInProgressState(state: RCAState): boolean {
  return [
    RCAState.PENDING,
    RCAState.FETCHING_LOGS,
    RCAState.GENERATING_RCA,
    RCAState.GENERATED_RCA,
  ].includes(state);
}

function isFailedState(state: RCAState): boolean {
  return [
    RCAState.FAILED,
    RCAState.LLM_SERVICE_ERROR,
    RCAState.LOG_FETCH_ERROR,
    RCAState.UNKNOWN_ERROR,
    RCAState.TIMEOUT,
  ].includes(state);
}

function calculateProgress(
  resolvedCount: number,
  totalCount: number,
  baseProgress: number = 10,
): number {
  if (totalCount === 0) return 100; // ✅ fix divide by zero
  const progressRange = 90 - baseProgress;
  const completionProgress = (resolvedCount / totalCount) * progressRange;
  return Math.min(100, baseProgress + completionProgress);
}

// ✅ centralized mapping function
function mapApiState(apiState?: string): RCAState {
  const state = apiState?.toLowerCase();
  switch (state) {
    case "completed":
      return RCAState.COMPLETED;
    case "pending":
      return RCAState.PENDING;
    case "fetching_logs":
      return RCAState.FETCHING_LOGS;
    case "generating_rca":
      return RCAState.GENERATING_RCA;
    case "generated_rca":
      return RCAState.GENERATED_RCA;
    case "error":
      return RCAState.UNKNOWN_ERROR;
    default:
      return RCAState.UNKNOWN_ERROR;
  }
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

async function updateProgress(
  context: ScanProgressContext | undefined,
  testCases: RCATestCase[],
  message?: string,
) {
  const inProgressCases = testCases.filter((tc) => isInProgressState(tc.state));
  const resolvedCount = testCases.length - inProgressCases.length;

  await notifyProgress(
    context,
    message ??
      `RCA analysis in progress (${resolvedCount}/${testCases.length} resolved)`,
    inProgressCases.length === 0
      ? 100
      : calculateProgress(resolvedCount, testCases.length),
  );
}

async function fetchInitialRCA(
  testId: number,
  headers: Record<string, string>,
  baseUrl: string,
): Promise<RCATestCase> {
  const url = baseUrl.replace("{testId}", encodePathSegment(testId));

  try {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      return {
        id: testId,
        testRunId: testId,
        state: RCAState.LOG_FETCH_ERROR,
        rcaData: {
          error: `HTTP ${response.status}: Failed to start RCA analysis`,
        },
      };
    }

    const data = await response.json();
    const resultState = mapApiState(data.state);

    return {
      id: testId,
      testRunId: testId,
      state: resultState,
      ...(resultState === RCAState.COMPLETED && { rcaData: data }),
      ...(isFailedState(resultState) &&
        data.state && {
          rcaData: {
            error: `API returned state: ${data.state}`,
            originalResponse: data,
          },
        }),
    };
  } catch (error) {
    return {
      id: testId,
      testRunId: testId,
      state: RCAState.LLM_SERVICE_ERROR,
      rcaData: {
        error:
          error instanceof Error ? error.message : "Network or parsing error",
      },
    };
  }
}

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
      const inProgressCases = testCases.filter((tc) =>
        isInProgressState(tc.state),
      );
      await updateProgress(context, testCases);

      if (inProgressCases.length === 0) break;

      if (Date.now() - startTime >= timeout) {
        inProgressCases.forEach((tc) => {
          tc.state = RCAState.TIMEOUT;
          tc.rcaData = { error: `Timeout after ${timeout}ms` };
        });
        await updateProgress(context, testCases, "RCA analysis timed out");
        break;
      }

      await Promise.allSettled(
        inProgressCases.map(async (tc) => {
          try {
            const pollUrl = baseUrl.replace(
              "{testId}",
              encodePathSegment(tc.id),
            );
            const response = await fetch(pollUrl, { headers });
            if (!response.ok) {
              const errorText = await response.text();
              tc.state = RCAState.LOG_FETCH_ERROR;
              tc.rcaData = {
                error: `HTTP ${response.status}: Polling failed - ${errorText}`,
              };
              return;
            }

            const data = await response.json();
            if (!isFailedState(tc.state)) {
              const mappedState = mapApiState(data.state);
              tc.state = mappedState;

              if (mappedState === RCAState.COMPLETED) {
                tc.rcaData = data;
              } else if (mappedState === RCAState.UNKNOWN_ERROR) {
                tc.rcaData = {
                  error: `API returned state: ${data.state}`,
                  originalResponse: data,
                };
              }
            }
          } catch (err) {
            if (!isFailedState(tc.state)) {
              tc.state = RCAState.LLM_SERVICE_ERROR;
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
    testCases
      .filter((tc) => isInProgressState(tc.state))
      .forEach((tc) => {
        tc.state = RCAState.UNKNOWN_ERROR;
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

export async function getRCAData(
  testIds: number[],
  authString: string,
  context?: ScanProgressContext,
): Promise<RCAResponse> {
  const pollInterval = 5000;
  const timeout = 40000;
  const initialDelay = 20000;

  const baseUrl =
    "https://api-observability.browserstack.com/ext/v1/testRun/{testId}/testRca";
  const headers = {
    Authorization: `Basic ${Buffer.from(authString).toString("base64")}`,
    "Content-Type": "application/json",
  };

  await notifyProgress(context, "Starting RCA analysis for test cases...", 0);

  const testCases = await Promise.all(
    testIds.map((testId) => fetchInitialRCA(testId, headers, baseUrl)),
  );

  const inProgressCount = testCases.filter((tc) =>
    isInProgressState(tc.state),
  ).length;

  await notifyProgress(
    context,
    `Initial RCA requests completed. ${inProgressCount} cases pending analysis...`,
    10,
  );

  if (inProgressCount === 0) return { testCases };

  return await pollRCAResults(
    testCases,
    headers,
    baseUrl,
    context,
    pollInterval,
    timeout,
    initialDelay,
  );
}
