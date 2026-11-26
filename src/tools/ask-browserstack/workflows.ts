/**
 * BrowserStack AI agents through askBrowserStackAI.
 *
 * When a task is handed to an agent, the result is `running` with a `conversation_id`.
 * The caller checks back by calling again with that id, on a local install exactly as on
 * the hosted server. An approval or a question comes back as `needs_approval` /
 * `needs_input`, answered with a second call. Nothing is held here between calls.
 */

import { apiClient } from "../../lib/apiClient.js";
import { AskError } from "./config.js";
import { needsApprovalResult, parkedResult } from "./deferred.js";
import { buildResult } from "./relay.js";
import { AskResult, ApprovalRecord, RelayMode } from "./types.js";

export const RUN_ASK_PREFIX = "wf-";
export const RUN_QUESTION_PREFIX = "wfq-";

export type GetTransport = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; body: unknown }>;

export function fetchGetTransport(timeoutMs = 60_000): GetTransport {
  return async (url, headers) => {
    try {
      const response = await apiClient.get<unknown>({
        url,
        headers,
        timeout: timeoutMs,
        raise_error: false,
      });
      return { status: response.status, body: response.data };
    } catch {
      throw new AskError("BrowserStack AI could not be reached");
    }
  };
}

export function conversationUrl(
  agentUrl: string,
  conversationId: string,
  product: string,
): string {
  return (
    `${agentUrl.replace(/\/+$/, "")}/${encodeURIComponent(conversationId)}` +
    `?product=${encodeURIComponent(product)}`
  );
}

export function answerUrl(agentUrl: string, conversationId: string): string {
  return `${agentUrl.replace(/\/+$/, "")}/${encodeURIComponent(conversationId)}/answer`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface RunQuestion {
  id: string;
  prompt: string;
  options?: { value: string; label: string }[];
  multi?: boolean;
}

function questionsOf(
  body: unknown,
): { askId: string; questions: RunQuestion[] } | null {
  const sheets = asRecord(body).questions;
  if (!Array.isArray(sheets) || !sheets.length) return null;
  const sheet = asRecord(sheets[0]);
  const askId = String(sheet.ask_id || "");
  const raw = Array.isArray(sheet.questions) ? sheet.questions : [];
  const questions = raw
    .map((q) => asRecord(q))
    .filter((q) => typeof q.id === "string" && q.id)
    .map((q) => ({
      id: String(q.id),
      prompt: String(q.prompt || q.id),
      multi: Boolean(q.multi),
      options: Array.isArray(q.options)
        ? q.options
            .map((o) => asRecord(o))
            .filter((o) => o.value !== undefined)
            .map((o) => ({
              value: String(o.value),
              label: String(o.label || o.value),
            }))
        : undefined,
    }));
  return askId.startsWith(RUN_QUESTION_PREFIX) && questions.length
    ? { askId, questions }
    : null;
}

/**
 * The tool result for a response on a conversation. A run's approval is put in
 * the same `needs_approval` shape as any other (answered with `run_id` = the
 * conversation, `perm_id` and `decision`).
 */
/**
 * Atlas statuses that mean nobody — user or model — can act yet. Anything else, including
 * an error or a non-2xx, ends the wait: the caller should see it rather than sit on it.
 */
const WORKING_STATUSES = new Set(["running", "queued", "pending"]);

/** Whether this reading of a run leaves the caller with nothing to do but wait. */
export function stillWorking(response: {
  status: number;
  body: unknown;
}): boolean {
  if (response.status < 200 || response.status >= 300) return false;
  const status = asRecord(response.body).status;
  return typeof status === "string" && WORKING_STATUSES.has(status);
}

/**
 * Re-read a run until it reaches a state someone can act on, or the ceiling runs out.
 *
 * Returns the LAST reading either way, so the caller shapes a result from it exactly as it
 * would have from a single read — on the ceiling that is the ordinary "still working"
 * payload carrying the conversation id, which is what the model used to get immediately.
 * So this changes when the answer arrives, never its shape, and a caller that followed
 * `next_step` before still does.
 *
 * `sleep` and `now` are injected so a test can run the whole ladder without real time.
 */
export async function settleRun(
  read: () => Promise<{ status: number; body: unknown }>,
  opts: {
    ceilingMs: number;
    intervalMs: number;
    onWait?: (elapsedMs: number) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<{ status: number; body: unknown }> {
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const started = now();
  let latest = await read();
  // `ceilingMs <= 0` disables the wait: one read, as before.
  while (
    stillWorking(latest) &&
    now() - started + opts.intervalMs <= opts.ceilingMs
  ) {
    opts.onWait?.(now() - started);
    await sleep(opts.intervalMs);
    latest = await read();
  }
  return latest;
}

export function conversationResult(
  response: { status: number; body: unknown },
  conversationId: string,
  mode: RelayMode,
  product: string,
  approvals: ApprovalRecord[] = [],
): AskResult {
  const body = asRecord(response.body);
  if (body.status === "needs_approval") {
    const parked = parkedResult(
      { ...body, run_id: body.run_id || conversationId },
      product,
    );
    if (parked) {
      return withConversation(
        needsApprovalResult(
          parked.runId,
          parked.ask,
          product,
          body.applied_before_stop === true,
          approvals,
        ),
        response.body,
        product,
      );
    }
  }
  return withConversation(
    buildResult(response, approvals, mode, product),
    response.body,
    product,
  );
}

/**
 * Conversation fields on top of the usual result, and what to do next. An older server
 * sends none of them, so this leaves its result untouched.
 */
export function withConversation(
  result: AskResult,
  body: unknown,
  product = "",
): AskResult {
  const payload = asRecord(body);
  // A pending approval's `run_id` is the conversation.
  const conversationId = String(
    payload.conversation_id ||
      (result.status === "needs_approval" ? result.run_id || "" : ""),
  );
  if (!conversationId) return result;
  const out: AskResult & Record<string, unknown> = {
    ...result,
    conversation_id: conversationId,
  };
  for (const key of ["run", "questions", "actions", "jobs"] as const) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  const call = "askBrowserStackAI";
  // `product` is required by the schema, so params without it are rejected before the
  // handler runs.
  const follow = product
    ? { product, conversation_id: conversationId }
    : { conversation_id: conversationId };
  if (result.status === "running") {
    out.next_step = {
      instruction:
        "A BrowserStack AI agent is still working on this. Call askBrowserStackAI " +
        "again with this conversation_id and no query to check on it.",
      call,
      params: follow,
    };
  } else if (result.status === "needs_input") {
    const sheet = questionsOf(payload);
    out.next_step = {
      instruction:
        "The agent needs answers to `questions`. Ask the user, then call " +
        "askBrowserStackAI with these params plus `answers` keyed by question id.",
      call,
      params: {
        product,
        run_id: conversationId,
        perm_id: sheet?.askId || "",
        answers: "{ question id: the user's answer }",
      },
    };
  } else if (result.status === "needs_approval" || result.next_step) {
    // Already says how to go on (the approval to answer, or a retry): `actions` must not
    // replace it, or the decision is never sent.
  } else if (Array.isArray(payload.actions) && payload.actions.length) {
    out.next_step = {
      instruction:
        "Offer the user these `actions`. To choose one, call askBrowserStackAI with " +
        "its `reply` as query and this conversation_id.",
      call,
      params: follow,
    };
  } else {
    out.next_step = {
      instruction:
        "To follow up on this, pass this conversation_id with your next query.",
      call,
      params: follow,
    };
  }
  return out;
}
