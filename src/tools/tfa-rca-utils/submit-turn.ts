import { apiClient } from "../../lib/apiClient.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  getO11yBaseUrl,
  getRcaViewGuidance,
  POLL_INITIAL_DELAY_MS,
  POLL_INTERVAL_MS,
  POLL_MAX_WAIT_MS,
  RCA_CHAT_POLL_PATH,
  RCA_CHAT_SUBMIT_PATH,
  RCA_GLIMPSE_ROOT_CAUSE_MAX,
} from "./constants.js";
import {
  PENDING_STATUS,
  TfaAsk,
  TfaRcaTurnResult,
  TfaStatus,
  TurnResponse,
} from "./types.js";

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

/**
 * Domain error carrying a client-safe message. The tool maps these to a
 * `{ isError: true }` envelope; the message never contains credentials.
 */
export class TfaRcaTurnError extends Error {}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildAuthHeader(config: BrowserStackConfig): string {
  const authString = getBrowserStackAuth(config);
  return `Basic ${Buffer.from(authString).toString("base64")}`;
}

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

/** Map a raw status string from the wire onto the `TfaStatus` enum. */
function toTfaStatus(raw: unknown): TfaStatus {
  switch (raw) {
    case "RESOLVED":
      return TfaStatus.RESOLVED;
    case "BLOCKED":
      return TfaStatus.BLOCKED;
    default:
      return TfaStatus.NEEDS_INFO;
  }
}

/** Map one wire ask (snake_case) to the client `TfaAsk` (camelCase). */
function toAsk(raw: any): TfaAsk {
  return {
    what: raw?.what ?? "",
    why: raw?.why ?? "",
    evidenceType: raw?.evidence_type ?? "other",
    priority: raw?.priority ?? "medium",
  };
}

/**
 * Read the LLM-enforced structured turn from the completed `rcaChat` poll body.
 *
 * The poll envelope's own `status` field is the lifecycle state
 * (`working`/`completed`/`failed`); the agent's `TurnResponse` is passed
 * through under `turn` so its `status` (NEEDS_INFO/RESOLVED/BLOCKED) never
 * collides with the lifecycle one. The agent's model validator guarantees the
 * sub-object matching the turn status is present; we still default-fill the
 * lists so the skill never sees `undefined`.
 */
function readStructuredTurn(data: any): TurnResponse {
  const turn = data.turn ?? {};
  const status = toTfaStatus(turn.status);
  const needsInfo = turn.needs_info ?? {};
  const blocked = turn.blocked ?? {};

  return {
    status,
    confidence: turn.confidence ?? "unknown",
    questions: Array.isArray(needsInfo.questions) ? needsInfo.questions : [],
    asks: Array.isArray(needsInfo.asks) ? needsInfo.asks.map(toAsk) : [],
    suggestions: Array.isArray(needsInfo.suggestions)
      ? needsInfo.suggestions
      : [],
    hypotheses: Array.isArray(needsInfo.hypotheses) ? needsInfo.hypotheses : [],
    rca: status === TfaStatus.RESOLVED ? (turn.rca ?? undefined) : undefined,
    reason: status === TfaStatus.BLOCKED ? blocked.reason : undefined,
    unmetAsks:
      status === TfaStatus.BLOCKED && Array.isArray(blocked.unmet_asks)
        ? blocked.unmet_asks
        : undefined,
  };
}

/** Truncate to `max` chars total (ellipsis included when cut). */
function truncate(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * Trim a completed turn to the status-discriminated contract:
 * - NEEDS_INFO: questions/asks/suggestions/hypotheses VERBATIM (the client
 *   loop consumes them).
 * - RESOLVED: glimpse only (root_cause truncated, failure_type, related_prs)
 *   + a `viewRca` pointer — the full RCA lives on the TRA dashboard.
 * - BLOCKED: reason + unmetAsks.
 */
function toTrimmedResult(
  turn: TurnResponse,
  threadId: string | undefined,
): TfaRcaTurnResult {
  switch (turn.status) {
    case TfaStatus.RESOLVED: {
      const rca = turn.rca ?? {};
      return {
        status: turn.status,
        confidence: turn.confidence,
        threadId,
        glimpse: {
          root_cause: truncate(rca.root_cause, RCA_GLIMPSE_ROOT_CAUSE_MAX),
          failure_type: rca.failure_type,
          related_prs: rca.related_prs,
        },
        viewRca: getRcaViewGuidance(),
      };
    }
    case TfaStatus.BLOCKED:
      return {
        status: turn.status,
        confidence: turn.confidence,
        threadId,
        reason: turn.reason,
        unmetAsks: turn.unmetAsks,
      };
    default:
      return {
        status: turn.status,
        confidence: turn.confidence,
        threadId,
        questions: turn.questions,
        asks: turn.asks,
        suggestions: turn.suggestions,
        hypotheses: turn.hypotheses,
      };
  }
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
  const pollUrl =
    baseUrl +
    RCA_CHAT_POLL_PATH.replace("{testRunId}", args.testRunId).replace(
      "{turnId}",
      turnId,
    );

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
