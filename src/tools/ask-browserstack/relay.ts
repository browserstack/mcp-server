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

/**
 * One sentence per way the relay can fail to run, because they call for different things
 * from the person reading them, and a caller who cannot tell them apart retries forever.
 *
 * `no_human` is ours (CONTRACT §7's last row); the rest are Atlas's (v1.1 §D).
 */
export const RELAY_OFF_DETAILS: Record<string, string> = {
  no_human:
    "This client does not support MCP elicitation, so there was no way to ask you mid-run. " +
    "BrowserStack ran read-only: anything that would have changed data was refused and is " +
    "listed in `needs_approval`. Re-run the same request from a client that supports " +
    "elicitation to be asked for confirmation instead.",

  // The one that matters most to a human. NOBODY REFUSED ANYTHING HERE — the server has the
  // knob off, so saying "your change was declined" would be a lie and retrying cannot help.
  disabled:
    "NOBODY DECLINED THIS. BrowserStack's permission relay is switched off on the server " +
    "(`delegation.permission_relay`), so it ignored the approval channel this client " +
    "offered and ran read-only. Everything in `needs_approval` was refused for that " +
    "configuration reason alone. Retrying will keep failing the same way until an " +
    "administrator turns the relay on.",

  host_not_allowed:
    "BrowserStack refused to call this client back: the loopback address it was given is " +
    "not on the server's allowed-callback list, which is the guard that stops a " +
    "caller-supplied URL turning the server into a request proxy. The run went read-only. " +
    "This normally means BrowserStack is not running on the same host as this MCP server.",

  malformed:
    "BrowserStack could not use the approval channel this client offered and ran read-only. " +
    "That is a bug on this side, not something you did; everything in `needs_approval` was " +
    "refused because of it.",

  // The request never got as far as the agent. Distinct from `disabled` (the agent ran, with
  // the relay switched off) and from a decline (someone was asked and said no), because the
  // three call for completely different things from whoever reads them.
  not_reached:
    "NOTHING WAS ASKED AND NOTHING WAS REFUSED. BrowserStack rejected this request before " +
    "the agent started, so no step ran, no prompt appeared, and nothing was changed. " +
    "`error` says why. This is not a decision anyone made about your request — fix what " +
    "`error` names and run it again.",
};

/** Kept for anything still importing the old single constant. */
export const RELAY_OFF_DETAIL = RELAY_OFF_DETAILS.no_human;

/** A reason from a newer Atlas than this build. Say so plainly rather than crash. */
function unknownRelayDetail(used: boolean, reason: string): string {
  // Bounded: this string came off the wire and goes into a result a human reads.
  const quoted = JSON.stringify(reason.slice(0, 64));
  return used
    ? `BrowserStack used the approval channel and reported ${quoted}, which this version ` +
        "does not recognise. The answers it did collect are in `approvals`."
    : `BrowserStack did not use the approval channel this client offered, reporting ` +
        `${quoted}, which this version does not recognise. The run was read-only, so ` +
        "anything in `needs_approval` was refused without anyone being asked.";
}

/** The sentence that goes with a `{used, reason}` pair, whoever produced it. */
export function relayDetail(used: boolean, reason: string): string {
  if (used) return reason ? unknownRelayDetail(true, reason) : RELAY_ON_DETAIL;
  return RELAY_OFF_DETAILS[reason] ?? unknownRelayDetail(false, reason);
}

/**
 * Did this request die before the agent ever started?
 *
 * Atlas omits its `permission_relay` verdict on refusals that never reach the delegation
 * layer — 401 unauthorized, 400 bad body, 503 delegation-not-enabled all answer with a bare
 * `{"detail": …}` — and a transport failure has no body at all. Read naively, "no verdict"
 * looks identical to "an Atlas older than v1.1", and the optimistic fallback for THAT case
 * then claims the channel was used and answers were collected when zero prompts appeared.
 *
 * Which is the same confusion the `disabled` sentence exists to prevent, one layer earlier:
 * a caller who cannot tell "nobody was asked" from "somebody said no" retries forever.
 */
