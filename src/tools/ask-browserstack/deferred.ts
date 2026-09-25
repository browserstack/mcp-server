/**
 * The two-call shape: ask now, decide later, with nothing held open in between.
 *
 * WHY IT EXISTS. Elicitation is what makes this process stateful — a suspended
 * `elicitation/create` pins an McpServer in one pod's heap until the answer arrives, so
 * the hosted deployment needs sessions, ingress affinity keyed on the caller's
 * credentials, and a cap on how many sessions may be alive. Deferred removes the
 * suspension rather than routing around it: Atlas returns at its first ask, we hand that
 * ask back, and the caller returns with the decision in a SECOND call. Between the two
 * this process holds nothing, so any pod can serve either.
 *
 * WHAT IT COSTS, stated plainly because it is not free:
 *   - Approval rides the CLIENT's own permission prompt on the second call, not an
 *     elicitation. A client configured not to prompt (`--permission-mode auto`) approves
 *     with no human. Elicitation fails closed by construction; this fails closed only if
 *     the client asks. That is the trade, and it is why stdio keeps elicitation.
 *   - One extra round trip per APPROVAL, not per task. Atlas's gate is serial, so a task
 *     with five writes is five approvals and six calls.
 *
 * The run itself is parked on Atlas's side for the gate's own 300s, kept alive exactly as
 * a dropped reader leaves it (CONTRACT v2 §4.2). Nothing here has to manage that.
 */

import logger from "../../logger.js";

import {
  DeferredTransport,
  decisionUrl,
  parseAsk,
} from "./stream.js";
import { buildResult } from "./relay.js";
import {
  AgentRequest,
  ApprovalRecord,
  AskResult,
  PermissionAsk,
  RelayMode,
} from "./types.js";

