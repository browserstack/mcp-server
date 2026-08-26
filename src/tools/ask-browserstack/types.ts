/**
 * CONTRACT v1, expressed as types.
 *
 * Everything in this file is one half of a wire format whose other half is being written
 * against `~/.claude/orchestration/shared/CONTRACT.md` by a different session, in a
 * different repo, at the same time. A field renamed here to read better is a field the
 * other half will never send. Nothing here changes without changing that document first.
 */

export const PRODUCTS = ["tm", "a11y", "tra"] as const;
export type Product = (typeof PRODUCTS)[number];

/** CONTRACT §2 — the body Atlas POSTs to our callback when its gate needs a human. */
export interface PermissionAsk {
  /**
   * Atlas's own `perm-<32 hex>` uuid4, carried, never re-minted.
   *
   * Commit 737f6f57 replaced a per-Bridge sequential scheme with this one after ids
   * collided across pods and left a turn blocked until its 300s timeout. A second id
   * scheme on this side would reintroduce that bug on a new axis, so we echo theirs.
   */
  perm_id: string;
  product: string;
  /** "ask-always" | "ask-once" — Atlas's vocabulary, not re-interpreted here. */
  mode: string;
  /**
   * The model's `thought`: product language, route-free.
   *
   * The privacy boundary is that `op_key`, `method`, `path` and `host` stay inside Atlas's
   * private record. This field is the whole of what a human is shown.
   */
  description: string;
}

export type Decision = "allow" | "deny";

/**
 * CONTRACT §2/§7. Advisory ONLY — `decision` alone decides whether the action proceeds.
 * It exists so a result can distinguish "a human said no" from "no human was there".
 */
export type DecisionReason =
  | ""
  | "declined"
  | "cancelled"
  | "no_human"
  | "timeout"
  // v1.1 §C enumerated "error" — the relay broke before or during the ask, so no human ever
  // answered. This side never puts it ON THE WIRE: an unexpected relay failure answers HTTP
  // 500, which Atlas's fail-closed rule already reads as a deny and records as `error_relay`.
  // It appears only in `ApprovalRecord.reason`, where the caller can see what happened.
  | "error";

/** CONTRACT §2 — what we answer the still-open callback request with. */
export interface PermissionDecision {
  perm_id: string;
  decision: Decision;
  reason: DecisionReason;
}

/** CONTRACT §1 — the one new optional field on `POST /agent`. */
export interface PermissionRelay {
  callback_url: string;
  token: string;
}

/**
 * CONTRACT §1 — the `POST /agent` body.
 *
 * `permission_relay` is OMITTED ENTIRELY, not sent empty or null, when the client cannot
 * elicit: its absence is what selects Atlas's read-only `HeadlessGate`, which is today's
 * byte-identical behaviour and the opencode/goose path.
 */
export interface AgentRequest {
  task: string;
  product: string;
  /**
   * Who the run is for (CONTRACT v1.2 §3).
   *
   * The shared delegation token authenticates the caller but not the principal
   * (`principal_verified=false`), so Atlas reads the acting user from here. Omitted entirely
   * when no username is configured — never sent as `""`.
   *
   * Note the asymmetry and do not try to close it: on this path a caller can CLAIM any
   * `user_id`. That is Atlas's documented design for the shared-token route; a signed
   * principal requires the central-JWT path, which is out of scope.
   */
  user_id?: string;
  permission_relay?: PermissionRelay;
}

