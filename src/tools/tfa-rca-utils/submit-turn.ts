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

/** PR-context tag: a fresh regression PR vs. a pre-existing (latent) one. */
export type PrTag = "latent" | "regression";

/**
 * One suspect PR passed as investigation context to the TFA agent. Every field
 * is required by contract — a partial PR object is rejected rather than sent,
 * since incomplete/missing PR context is exactly what previously misled the agent.
 *
 * Identity is `repo` + `number`, never the bare number: a PR number is unique
 * only within its repo, so two repos can share a number and collapse into one
 * card if keyed on number alone. `link` must be the canonical
 * `https://github.com/<repo>/pull/<number>` so it cannot cross-join or 404.
 */
export interface PrDetail {
  repo: string;
  number: number;
  title: string;
  author: string;
  link: string;
  tag: PrTag;
}

export interface TfaRcaTurnArgs {
  testRunId: string;
  message: string;
  /** Suspect PRs as context. Optional, but each entry must satisfy PrDetail. */
  prDetails?: PrDetail[];
  threadId?: string;
  /** Resume polling an already-submitted turn without re-submitting. */
  turnId?: string;
}

const PR_TAGS: readonly PrTag[] = ["latent", "regression"];

/**
 * Enforce the PR-details contract. The list is optional, but any entry present
 * MUST carry every field (title, author, link, number, tag with a valid value);
 * a partial PR object is rejected rather than silently forwarded.
 */
function validatePrDetails(prDetails: readonly PrDetail[]): void {
  prDetails.forEach((pr, i) => {
    if (!pr || typeof pr !== "object") {
      throw new TfaRcaTurnError(`prDetails[${i}] is not an object`);
    }
    const missing: string[] = [];
    if (!pr.repo) missing.push("repo");
    if (pr.number === undefined || pr.number === null) missing.push("number");
    if (!pr.title) missing.push("title");
    if (!pr.author) missing.push("author");
    if (!pr.link) missing.push("link");
    if (!pr.tag) missing.push("tag");
    if (missing.length > 0) {
      throw new TfaRcaTurnError(
        `prDetails[${i}] missing required field(s): ${missing.join(", ")}`,
      );
    }
    if (!PR_TAGS.includes(pr.tag)) {
      throw new TfaRcaTurnError(
        `prDetails[${i}].tag must be one of: ${PR_TAGS.join(", ")}`,
      );
    }
    // Identity is repo+number; the link must be the canonical PR URL for that
    // repo+number so cards can't cross-join across repos or 404 on a bad join.
    if (!pr.link.includes(`/${pr.repo}/pull/${pr.number}`)) {
      throw new TfaRcaTurnError(
        `prDetails[${i}].link must be the canonical URL for ${pr.repo}#${pr.number} ` +
          `(https://github.com/${pr.repo}/pull/${pr.number})`,
      );
    }
  });
}

/**
 * Compose the message body sent to the TFA agent. PR context is ALWAYS passed
 * (the mandate): a validated PR list is appended as a stringified PR_DETAILS
 * block, or an explicit "none provided" marker when absent — so the agent never
 * silently loses the PR context the way it did before.
 */
function composeMessageWithPrDetails(
  message: string,
  prDetails?: readonly PrDetail[],
): string {
  if (!prDetails || prDetails.length === 0) {
    return `${message}\n\nPR_DETAILS: none provided`;
  }
  return `${message}\n\nPR_DETAILS: ${JSON.stringify(prDetails)}`;
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

    // Validate the PR contract before sending; a partial PR object is rejected
    // rather than forwarded as misleading context.
    if (args.prDetails) {
      validatePrDetails(args.prDetails);
    }

    // PR context is always concatenated onto the message payload sent to TFA.
    const composedMessage = composeMessageWithPrDetails(
      args.message,
      args.prDetails,
    );

    const body: Record<string, unknown> = {
      message: composedMessage,
      client_context: composedMessage,
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
