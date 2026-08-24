import { apiClient } from "../../lib/apiClient.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  getO11yBaseUrl,
  MESSAGE_MAX_LENGTH,
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
 * Build the structured PR payload for the request's `clientContext` channel.
 *
 * `clientContext` is o11y's free-form digest lane: size-capped at 100_000 bytes
 * in `RcaChatService`, forwarded to misc-services unchanged, and folded by the
 * Python `tfa_chat` worker into the turn as a labelled `<untrusted_user_input>`
 * block. It is the correct home for structured evidence.
 *
 * PR objects deliberately no longer go into `message`. Server-side `message` is
 * `@Size(max = 5000)` and the tool validates the CALLER's string against that
 * same 5000 before anything is appended — so appending a stringified PR list
 * (~285 bytes for one PR, ~1095 for four) pushed real turns past the limit and
 * came back as an opaque `failed to submit RCA turn (status 400)`.
 */
function buildPrClientContext(
  prDetails?: readonly PrDetail[],
): Record<string, unknown> | undefined {
  if (!prDetails || prDetails.length === 0) return undefined;
  return { pr_details: prDetails };
}

/**
 * Append a COMPACT PR marker to the message. The full objects travel in
 * `clientContext`; the message keeps only `repo#number` refs so the agent still
 * sees, in the trusted message body, that PR context exists and which PRs it
 * covers — the mandate is preserved without paying the full serialization.
 *
 * Guarded against the very cap this fix exists to respect: the marker is
 * downgraded (refs dropped, then omitted entirely) rather than allowed to push
 * the composed message past MESSAGE_MAX_LENGTH. Dropping the marker loses
 * nothing, because the PRs are in `clientContext` either way.
 */
function composeMessageWithPrMarker(
  message: string,
  prDetails?: readonly PrDetail[],
): string {
  const fits = (suffix: string) =>
    message.length + suffix.length <= MESSAGE_MAX_LENGTH;

  if (!prDetails || prDetails.length === 0) {
    const none = "\n\nPR_DETAILS: none provided";
    return fits(none) ? `${message}${none}` : message;
  }

  const refs = prDetails.map((pr) => `${pr.repo}#${pr.number}`).join(", ");
  const full = `\n\nPR_DETAILS: ${prDetails.length} in clientContext (${refs})`;
  if (fits(full)) return `${message}${full}`;

  const terse = `\n\nPR_DETAILS: ${prDetails.length} in clientContext`;
  return fits(terse) ? `${message}${terse}` : message;
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

    // PR context travels as structured data in the `clientContext` digest lane;
    // the message carries only a bounded marker naming the PRs.
    const composedMessage = composeMessageWithPrMarker(
      args.message,
      args.prDetails,
    );
    const prClientContext = buildPrClientContext(args.prDetails);

    const body: Record<string, unknown> = {
      message: composedMessage,
    };
    // `clientContext`, camelCase: o11y's RcaChatTurnRequest field is
    // `clientContext` and the class is @JsonIgnoreProperties(ignoreUnknown =
    // true), so the previous snake_case `client_context` key never bound and was
    // silently discarded. It also carried a duplicate of `message`, which is why
    // dropping it lost nothing — but it meant the 100_000-byte digest lane went
    // unused while everything was squeezed through the 5000-char `message`.
    if (prClientContext) {
      body.clientContext = prClientContext;
    }
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
