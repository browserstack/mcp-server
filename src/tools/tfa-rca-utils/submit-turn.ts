import { apiClient } from "../../lib/apiClient.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  getO11yBaseUrl,
  POLL_INITIAL_DELAY_MS,
  POLL_INTERVAL_MS,
  POLL_MAX_WAIT_MS,
  RCA_CHAT_SUBMIT_PATH,
} from "./constants.js";
import { PENDING_STATUS, TfaRcaTurnResult } from "./types.js";
import {
  buildAuthHeader,
  buildPollUrl,
  readStructuredTurn,
  TfaRcaTurnError,
  toTrimmedResult,
} from "./turn-result.js";

// Re-exported so existing importers keep a single entry point for the error type.
export { TfaRcaTurnError };

interface TurnContext {
  sendNotification?: (notification: any) => Promise<void>;
  _meta?: { progressToken?: string | number };
}

export interface TfaRcaTurnArgs {
  testRunId: string;
  message: string;
  threadId?: string;
  /** Resume polling an already-submitted turn without re-submitting. */
  turnId?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function notify(
  context: TurnContext | undefined,
  message: string,
  progress: number,
): Promise<void> {
  if (!context?.sendNotification) return;
  await context.sendNotification({
    method: "notifications/progress",
    params: {
      progressToken: context._meta?.progressToken?.toString() ?? "tfa-rca-turn",
      message,
      progress,
      total: 100,
    },
  });
}

/** Map a submit (POST) non-2xx into a clean, group-scope-safe domain error. */
function mapSubmitError(status: number): TfaRcaTurnError {
  if (status === 403) {
    return new TfaRcaTurnError("AI consent not enabled for this group");
  }
  if (status === 404) {
    return new TfaRcaTurnError("test run not found for your group");
  }
  return new TfaRcaTurnError(`failed to submit RCA turn (status ${status})`);
}

/**
 * Submit one collaborative RCA turn to the o11y `rcaChat` proxy and poll to
 * completion, returning a trimmed structured result. Stateless: all identifiers
 * are function-scoped; nothing persists between calls.
 */
export async function submitTfaRcaTurn(
  args: TfaRcaTurnArgs,
  config: BrowserStackConfig,
  context?: TurnContext,
): Promise<TfaRcaTurnResult> {
  const authHeader = buildAuthHeader(config);
  const headers = {
    "Content-Type": "application/json",
    Authorization: authHeader,
  };

  const baseUrl = getO11yBaseUrl();

  let turnId = args.turnId;
  let threadId = args.threadId;

  // Submit only when we are not resuming an existing turn.
  if (!turnId) {
    const submitUrl =
      baseUrl + RCA_CHAT_SUBMIT_PATH.replace("{testRunId}", args.testRunId);

    await notify(context, "Submitting RCA turn to TFA agent...", 5);

    const body: Record<string, unknown> = {
      message: args.message,
      client_context: args.message,
    };
    if (args.threadId) {
      body.thread_id = args.threadId;
    }

    const submitResponse = await apiClient.post({
      url: submitUrl,
      headers,
      body,
      raise_error: false,
    });

    if (!submitResponse.ok) {
      throw mapSubmitError(submitResponse.status);
    }

    const data = submitResponse.data ?? {};
    turnId = data.turnId;
    threadId = data.threadId ?? threadId;

    if (!turnId) {
      throw new TfaRcaTurnError("turn expired or not found");
    }
  }

  // Poll to completion, soft-PENDING on wall-clock cap.
  const pollUrl = buildPollUrl(args.testRunId, turnId);

  await delay(POLL_INITIAL_DELAY_MS);
  const startTime = Date.now();

  while (true) {
    const pollResponse = await apiClient.get({
      url: pollUrl,
      headers,
      raise_error: false,
    });

    if (pollResponse.status === 404) {
      throw new TfaRcaTurnError("turn expired or not found");
    }

    if (pollResponse.ok) {
      const data = pollResponse.data ?? {};
      const status: string = data.status;
      threadId = data.threadId ?? threadId;

      if (status === "failed") {
        throw new TfaRcaTurnError(data.error || "TFA agent run failed");
      }

      if (status === "completed") {
        const turn = readStructuredTurn(data);
        await notify(context, "TFA agent turn complete.", 100);
        return toTrimmedResult(turn, threadId);
      }
      // status === "working" (or any other in-progress value) → keep polling.
    }
    // Transient non-2xx (other than 404) during polling: classify and continue.

    if (Date.now() - startTime >= POLL_MAX_WAIT_MS) {
      await notify(context, "TFA agent still working; will resume later.", 90);
      // PENDING keeps only what the skill needs to resume polling.
      return {
        status: PENDING_STATUS,
        threadId,
        turnId,
      };
    }

    await notify(context, "Waiting for TFA agent reply...", 50);
    await delay(POLL_INTERVAL_MS);
  }
}
