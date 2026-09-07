// Collaboration status emitted by the TFA agent for one RCA turn.
export enum TfaStatus {
  NEEDS_INFO = "NEEDS_INFO",
  RESOLVED = "RESOLVED",
  BLOCKED = "BLOCKED",
}

// Soft, tool-emitted status when an in-call poll exceeds its wall-clock cap.
export const PENDING_STATUS = "PENDING" as const;

export type Confidence = "low" | "medium" | "high" | "unknown";

export type EvidenceType =
  | "test_logs"
  | "product_code"
  | "k8s"
  | "kibana"
  | "metrics"
  | "deploy"
  | "ci"
  | "other";

/** A typed request for evidence; the skill routes it by `evidenceType`. */
export interface TfaAsk {
  what: string;
  why: string;
  evidenceType: EvidenceType;
  priority: "high" | "medium" | "low";
}

// The agreed root-cause analysis carried on a RESOLVED turn.
export interface TfaRca {
  root_cause?: string;
  description?: string;
  possible_fix?: string;
  failure_type?: string;
  alternatives_considered?: string[];
  related_prs?: unknown[];
  [key: string]: unknown;
}

// Structured turn the o11y `rcaChat` poll returns once status === "completed".
export interface TurnResponse {
  status: TfaStatus;
  confidence: Confidence;
  questions: string[];
  asks: TfaAsk[];
  suggestions: string[];
  hypotheses: string[];
  rca?: TfaRca;
  /** Present on BLOCKED turns: why TFA cannot proceed. */
  reason?: string;
  /** Present on BLOCKED turns: the asks that went unmet. */
  unmetAsks?: string[];
}

// Trimmed glimpse of a RESOLVED turn's RCA — the full report lives on the dashboard.
export interface TfaRcaGlimpse {
  /** Truncated to `RCA_GLIMPSE_ROOT_CAUSE_MAX` chars. */
  root_cause?: string;
  failure_type?: string;
  related_prs?: unknown[];
}

// Trimmed, status-discriminated result returned by the turn util / tool.
export interface TfaRcaTurnResult {
  status: TfaStatus | typeof PENDING_STATUS;
  confidence?: Confidence;
  threadId?: string;
  /** Present on PENDING turns: resume via the tool's `turnId` arg. */
  turnId?: string;
  questions?: string[];
  asks?: TfaAsk[];
  suggestions?: string[];
  hypotheses?: string[];
  /** Present on RESOLVED turns: trimmed root-cause glimpse. */
  glimpse?: TfaRcaGlimpse;
  rca?: unknown;
  /** Present on RESOLVED turns: where the full RCA report lives. */
  viewRca?: string;
  reason?: string;
  unmetAsks?: string[];
}
