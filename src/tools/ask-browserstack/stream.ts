/**
 * CONTRACT v2 (A1) — read the ask off the response, send the decision separately.
 *
 * WHY THIS REPLACES THE CALLBACK. `callback.ts` binds `127.0.0.1:<ephemeral>` and hands
 * Atlas the URL. That works only when Atlas is on the same loopback. For a real user it
 * cannot work at all: this server runs on their machine, and a laptop behind NAT is not
 * addressable from a pod in BrowserStack's cluster. There is no route, and no
 * configuration creates one. Every successful relay run to date used a locally-run
 * Atlas — the shape the v1 contract was written for, and not the shape a user is in.
 *
 * A1 inverts it. Both connections are outbound from here:
 *
 *   1. `POST /agent` — the response is an SSE stream carrying `run`, then any
 *      `permission` asks, then exactly one `result`.
 *   2. `POST /agent/{run_id}/permission` — a fresh short request per decision.
 *
 * So NAT, firewalls and loopback stop mattering, because nothing ever dials in.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO: decide anything. Whether a human approved,
 * how an elicitation outcome maps to allow/deny, what the result looks like — all of
 * that stays in `relay.ts`, untouched, and is shared with the callback transport. This
 * is a pipe. Keeping the judgement out of the transport is why swapping A2 for A1 does
 * not risk the fail-closed behaviour.
 */

import logger from "../../logger.js";
import { AskError } from "./config.js";
import type { AgentRequest, PermissionAsk } from "./types.js";

/** One SSE frame, already parsed. `data` is whatever JSON the frame carried. */
export interface StreamEvent {
  event: string;
  data: unknown;
  /**
   * The HTTP status, carried ONLY on a `result` synthesised from a non-stream reply.
   *
   * Load-bearing, and it was a bug to omit it. `relay.ts` reads the status to tell a
   * rejected credential (401) from an account without the feature (403) from an
   * ordinary failure, and those produce three different sentences for the user. A
   * result event that dropped the status made every one of them read as a generic
   * error. On a real SSE stream the status is 200 by definition, so this is absent.
   */
  status?: number;
}

/**
 * CONTRACT v2 §4 — the whole-run guard, so a runaway run cannot hold a tool call open
 * forever. Deliberately generous: it is a backstop against a hung server, not a budget
 * for a human's attention, and the thing that actually bounds one approval is Atlas's
 * 300s gate.
 */
export const WHOLE_RUN_TIMEOUT_MS = 1_800_000;

export const EVENT_RUN = "run";
export const EVENT_PERMISSION = "permission";
export const EVENT_RESULT = "result";

/** Atlas's `f"perm-{uuid.uuid4().hex}"`, and nothing else. */
export const PERM_ID_PATTERN = /^perm-[0-9a-f]{32}$/;

/**
 * Read an ask out of a `permission` frame's data, or return null.
 *
 * Came over from the transport this one replaced, and the reasons it existed did not
 * change with the transport — only the direction the ask arrives from did. It is not a
 * trust check on Atlas: it is what keeps a malformed frame from turning into a prompt
 * that cannot be honoured.
 *
 * A blank description is rejected rather than relayed: the description IS the whole of
 * what the human is shown, so an empty one is a prompt asking a person to approve
 * nothing. A `perm_id` off Atlas's shape is rejected because it is the only thing that
 * routes the answer back — the decision endpoint matches on it, so an id we could not
 * have received is an answer that can never be delivered.
 *
 * Only the four fields of CONTRACT §2 are carried forward. `op_key`, `method`, `path`
 * and `host` are Atlas-private (v1.1 §A) and it does not send them; if a future one
 * ever did, they would stop here rather than reach an elicitation prompt or a result.
 */
export function parseAsk(data: unknown): PermissionAsk | null {
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return null;
  const record = data as Record<string, unknown>;
  const permId = record.perm_id;
  const description = record.description;
  if (typeof permId !== "string" || !PERM_ID_PATTERN.test(permId)) return null;
  if (typeof description !== "string" || !description.trim()) return null;
  return {
    perm_id: permId,
    product: typeof record.product === "string" ? record.product : "",
    mode: typeof record.mode === "string" ? record.mode : "",
    description,
  };
}

/**
 * The transport seam: the shape `AgentTransport` had before A2 was removed, except that it
 * yields many events instead of returning one body. Injectable for the same reason that one
 * was: the tests must be able to drive a whole approval round trip without a socket.
 */
export type AgentStreamTransport = (
  url: string,
  headers: Record<string, string>,
  body: AgentRequest,
) => AsyncIterable<StreamEvent>;

/** Posts one decision. Separate seam because it is a separate connection. */
export type DecisionTransport = (
  url: string,
  headers: Record<string, string>,
  body: { perm_id: string; decision: string; reason: string },
) => Promise<number>;

