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
  RelayMode,
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

  // Neither the human nor the client is the constraint here — the DEPLOYMENT is, and no
  // change either of them can make will help.
  remote_mode:
    "NOBODY DECLINED THIS, AND YOUR CLIENT IS NOT THE PROBLEM. This BrowserStack MCP server " +
    "is running in its hosted, multi-tenant mode, which has no way to receive the approval " +
    "callback, so it ran read-only and everything in `needs_approval` was refused for that " +
    "reason alone. Mid-run approval works when the server runs locally over stdio; retrying " +
    "against this deployment will keep failing the same way.",

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
export function looksLikeDelegationResult(body: unknown): boolean {
  const payload = asRecord(body);
  return (
    "ok" in payload ||
    "status" in payload ||
    "answer" in payload ||
    "approvals" in payload
  );
}

export function neverReachedAgent(response: AgentResponse): boolean {
  // No response at all: nothing could have run.
  if (response.status === 0) return true;
  // THE BODY DECIDES, NOT THE STATUS.
  //
  // This rung first read "any non-2xx", and that was wrong in the one direction that
  // matters. Atlas answers HTTP 502 with a COMPLETE result body when a delegation ran and a
  // step then failed (`delegation/http.py:317-320`), and 429 carries a full body too. So an
  // approved write whose egress failed came back saying nobody had been asked, while
  // `approvals` in the same payload showed the prompt shown and approved — the exact lie
  // this predicate was added to prevent, now told on the one run where it costs the most.
  //
  // The HTTP code describes the OUTCOME; the body describes whether there was a RUN. Only
  // the second question is being asked here.
  return !looksLikeDelegationResult(response.body);
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
 * CONTRACT §7. THE ACTION IS THE WHOLE ANSWER.
 *
 * | accept  | allow | ""        |
 * | decline | deny  | declined  |
 * | cancel  | deny  | cancelled |
 *
 * Nothing is requested in the form any more, so nothing can contradict the action. There used
 * to be a `confirm` boolean, and it had to go: with an `accept` action that ALREADY means the
 * human approved, `accept` + `confirm: false` is genuinely ambiguous between "I approved, and
 * a checkbox I never saw defaulted to false" and "I unticked it deliberately". The first is a
 * FALSE DENIAL — indistinguishable in the result from a human refusing, which is the exact
 * confusion D3 and N1 existed to remove — and a user hit it live. We cannot tell the two
 * apart, and guessing either way is wrong for the other. `decline` already gives an
 * unambiguous refusal in the same dialog, so the boolean bought nothing.
 *
 * FAIL-CLOSED IS UNCHANGED, and the boolean was never what provided it. A headless client with
 * no human at a terminal returns `cancel` — measured, not assumed (HANDOFF.md) — and `cancel`
 * is a deny. That is why an unattended run still cannot self-approve. It is also why an
 * elicitation is never retried: a second ask cannot conjure a human, only wear one down.
 */
export function decide(result: ElicitResult): {
  decision: Decision;
  reason: DecisionReason;
} {
  if (result.action === "accept") {
    // DEFENSIVE ONLY. We no longer request this field, so no client can be expected to send
    // it — but one that volunteers an explicit `false` has said something, and honouring it
    // costs nothing. Absence, which is the normal case, is consent.
    if (result.content?.confirm === false) {
      return { decision: "deny", reason: "declined" };
    }
    return { decision: "allow", reason: "" };
  }
  if (result.action === "decline") return { decision: "deny", reason: "declined" };
  // `cancel`, and anything a future client sends that we do not recognise: no explicit
  // answer was given, which is not an answer we may read as yes.
  return { decision: "deny", reason: "cancelled" };
}

/**
 * A one-line description of the SHAPE of what a client answered with — never its content.
 *
 * Which client sends what is currently guesswork: the elicitation bug in task 9 had to be
 * fixed without being able to confirm what Claude Code actually submits, because its binary
 * is compiled and its strings too fragmented to read. This line means the next person can
 * look it up instead of inferring it.
 *
 * `action` and `confirm` are a fixed enum and a boolean; neither can carry a description, a
 * credential or anything else a user typed.
 */
export function elicitationShape(result: ElicitResult): string {
  const content = result.content;
  const confirm = content?.confirm;
  const seen =
    confirm === undefined
      ? "absent"
      : typeof confirm === "boolean"
        ? String(confirm)
        : "non-boolean";
  return `action=${result.action} content=${content ? "present" : "absent"} confirm=${seen}`;
}

/**
 * Read Atlas's `applied_before_stop`. NEVER DERIVE IT.
 *
 * This side used to compute it as CONTRACT §5's literal "any allow preceded a deny", which
 * could only ever be a guess: an approval whose request then failed counted as applied, so
 * the field lied in the exact direction it exists to prevent (D2). Atlas now computes it
 * from `applied`, which only Atlas can know, and sends it whenever a gate ran — including
 * `false`, including with an empty trail.
 *
 * So a MISSING field is never "false". It is "nobody measured this": either no gate ran, or
 * this Atlas predates the field. `null` says that out loud instead of asserting a fact.
 */
export function readAppliedBeforeStop(
  payload: Record<string, unknown>,
): boolean | null {
  const reported = payload.applied_before_stop;
  return typeof reported === "boolean" ? reported : null;
}

/**
 * Atlas's approval trail, when it sent one.
 *
 * Returns `null` — not `[]` — when the key is absent, because an empty trail Atlas DID send
 * ("the relay ran and nothing was asked") is a different fact from no trail at all, and only
 * the second is a reason to fall back to ours.
 *
 * Every entry is rebuilt rather than trusted: a `decision` that is not exactly `"allow"`
 * becomes `"deny"`, so a garbled trail fails closed in the reporting the same way the wire
 * does, and `applied` is carried only when it is genuinely a boolean.
 */
export function parseAtlasApprovals(
  payload: Record<string, unknown>,
): ApprovalRecord[] | null {
  const raw = payload.approvals;
  if (!Array.isArray(raw)) return null;
  const trail: ApprovalRecord[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    trail.push({
      description: typeof entry.description === "string" ? entry.description : "",
      decision: entry.decision === "allow" ? "allow" : "deny",
      reason: typeof entry.reason === "string" ? entry.reason : "",
      ...(typeof entry.applied === "boolean" ? { applied: entry.applied } : {}),
    });
  }
  return trail;
}

/**
 * One phrase per entry, because "approved, then it failed" and "refused" must not read
 * alike — conflating them is the whole reason D2 mattered.
 *
 * An `allow` with no `applied` key is NOT rendered as a failure: nobody measured it, and
 * saying otherwise would invent the very fact this is meant to report.
 */
export function approvalOutcome(entry: ApprovalRecord): string {
  if (entry.decision === "allow") {
    if (entry.applied === true) return "approved, and the change went through";
    if (entry.applied === false) {
      return (
        "APPROVED, BUT THE CHANGE DID NOT GO THROUGH — nobody refused it; the request " +
        "failed after it was approved"
      );
    }
    return "approved; whether the change went through was not reported";
  }
  switch (entry.reason) {
    case "declined":
      return "refused: a human said no";
    case "cancelled":
      return "refused: nobody was there to be asked";
    case "timeout":
      return "refused: nobody answered in time";
    case "error":
      return "refused: the approval channel broke before any answer arrived";
    default:
      return "refused";
  }
}

function withOutcomes(trail: ApprovalRecord[]): ApprovalRecord[] {
  return trail.map((entry) => ({ ...entry, outcome: approvalOutcome(entry) }));
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
  if (looksLikeDelegationResult(response.body)) {
    // A run happened, so its own status is the answer — on a 502 and a 429 as much as on a
    // 200. Reading the HTTP code first would overwrite what the run said about itself.
    const declared = asRecord(response.body).status;
    if (
      typeof declared === "string" &&
      (ASK_STATUSES as readonly string[]).includes(declared)
    ) {
      return declared as AskStatus;
    }
    if (response.status === 429) return "rate_limited";
    if (response.status < 200 || response.status >= 300) return "error";
    const denied = approvals.some((entry) => entry.decision === "deny");
    return denied || needsApproval.length > 0 ? "blocked" : "ok";
  }

  // No run to speak of. A 2xx lands here too when the body is not a result — which is what
  // made that case report `ok: true` alongside an `error` (N4).
  if (response.status === 429) return "rate_limited";
  return "error";
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
  mode: RelayMode,
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
  // BEFORE `no_human`, deliberately, when both are true. In the hosted deployment even a
  // client that CAN be prompted is of no use, so the deployment is the binding constraint and
  // the one the reader can act on; telling them to switch clients would waste their time.
  if (mode === "remote_mode") {
    return { used: false, reason: "remote_mode", detail: RELAY_OFF_DETAILS.remote_mode };
  }
  if (mode === "no_human") {
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
  mode: RelayMode,
): AskResult {
  const payload = asRecord(response.body);
  // ABSENT WHEN EMPTY, never `[]` (v1.1 §B): Atlas's `public()` omits the key entirely, as
  // it does for `narration`, `artifacts`, `error`, `cost_breach` and `usage`. Missing is
  // read as empty, not as a malformed response.
  const needsApproval = Array.isArray(payload.needs_approval)
    ? (payload.needs_approval as unknown[])
    : [];
  // ATLAS'S TRAIL WINS WHEN IT SENT ONE. It is the only side that can fill in `applied`, and
  // it records what happened to the STEP: a callback answered without a prompt appearing is
  // a denial there and nothing at all here. Ours is kept separately rather than discarded,
  // because that difference is exactly how a probe of the loopback port shows up.
  const atlasTrail = parseAtlasApprovals(payload);
  const trail = atlasTrail ?? approvals;
  const status = deriveStatus(response, trail, needsApproval);
  const reachedAgent = !neverReachedAgent(response);

  return {
    ok: status === "ok",
    status,
    // The product's answer, as the product wrote it. Nothing here summarises or re-reads it.
    answer: payload.answer ?? null,
    approvals: withOutcomes(trail),
    approvals_source: atlasTrail ? "atlas" : "mcp",
    elicitations: withOutcomes(approvals),
    needs_approval: needsApproval,
    applied_before_stop: readAppliedBeforeStop(payload),
    permission_relay: relayVerdict(payload, mode, reachedAgent),
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
  "Signing in with your BrowserStack credentials SUCCEEDED, but BrowserStack AI refused " +
  "the resulting token (HTTP 401). YOUR CREDENTIALS ARE NOT THE PROBLEM — this is a " +
  "server-side configuration one, most likely `delegation.required_scope` not matching the " +
  "scope the token was minted with. NOBODY DECLINED ANYTHING: the request never reached " +
  "the agent, so no permission was sought and nothing was refused.";

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

  // Atlas's own error string wherever it sent one — on a 502 that carries a full result,
  // this is the run explaining its own failure, and nothing here should talk over it.
  const reported = payload.error;
  if (typeof reported === "string" && reported) return { error: reported };

  if (response.status === 401) return { error: UNAUTHENTICATED_DETAIL };

  if (!neverReachedAgent(response)) {
    // The delegation ran. `status`, `approvals` and `needs_approval` already say what
    // happened; "refused before the agent started" would simply be false.
    return {};
  }

  // Bounded: this came off the wire and ends up in front of a person.
  const detail = payload.detail;
  const quoted =
    typeof detail === "string" && detail
      ? `: ${JSON.stringify(detail.slice(0, 200))}`
      : "";

  if (response.status < 200 || response.status >= 300) {
    return {
      error:
        `BrowserStack AI refused this request before the agent started ` +
        `(HTTP ${response.status})${quoted}.`,
    };
  }
  // A 2xx carrying something that is not a delegation result at all. Real Atlas does not
  // emit this; saying so plainly beats reporting a success with an error attached (N4).
  return {
    error:
      `BrowserStack AI answered HTTP ${response.status} with no delegation ` +
      `result${quoted}.`,
  };
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
    // Atlas never answered, so there is no authoritative trail to prefer. Ours is all there
    // is, and `applied_before_stop` is null because nobody measured anything.
    approvals: withOutcomes(approvals),
    approvals_source: "mcp",
    elicitations: withOutcomes(approvals),
    needs_approval: [],
    applied_before_stop: null,
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
