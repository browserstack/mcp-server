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
  AgentStreamTransport,
  DecisionTransport,
  DeferredTransport,
  EVENT_PERMISSION,
  EVENT_RESULT,
  EVENT_RUN,
  decisionUrl,
  parseAsk,
  resumeUrl,
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
export function needsApprovalResult(runId: string, ask: ParkedAsk): AskResult {
  return {
    // NOT ok, and not an error either: nothing was applied and nothing failed. A caller
    // that branches on `ok` alone must not read a parked run as a finished one.
    ok: false,
    status: "needs_approval",
    answer:
      `BrowserStack needs approval before it can continue: ${ask.description}. ` +
      `Ask the user whether to allow it, then call askBrowserStackAI again with ` +
      `run_id "${runId}" and their decision. Nothing has been changed yet, and ` +
      `nothing will be unless you come back.`,
    approvals: [],
    approvals_source: "atlas",
    elicitations: [],
    needs_approval: [{ description: ask.description, mode: ask.mode }],
    applied_before_stop: false,
    permission_relay: {
      used: true,
      reason: "",
      detail:
        "This deployment cannot hold a prompt open mid-run, so it returned the " +
        "pending approval instead. Answer it with a second call carrying `run_id` " +
        "and `decision`.",
    },
    atlas_response: null,
    run_id: runId,
    perm_id: ask.perm_id,
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
    return needsApprovalResult(parked.runId, parked.ask);
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
  decisionTransport: DecisionTransport,
  streamTransport: AgentStreamTransport,
  mode: RelayMode,
  product: string,
): Promise<AskResult> {
  const status = await decisionTransport(
    decisionUrl(agentUrl, runId),
    headers,
    { perm_id: permId, decision, reason: "" },
  );
  if (status !== 204) {
    // 404 (run expired or never existed), 409 (already answered), 0 (never delivered).
    // All three mean the same thing to the caller — this decision did not land — and
    // none of them is an approval, so saying so plainly beats guessing which.
    return {
      ok: false,
      status: "error",
      answer: null,
      approvals: [],
      approvals_source: "mcp",
      elicitations: [],
      needs_approval: [],
      applied_before_stop: false,
      permission_relay: {
        used: true,
        reason: "",
        detail:
          "The approval channel was used; this call could not deliver the answer.",
      },
      atlas_response: null,
      error:
        `The decision could not be delivered (HTTP ${status}). The run may have ` +
        `expired — BrowserStack stops waiting after five minutes — or it may already ` +
        `have been answered. Nothing was changed by this call. Start the task again ` +
        `if it still needs doing.`,
    };
  }

  const approvals: ApprovalRecord[] = [];
  let result: unknown;
  let resultStatus = 200;
  let nextAsk: ParkedAsk | null = null;

  // `null` body ⇒ GET: the reattach carries none.
  for await (const event of streamTransport(
    resumeUrl(agentUrl, runId),
    headers,
    null,
  )) {
    if (event.event === EVENT_RUN) continue;
    if (event.event === EVENT_RESULT) {
      result = event.data;
      if (typeof event.status === "number") resultStatus = event.status;
      continue;
    }
    if (event.event !== EVENT_PERMISSION) continue;
    // ANOTHER ask: the task needs more than one approval. Park again rather than
    // answering it ourselves — the whole point is that a human decides each one.
    const ask = parseAsk(event.data);
    if (ask) {
      nextAsk = {
        perm_id: ask.perm_id,
        description: ask.description,
        product: ask.product || product,
        mode: ask.mode,
      };
      break;
    }
  }

  if (nextAsk) {
    logger.info(
      "askBrowserStackAI: run parked again after a decision (run=%s)",
      runId,
    );
    return needsApprovalResult(runId, nextAsk);
  }
  return buildResult(
    { status: resultStatus, body: result },
    approvals,
    mode,
    product,
  );
}

/**
 * A resume missing half its arguments.
 *
 * Not an error the caller can fix by retrying the same way, so it says what is missing
 * rather than failing generically — and it is fail-closed by construction: with no
 * `decision` there is nothing to deliver, so the gate keeps waiting and eventually
 * denies on its own expiry. Nothing is approved by omission.
 */
export function incompleteResume(): AskResult {
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
    error:
      "Resuming needs all three of `run_id`, `perm_id` and `decision`. Nothing was " +
      "sent, so nothing changed and the pending approval is still waiting — ask the " +
      "user whether to allow it and call again with all three.",
  };
}