/** CONTRACT §5 — one entry in an approval trail, in the order the asks arrived. */
export interface ApprovalRecord {
  description: string;
  decision: Decision;
  reason: string;
  /**
   * Did this approved step's request actually land? (Atlas task 3 §1.)
   *
   * `true` only when the entry was `allow` AND its request then returned 2xx. Everything
   * else — a dead port, a 4xx, a 5xx, an async-dispatch refusal — resolves to `false`:
   * unknown fails toward not-applied, never the other way.
   *
   * ONLY ATLAS CAN KNOW THIS. The gate returns before any request is sent, which was the
   * whole of D2; the fact is written by the tool layer into the same record object the gate
   * keeps by reference, so it correlates by object identity rather than by position.
   *
   * ABSENT means not reported (an Atlas that predates this, or our own elicitation trail,
   * which has no way to know). Never render an absent value as a measured `false`.
   */
  applied?: boolean;
  /**
   * A human-readable phrase for this entry.
   *
   * Exists because `allow` + `applied: false` — approved, then the request failed — is a
   * genuinely different thing to tell a person than a refusal, and the two must not read
   * alike. Derived, never sent by anyone.
   */
  outcome?: string;
}

/**
 * Whether the approval channel was offered to Atlas at all, and if not, why not.
 *
 * Three different facts about this deployment and this client, each needing a different
 * thing from whoever reads the result — so they are three values rather than one boolean.
 */
export type RelayMode =
  /** A callback listener was bound and `permission_relay` was sent. */
  | "offered"
  /** The client declares no `elicitation` capability, so nobody could be prompted. */
  | "no_human"
  /** This process is the hosted multi-tenant server, which cannot receive the callback. */
  | "remote_mode";

export const ASK_STATUSES = ["ok", "blocked", "error", "rate_limited"] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

/** CONTRACT §5 — the single tool result. */
export interface AskResult {
  ok: boolean;
  status: AskStatus;
  answer: unknown;
  /**
   * THE AUTHORITATIVE approval trail: Atlas's whenever it supplied one, ours otherwise.
   *
   * Atlas's wins because it is the only side that can populate `applied`, and because it
   * records what happened to the STEP — a callback answered without a prompt appearing (a
   * 401'd probe, a shape rejection) is a denial there and nothing at all here.
   */
  approvals: ApprovalRecord[];
  /** Which side produced `approvals`, so a reader never has to infer it. */
  approvals_source: "atlas" | "mcp";
  /**
   * OUR trail: one entry per prompt this server actually put in front of a human.
   *
   * Kept beside `approvals` rather than folded into it, because where the two disagree the
   * disagreement is the signal. An entry Atlas records as a denial with nothing here means a
   * callback was answered without any prompt appearing — which is what an attacker probing
   * the loopback port looks like.
   */
  elicitations: ApprovalRecord[];
  needs_approval: unknown[];
  /**
   * Atlas's own verdict: this run stopped on a refusal AND something had already changed.
   *
   * READ, NEVER DERIVED. Atlas computes it because only Atlas knows `applied`, and it sends
   * the field whenever a relay gate ran — including `false`, including with an empty trail.
   *
   * `null` means NOT REPORTED, which is not the same as `false`: either no gate ran (so
   * Atlas has nothing to say about applications) or this Atlas predates the field. Treating
   * it as `false` would assert something nobody measured.
   */
  applied_before_stop: boolean | null;
  /**
   * Why a write may have been refused.
   *
   * `reason` is ATLAS'S OWN when it reported one (CONTRACT v1.1 §D: `"" | disabled |
   * host_not_allowed | malformed`), and ours — `no_human` (§7's last row) — when the client
   * could not be prompted at all, which Atlas never learns about because we omit the block.
   * Typed as a plain string rather than a union because an Atlas newer than this build may
   * name a reason this one has never heard of, and an unrecognised reason must degrade to a
   * sentence, not throw.
   */
  permission_relay: {
    used: boolean;
    reason: string;
    detail: string;
  };
  /**
   * Atlas's public payload, verbatim.
   *
   * The mapped fields above are the contract; this is the belt to their braces. The two
   * halves are being built in parallel, so a field named slightly differently on the other
   * side would otherwise silently become `null` here rather than reaching the caller.
   */
  atlas_response: unknown;
  /**
   * Why the call failed, when it did.
   *
   * Ours when egress never completed; otherwise Atlas's own `error` string, which its
   * `public()` includes ONLY when non-empty (v1.1 §B). Lifted out of `atlas_response` so a
   * caller reading the top level is told why rather than having to go looking.
   */
  error?: string;
}