export function neverReachedAgent(response: AgentResponse): boolean {
  // No response at all, or one that is not a success.
  if (response.status === 0) return true;
  if (response.status < 200 || response.status >= 300) return true;
  // A success carrying a bare `detail` is not a delegation result either.
  const payload = asRecord(response.body);
  const looksLikeAResult =
    "ok" in payload || "status" in payload || "answer" in payload;
  return "detail" in payload && !looksLikeAResult;
}

/**
 * Atlas's own verdict on the relay (v1.1 §D), when it gave one.
 *
 * Present ONLY when we supplied a `permission_relay` block, so its absence is either "we
 * never offered one" or "this Atlas predates v1.1" — neither of which is an error. A block
 * we cannot read is treated as no block at all rather than half-trusted.
 */
export function atlasRelayVerdict(
  payload: Record<string, unknown>,
): { used: boolean; reason: string } | null {
  const raw = payload.permission_relay;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.used !== "boolean") return null;
  return {
    used: record.used,
    reason: typeof record.reason === "string" ? record.reason : "",
  };
}

/**
 * Product-language framing for the prompt (v1.1 §G, approved).
 *
 * `product` is the ONLY thing added — it is all §2 carries, and the route, method and path
 * never reach this side by design. The description itself is passed through untouched:
 * paraphrasing or truncating it would mean the human approves something other than what the
 * model actually said, and Atlas has already route-checked it (v1.1 §A), so a description
 * that quoted an internal path arrives as a withheld-placeholder sentence which reads
 * perfectly well after this prefix.
 */
export const PRODUCT_LABELS: Record<string, string> = {
  tm: "Test Management",
  a11y: "Accessibility",
  tra: "Test Reporting & Analytics",
};

export function elicitationMessage(product: string, description: string): string {
  const label = PRODUCT_LABELS[product] || product.trim();
  const who = label
    ? `BrowserStack AI (${label})`
    : // An unnamed product beats an empty pair of brackets.
      "BrowserStack AI";
  return `${who} needs your approval to continue:\n\n${description}`;
}

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

/**
 * Reconcile our view of the relay with Atlas's.
 *
 * ATLAS WINS WHEN IT SPOKE. It is the side that decided whether `RelayGate` actually ran, so
 * its `used`/`reason` beat anything inferred here — that is the whole point of v1.1 §D, and
 * `disabled` in particular is a fact only Atlas knows. The `detail` sentence stays ours.
 *
 * When we never offered a block, ours wins unconditionally: `no_human` describes a client
 * that cannot be prompted, which Atlas is never told about and could not report.
 */
function relayVerdict(
  payload: Record<string, unknown>,
  relayUsed: boolean,
  reachedAgent: boolean,
): AskResult["permission_relay"] {
  // FIRST, because it outranks both of the cases below. If the request never reached the
  // agent then no channel was exercised whether or not one was offered, and saying the run
  // went read-only (`no_human`) would be just as wrong as saying it was used: nothing ran at
  // all. The client's inability to be prompted is not the actionable fact here and will
  // surface on the next run, once whatever `error` names is fixed.
  if (!reachedAgent) {
    return {
      used: false,
      reason: "not_reached",
      detail: RELAY_OFF_DETAILS.not_reached,
    };
  }
  if (!relayUsed) {
    // CONTRACT §7's last row: no elicitation capability means the field was never sent.
    return { used: false, reason: "no_human", detail: RELAY_OFF_DETAILS.no_human };
  }
  const verdict = atlasRelayVerdict(payload);
  if (verdict) {
    return { ...verdict, detail: relayDetail(verdict.used, verdict.reason) };
  }
  // No verdict: an Atlas older than v1.1. We offered the channel and have no reason to
  // believe it was refused, so the optimistic read is the honest one — and it is advisory
  // either way, never deciding whether an action proceeded.
  return { used: true, reason: "", detail: RELAY_ON_DETAIL };
}

