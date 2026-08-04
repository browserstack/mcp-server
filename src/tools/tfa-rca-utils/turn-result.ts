import { apiClient } from "../../lib/apiClient.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  getO11yBaseUrl,
  getRcaViewGuidance,
  RCA_CHAT_POLL_PATH,
  RCA_GLIMPSE_ROOT_CAUSE_MAX,
} from "./constants.js";
import {
  PENDING_STATUS,
  TfaAsk,
  TfaRcaTurnResult,
  TfaStatus,
  TurnResponse,
} from "./types.js";

/**
 * Domain error carrying a client-safe message. The tool maps these to a
 * `{ isError: true }` envelope; the message never contains credentials.
 */
export class TfaRcaTurnError extends Error {}

export interface GetTfaTurnResultArgs {
  testRunId: string;
  turnId: string;
}

export function buildAuthHeader(config: BrowserStackConfig): string {
  const authString = getBrowserStackAuth(config);
  return `Basic ${Buffer.from(authString).toString("base64")}`;
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
export function readStructuredTurn(data: any): TurnResponse {
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
export function toTrimmedResult(
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
        rca: rca, // TODO: To remove later, adding for testing by passing additional context
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

/** Build the poll (GET) URL for one already-submitted turn. */
export function buildPollUrl(testRunId: string, turnId: string): string {
  return (
    getO11yBaseUrl() +
    RCA_CHAT_POLL_PATH.replace("{testRunId}", testRunId).replace(
      "{turnId}",
      turnId,
    )
  );
}

/**
 * Read an already-submitted turn ONCE (no polling loop, no submit) and return
 * the same trimmed, status-discriminated contract as `tfaRcaTurn`. A turn still
 * in flight yields the soft `PENDING` status carrying `turnId`/`threadId` so the
 * caller decides when to read again. Stateless: all identifiers are
 * function-scoped; nothing persists between calls.
 */
export async function getTfaTurnResult(
  args: GetTfaTurnResultArgs,
  config: BrowserStackConfig,
): Promise<TfaRcaTurnResult> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: buildAuthHeader(config),
  };

  const response = await apiClient.get({
    url: buildPollUrl(args.testRunId, args.turnId),
    headers,
    raise_error: false,
  });

  if (response.status === 404) {
    throw new TfaRcaTurnError("turn expired or not found");
  }

  if (!response.ok) {
    throw new TfaRcaTurnError(
      `failed to read RCA turn (status ${response.status})`,
    );
  }

  const data = response.data ?? {};
  const threadId: string | undefined = data.threadId;

  if (data.status === "failed") {
    throw new TfaRcaTurnError(data.error || "TFA agent run failed");
  }

  if (data.status === "completed") {
    return toTrimmedResult(readStructuredTurn(data), threadId);
  }

  // "working" (or any other in-progress value) → soft PENDING, read again later.
  return {
    status: PENDING_STATUS,
    threadId,
    turnId: args.turnId,
  };
}