/** What a parked run needs the caller to send back. */
export interface ParkedAsk {
  perm_id: string;
  description: string;
  product: string;
  mode: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Atlas's `needs_approval` payload → our result, or `null` when it is not one.
 *
 * Null rather than a throw: a deferred request whose run never needed approval comes
 * back as an ORDINARY result, and that is a success to pass straight through — not an
 * unexpected shape. A read-only task must cost one call, not two.
 */
export function parkedResult(
  body: unknown,
  product: string,
): { runId: string; ask: ParkedAsk } | null {
  const payload = asRecord(body);
  if (payload.status !== "needs_approval") return null;
  const runId = String(payload.run_id || "");
  const asks = Array.isArray(payload.asks) ? payload.asks : [];
  // Validated, not cast, for the same reason the streaming path validates: an ask with
  // no usable `perm_id` cannot be answered, so handing it to a caller would invite a
  // second call that can only 404.
  const ask: PermissionAsk | null = asks.length ? parseAsk(asks[0]) : null;
  if (!runId || !ask) {
    logger.error(
      "askBrowserStackAI: deferred run parked without an answerable ask; treating as a plain result",
    );
    return null;
  }
  return {
    runId,
    ask: {
      perm_id: ask.perm_id,
      description: ask.description,
      product: ask.product || product,
      mode: ask.mode,
    },
  };
}

/** CONTRACT §5's shape, for a run that is parked rather than finished. */
export function needsApprovalResult(
  runId: string,
  ask: ParkedAsk,
  product: string,
): AskResult {
  return {
    // NOT ok, and not an error either: nothing was applied and nothing failed. A caller
    // that branches on `ok` alone must not read a parked run as a finished one.
    ok: false,
    status: "needs_approval",
    // Addressed to the MODEL, and imperative, because the model is what reads it and
    // the one thing that must happen next is not something it can do by itself.
    answer:
      `A HUMAN MUST APPROVE THIS BEFORE IT CAN CONTINUE. BrowserStack AI stopped at: ` +
      `${ask.description}. Nothing has been changed yet.\n\n` +
      `Put this to the user and WAIT for their answer. If you have a way to ask them a ` +
      `structured question or show a confirmation — any prompt, question or approval ` +
      `affordance your client offers — use that; otherwise ask plainly in your reply. ` +
      `Quote what is being done either way.\n\n` +
      `Do NOT decide on their behalf, and do not treat "it is what they asked for" as ` +
      `approval: they are being asked to confirm this specific change, which is a ` +
      `different question. Once they have answered, follow \`next_step\`.`,
    approvals: [],
    approvals_source: "atlas",
    elicitations: [],
    needs_approval: [{ description: ask.description, mode: ask.mode }],
    applied_before_stop: false,
    permission_relay: {
      used: true,
      reason: "",
      // Terse on purpose: the actionable half lives in `next_step`, and an explanation
      // of the transport here is what the model read instead of the instruction.
      detail: "Approval is pending a human answer; see `next_step`.",
    },
    atlas_response: null,
    run_id: runId,
    perm_id: ask.perm_id,
    next_step: {
      instruction:
        // Deliberately names no tool and no client. The affordance differs everywhere
        // — a structured question, a confirmation dialog, an approval prompt, or
        // nothing at all — and naming one would be wrong on every other client and
        // would rot as clients change. Describe the ACT, let the model pick the means.
        "AFTER the user has answered — not before — call askBrowserStackAI again " +
        "with exactly these params, setting `decision` to what THEY said. If they " +
        'declined, send "deny": that is a valid answer and stops the task cleanly. ' +
        "If they have not answered yet, do not call anything.",
      call: "askBrowserStackAI",
      params: {
        product,
        run_id: runId,
        perm_id: ask.perm_id,
        decision: "allow | deny — the user's answer, not your own judgement",
      },
    },
  };
}

/** The FIRST call: run until the first ask, then answer. Nothing is held open. */
export async function runDeferred(
  url: string,
  headers: Record<string, string>,
  body: AgentRequest,
  transport: DeferredTransport,
  mode: RelayMode,
  product: string,
): Promise<AskResult> {
  const response = await transport(url, headers, {
    ...body,
    permission_relay: { mode: "deferred" },
  });
  const parked = parkedResult(response.body, product);
  if (parked) {
    logger.info(
      "askBrowserStackAI: run parked awaiting approval (run=%s)",
      parked.runId,
    );
    return needsApprovalResult(parked.runId, parked.ask, product);
  }
  // No ask: an ordinary result, passed through the same builder the streaming path
  // uses so an entitlement refusal, a 401 and a plain failure all read identically
  // whichever transport produced them.
  return buildResult(response, [], mode, product);
}

/**
 * The SECOND call: deliver the decision, then pick the run back up.
 *
 * Two requests, in this order, and the order is the safety property: the decision is
 * posted FIRST so that a reattach which then fails cannot leave the gate waiting on an
 * answer we already have. A lost reattach costs the caller the answer; a lost decision
 * would cost them the run.
 */
export async function runResumed(
  agentUrl: string,
  headers: Record<string, string>,
  runId: string,
  permId: string,
  decision: "allow" | "deny",
  transport: DeferredTransport,
  mode: RelayMode,
  product: string,
): Promise<AskResult> {
  // ONE CALL. This used to POST the decision, check for a 204, and then reattach to
  // `GET /agent/{run_id}/stream` to collect what the run did next — two requests, and a
  // reattach that only existed because the run was a paused coroutine in one pod. The
  // ask parks in Atlas's checkpoint now, so the decision request IS the one that carries
  // the run forward and the continuation comes back in its own reply, from any replica.
  const response = await transport(decisionUrl(agentUrl, runId), headers, {
    perm_id: permId,
    decision,
    reason: "",
    // Required. The run resumes on a fresh Agent that must be scoped before it can be
    // built, and Atlas deliberately will not take that scope from persisted state.
    product,
  });

  if (response.status === 404) {
    // The only failure worth its own words: there is no such parked run. It expired, it
    // was already answered, or this is not the caller that owns it. None of those is an
    // approval, and none of them changed anything.
    return resumeFailed(
      `That approval could not be applied (HTTP 404). The run may have expired — ` +
        `BrowserStack AI stops waiting after five minutes — or it may already have ` +
        `been answered. Nothing was changed by this call. Start the task again if it ` +
        `still needs doing.`,
    );
  }

  // PARKED AGAIN: the task needs more than one approval. Handed straight back rather
  // than answered here, because the whole point is that a human decides each one.
  const parked = parkedResult(response.body, product);
  if (parked) {
    logger.info(
      "askBrowserStackAI: run parked again after a decision (run=%s)",
      runId,
    );
    return needsApprovalResult(parked.runId, parked.ask, product);
  }
  // Finished. Through the SAME builder the start path uses, so an entitlement refusal,
  // a 401 and a plain failure read identically whichever call produced them.
  return buildResult(response, [], mode, product);
}

/** A resume that did not happen. Every field says "nothing changed", because in each
 *  case nothing did — and a caller that cannot tell a failed resume from a refusal
 *  either retries a write that landed or abandons one that never did. */
export function resumeFailed(error: string): AskResult {
  return {
    ok: false,
    status: "error",
    answer: null,
    approvals: [],
    approvals_source: "mcp",
    elicitations: [],
    needs_approval: [],
    applied_before_stop: false,
    permission_relay: { used: true, reason: "", detail: "" },
    atlas_response: null,
    error,
  };
}

export function incompleteResume(): AskResult {
  return resumeFailed(
    "Resuming needs all three of `run_id`, `perm_id` and `decision`. Nothing was " +
      "sent, so nothing changed and the pending approval is still waiting — ask the " +
      "user whether to allow it and call again with all three.",
  );
}
