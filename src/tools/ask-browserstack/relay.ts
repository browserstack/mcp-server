/**
 * The decision mapping and the result assembly — the two places where being wrong is
 * expensive, kept pure so they can be tested without a server, a socket or a client.
 */

import { ElicitResult } from "@modelcontextprotocol/sdk/types.js";

import { AgentResponse } from "./egress.js";
import {
  ApprovalRecord,
  AskResult,
  AskStatus,
  ASK_STATUSES,
  Decision,
  DecisionReason,
} from "./types.js";

export const RELAY_ON_DETAIL =
  "This client can prompt you, so BrowserStack asked before each change and the answers " +
  "are in `approvals`.";

export const RELAY_OFF_DETAIL =
  "This client does not support MCP elicitation, so there was no way to ask you mid-run. " +
  "BrowserStack ran read-only: anything that would have changed data was refused and is " +
  "listed in `needs_approval`. Re-run the same request from a client that supports " +
  "elicitation to be asked for confirmation instead.";

/**
 * CONTRACT §7, exactly.
 *
 * | accept + confirm: true  | allow | ""        |
 * | accept + confirm: false | deny  | declined  |
 * | decline                 | deny  | declined  |
 * | cancel                  | deny  | cancelled |
 *
 * `cancel` IS THE LOAD-BEARING ROW. A headless Claude Code with no human at a terminal
 * returns `cancel` — measured, not assumed — so treating it as anything but a deny would
 * let an unattended run self-approve, which is the one property that makes this feature
 * safe to ship. It is also why the caller never retries an elicitation: a second ask cannot
 * conjure a human, it can only wear one down.
 *
 * `confirm` is compared to the boolean `true` and nothing else. A string "true", a 1, or a
 * missing field is not consent.
 */
export function decide(result: ElicitResult): {
  decision: Decision;
  reason: DecisionReason;
} {
  if (result.action === "accept") {
    return result.content?.confirm === true
      ? { decision: "allow", reason: "" }
      : { decision: "deny", reason: "declined" };
  }
  if (result.action === "decline") return { decision: "deny", reason: "declined" };
  // `cancel`, and anything a future client sends that we do not recognise: no explicit
  // answer was given, which is not an answer we may read as yes.
  return { decision: "deny", reason: "cancelled" };
}

/**
 * CONTRACT §5 — "true if ANY allow preceded a deny".
 *
 * This is the field that separates "nothing happened" from "some steps applied, then
 * stopped". A caller that cannot tell those apart will retry a half-applied task, so the
 * literal rule is implemented literally: a run where everything was allowed did not stop,
 * and is therefore false.
 */
export function appliedBeforeStop(approvals: ApprovalRecord[]): boolean {
  const firstDeny = approvals.findIndex((entry) => entry.decision === "deny");
  if (firstDeny === -1) return false;
  return approvals
    .slice(0, firstDeny)
    .some((entry) => entry.decision === "allow");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Atlas's own status wins when it declares one; otherwise it is derived from what we can
 * see. Deriving is a last resort, not an interpretation of the answer.
 */
export function deriveStatus(
  response: AgentResponse,
  approvals: ApprovalRecord[],
  needsApproval: unknown[],
): AskStatus {
  if (response.status === 429) return "rate_limited";
  // Status 0 (unreachable) lands here too, which is what it is: a failed call.
  if (response.status < 200 || response.status >= 300) return "error";

  const declared = asRecord(response.body).status;
  if (
    typeof declared === "string" &&
    (ASK_STATUSES as readonly string[]).includes(declared)
  ) {
    return declared as AskStatus;
  }

  const denied = approvals.some((entry) => entry.decision === "deny");
  return denied || needsApproval.length > 0 ? "blocked" : "ok";
}

/** Assemble CONTRACT §5's result. Atlas's payload is carried, never rewritten. */
export function buildResult(
  response: AgentResponse,
  approvals: ApprovalRecord[],
  relayUsed: boolean,
): AskResult {
  const payload = asRecord(response.body);
  const needsApproval = Array.isArray(payload.needs_approval)
    ? (payload.needs_approval as unknown[])
    : [];
  const status = deriveStatus(response, approvals, needsApproval);

  return {
    ok: status === "ok",
    status,
    // The product's answer, as the product wrote it. Nothing here summarises or re-reads it.
    answer: payload.answer ?? null,
    approvals,
    needs_approval: needsApproval,
    applied_before_stop: appliedBeforeStop(approvals),
    permission_relay: relayUsed
      ? { used: true, reason: "", detail: RELAY_ON_DETAIL }
      : // CONTRACT §7's last row: no elicitation capability means the field was never sent.
        { used: false, reason: "no_human", detail: RELAY_OFF_DETAIL },
    atlas_response: response.body ?? null,
    ...(response.status === 0 && response.error ? { error: response.error } : {}),
  };
}

/**
 * A result for a call that never reached, or never got past, Atlas.
 *
 * It keeps §5's shape — including the approval trail — because a failure AFTER an approval
 * was granted is exactly the case where a caller most needs to know something may already
 * have been applied.
 */
export function errorResult(
  message: string,
  approvals: ApprovalRecord[],
  relayUsed: boolean,
): AskResult {
  return {
    ok: false,
    status: "error",
    answer: null,
    approvals,
    needs_approval: [],
    applied_before_stop: appliedBeforeStop(approvals),
    permission_relay: relayUsed
      ? { used: true, reason: "", detail: RELAY_ON_DETAIL }
      : { used: false, reason: "no_human", detail: RELAY_OFF_DETAIL },
    atlas_response: null,
    error: message,
  };
}
