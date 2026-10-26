/**
 * Splits an askBrowserStackAI result into what the user should see and what only the
 * client needs.
 *
 * The client has to keep `conversation_id`, `run_id`, `perm_id` and `next_step` to carry
 * on the task, but they mean nothing to the user. They go in a second content block
 * marked for the assistant only (MCP `annotations.audience`), with a note not to repeat
 * them. The first block holds the answer, the actions and anything the user is asked.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { AskResult } from "./types.js";

/** Handles the client keeps; never shown in the user-facing block. */
const INTERNAL_ID =
  /\b(?:wf:)?(?:run|wfq|wf|perm)-[0-9a-f]{32}(?::[A-Za-z0-9_]+)?\b|\batt_[0-9a-f]{32}\b/g;

const INTERNAL_NOTE =
  "For the assistant only: keep these to continue this task (pass them back as " +
  "next_step says). Never show conversation_id, run_id, perm_id or other ids to the user.";

type Json = Record<string, unknown>;

function scrub<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(INTERNAL_ID, "")
      .replace(/\s{2,}/g, " ")
      .trim() as T;
  }
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Json).map(([k, v]) => [k, scrub(v)]),
    ) as T;
  }
  return value;
}

function pick(obj: unknown, keys: string[]): Json | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const out: Json = {};
  for (const k of keys) {
    if ((obj as Json)[k] !== undefined) out[k] = (obj as Json)[k];
  }
  return Object.keys(out).length ? out : undefined;
}

/** The part of a result the user is meant to see: no handles. */
export function userView(payload: AskResult): Json {
  const p = payload as AskResult & Json;
  const view: Json = {
    ok: p.ok,
    status: p.status,
    answer: p.answer,
    ...(p.error !== undefined ? { error: p.error } : {}),
    ...(p.approvals?.length ? { approvals: p.approvals } : {}),
    ...(Array.isArray(p.needs_approval) && p.needs_approval.length
      ? { needs_approval: p.needs_approval }
      : {}),
    // null is meaningful: nobody measured whether earlier changes landed.
    applied_before_stop: p.applied_before_stop ?? null,
    ...(p.attachments?.length ? { attachments: p.attachments } : {}),
  };
  const run = pick(p.run, ["title", "stage", "steps", "status"]);
  if (run) view.run = run;
  if (Array.isArray(p.actions)) {
    view.actions = p.actions.map((a) => pick(a, ["label", "reply"]));
  }
  if (Array.isArray(p.questions)) {
    view.questions = p.questions.map((q) =>
      pick(q, ["title", "description", "questions"]),
    );
  }
  if (Array.isArray(p.jobs)) {
    view.jobs = p.jobs.map((j) => pick(j, ["label", "status"]));
  }
  if (p.uploads?.length) {
    view.uploads = p.uploads.map((u) => ({ name: u.name }));
  }
  return scrub(view);
}

/** What only the client needs to carry on: handles, the next call, and the raw reply. */
export function internalView(payload: AskResult): Json | undefined {
  const p = payload as AskResult & Json;
  const internal: Json = {};
  for (const k of [
    "conversation_id",
    "run_id",
    "perm_id",
    "next_step",
    "uploads",
    "permission_relay",
    "approvals_source",
    "atlas_response",
  ]) {
    if (p[k] !== undefined && p[k] !== null) internal[k] = p[k];
  }
  const runId = (p.run as Json | undefined)?.run_id;
  if (runId) internal.run = { run_id: runId };
  if (Array.isArray(p.questions)) {
    internal.questions = p.questions.map((q) => pick(q, ["ask_id"]));
  }
  if (Array.isArray(p.actions)) {
    internal.actions = p.actions.map((a) => pick(a, ["reply", "card_id"]));
  }
  if (Array.isArray(p.jobs)) internal.jobs = p.jobs;
  return Object.keys(internal).length ? internal : undefined;
}

/** The tool result: the user-facing block first, the client-only block second. */
export function toAudienceResult(payload: AskResult): CallToolResult {
  const failed =
    payload.status === "error" || payload.status === "rate_limited";
  const internal = internalView(payload);
  return {
    content: [
      { type: "text", text: JSON.stringify(userView(payload)) },
      ...(internal
        ? [
            {
              type: "text" as const,
              text: `${INTERNAL_NOTE}\n${JSON.stringify(internal)}`,
              annotations: { audience: ["assistant" as const] },
            },
          ]
        : []),
    ],
    ...(failed ? { isError: true } : {}),
  };
}