/** Assemble CONTRACT §5's result. Atlas's payload is carried, never rewritten. */
export function buildResult(
  response: AgentResponse,
  approvals: ApprovalRecord[],
  relayUsed: boolean,
): AskResult {
  const payload = asRecord(response.body);
  // ABSENT WHEN EMPTY, never `[]` (v1.1 §B): Atlas's `public()` omits the key entirely, as
  // it does for `narration`, `artifacts`, `error`, `cost_breach` and `usage`. Missing is
  // read as empty, not as a malformed response.
  const needsApproval = Array.isArray(payload.needs_approval)
    ? (payload.needs_approval as unknown[])
    : [];
  const status = deriveStatus(response, approvals, needsApproval);
  const reachedAgent = !neverReachedAgent(response);

  return {
    ok: status === "ok",
    status,
    // The product's answer, as the product wrote it. Nothing here summarises or re-reads it.
    answer: payload.answer ?? null,
    approvals,
    needs_approval: needsApproval,
    applied_before_stop: appliedBeforeStop(approvals),
    permission_relay: relayVerdict(payload, relayUsed, reachedAgent),
    atlas_response: response.body ?? null,
    ...atlasError(response, payload),
  };
}

/**
 * A rejected credential and a refused action are unrelated problems, and a result that lets
 * them read alike sends someone hunting for a human who said no when the real answer is that
 * this server never got through the door.
 *
 * Atlas answers a bad `Authorization` with `401 {"detail": "unauthorized"}` — no `error`
 * string of its own — so without this the caller would see a bare "error" and nothing else.
 * A denial, by contrast, is `status: "blocked"` with a populated `approvals` trail.
 *
 * The token itself is NOT named here, only the variable that should hold it.
 */
export const UNAUTHENTICATED_DETAIL =
  "BrowserStack AI rejected this server's credentials (HTTP 401). NOBODY DECLINED " +
  "ANYTHING — the request never reached the agent, so no permission was sought and nothing " +
  "was refused. The shared delegation token in ASK_BROWSERSTACK_ATLAS_TOKEN is missing, " +
  "wrong, or not the one this environment expects.";

/**
 * The `error` field, from whichever side has one.
 *
 * Ours when there was no response to speak for itself or the credentials were rejected;
 * otherwise Atlas's own `error` string, which `public()` includes ONLY when non-empty
 * (v1.1 §B) — and failing that, its bare `detail`.
 *
 * That last rung matters: Atlas's pre-run refusals (400 bad body, 503 delegation not
 * enabled) carry `detail` and no `error`, so without it a caller got `status: "error"` and
 * nothing whatsoever to act on.
 */
function atlasError(
  response: AgentResponse,
  payload: Record<string, unknown>,
): { error?: string } {
  if (response.status === 0 && response.error) return { error: response.error };
  if (response.status === 401) return { error: UNAUTHENTICATED_DETAIL };

  const reported = payload.error;
  if (typeof reported === "string" && reported) return { error: reported };

  const detail = payload.detail;
  if (typeof detail === "string" && detail) {
    // Bounded: this came off the wire and ends up in front of a person.
    return {
      error:
        `BrowserStack AI refused this request before the agent started ` +
        `(HTTP ${response.status}): ${JSON.stringify(detail.slice(0, 200))}.`,
    };
  }
  // A non-2xx with nothing to say for itself still beats a silent one.
  if (response.status < 200 || response.status >= 300) {
    return {
      error:
        `BrowserStack AI refused this request before the agent started ` +
        `(HTTP ${response.status}).`,
    };
  }
  return {};
}

/**
 * A result for a call that never reached, or never got past, Atlas.
 *
 * It keeps §5's shape — including the approval trail — because a failure AFTER an approval
 * was granted is exactly the case where a caller most needs to know something may already
 * have been applied.
 */
export function errorResult(message: string, approvals: ApprovalRecord[]): AskResult {
  return {
    ok: false,
    status: "error",
    answer: null,
    approvals,
    needs_approval: [],
    applied_before_stop: appliedBeforeStop(approvals),
    // The request never left this process, so it certainly never reached the agent.
    permission_relay: {
      used: false,
      reason: "not_reached",
      detail: RELAY_OFF_DETAILS.not_reached,
    },
    atlas_response: null,
    error: message,
  };
}