/**
 * Split a buffer into complete SSE frames, returning the leftover.
 *
 * Exported for its own tests because chunk boundaries are where SSE parsers break: a
 * frame can arrive split across two reads, two frames can arrive in one read, and a
 * `data:` line can contain anything except a newline. Getting this wrong shows up as an
 * ask that is silently dropped — a write that never gets approved and never explains
 * why — so it is tested directly rather than only through the happy path.
 */
export function splitFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const frames: string[] = [];
  let rest = buffer;
  for (;;) {
    const idx = rest.indexOf("\n\n");
    if (idx === -1) break;
    frames.push(rest.slice(0, idx));
    rest = rest.slice(idx + 2);
  }
  return { frames, rest };
}

/**
 * Parse one frame. Returns null for anything that is not an event we can use —
 * including the heartbeat, which is a bare `:` comment and is SUPPOSED to be ignored
 * here: its only job is to be a read on the socket so the ingress does not time the
 * connection out while a human is thinking.
 */
export function parseFrame(frame: string): StreamEvent | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // comment / heartbeat
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!event) return null;
  if (dataLines.length === 0) return { event, data: null };
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    // A frame we cannot read is not a frame we may guess at. Dropping it is safe
    // because the only consequence is that an ask goes unanswered and the gate denies
    // on its own expiry — never that something is approved.
    logger.warn("askBrowserStackAI: unparseable stream frame, ignoring");
    return null;
  }
}

/**
 * A fetch-based streaming transport.
 *
 * `timeoutMs` bounds the WHOLE run, not one request — CONTRACT v2 §4 replaced the old
 * 330s outer rung because under A1 the stream lives for the run and may contain several
 * 300s approvals in series. The per-ask rung (270s elicitation inside Atlas's 300s gate)
 * is unchanged and still enforced where it belongs.
 */
export function fetchAgentStreamTransport(
  timeoutMs = WHOLE_RUN_TIMEOUT_MS,
): AgentStreamTransport {
  return function stream(url, headers, body) {
    return {
      async *[Symbol.asyncIterator]() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          let response: Response;
          try {
            response = await fetch(url, {
              method: "POST",
              headers: { ...headers, Accept: "text/event-stream" },
              body: JSON.stringify(body),
              // A redirect from an authenticated API is usually a login bounce, and
              // following it turns a clear 401 into a 200 carrying an HTML page.
              redirect: "manual",
              signal: controller.signal,
            });
          } catch {
            // The same sentence the request/response transport gives, and for the same
            // reason: the upstream detail ("connection reset", "fetch failed") names our
            // plumbing rather than anything the reader can act on, and letting it through
            // once already produced a result that read like the user had done something
            // wrong. What they need to know is that BrowserStack was not reachable.
            throw new AskError("BrowserStack AI could not be reached");
          }

          const contentType = response.headers.get("content-type") || "";

          // GRACEFUL DEGRADE, and the reason A1 is safe to ship before Atlas has it
          // everywhere: an Atlas that does not know `mode: "stream"` answers with an
          // ordinary JSON body (a read-only run, `permission_relay.reason: "disabled"`).
          // Yielding it as a single `result` means the caller needs no version
          // negotiation and no flag — it gets a correct read-only answer instead of a
          // parse failure against a body that was never SSE.
          if (contentType.includes("json")) {
            const parsed = await response.json().catch(() => null);
            yield {
              event: EVENT_RESULT,
              data: parsed,
              status: response.status,
            };
            return;
          }

          if (!response.ok || !response.body) {
            // Neither a stream nor a JSON result. Surface it as a first-class failure
            // rather than an empty iteration, which the caller could not tell apart
            // from "the run finished and said nothing".
            throw new AskError(
              `BrowserStack AI refused the stream (HTTP ${response.status}).`,
            );
          }

          const decoder = new TextDecoder();
          let buffer = "";
          for await (const chunk of response.body) {
            buffer += decoder.decode(chunk as Uint8Array, { stream: true });
            const { frames, rest } = splitFrames(buffer);
            buffer = rest;
            for (const frame of frames) {
              const parsed = parseFrame(frame);
              if (parsed) yield parsed;
            }
          }
          // A trailing frame with no terminating blank line still counts.
          const tail = parseFrame(buffer);
          if (tail) yield tail;
        } finally {
          clearTimeout(timer);
        }
      },
    };
  };
}

/** The decision POST. 30s, because it is an ordinary short request. */
export function fetchDecisionTransport(timeoutMs = 30_000): DecisionTransport {
  return async (url, headers, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "manual",
        signal: controller.signal,
      });
      return response.status;
    } catch {
      // The gate on the far side is still waiting and will deny on its own expiry, so
      // a lost decision is safe — it is never an approval. 0 says "never delivered" so
      // the caller can say that rather than implying a human refused.
      return 0;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** `POST /agent/{run_id}/permission`, built from the base URL the tool already resolved. */
export function decisionUrl(agentUrl: string, runId: string): string {
  return `${agentUrl.replace(/\/+$/, "")}/${encodeURIComponent(runId)}/permission`;
}
