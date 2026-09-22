# get_exploratory_session — DRIFT

- **Product / entity:** tm / `exploratory_session` (read)
- **Environment:** preprod
- **Probed:** 2026-09-21, project PR-2005 (379335744), sessions 779 (ES-14) and 780 (ES-15, a clone of 779)
- **Run file:** `tests/live/runs/tm/get_exploratory_session.json`
- **Status:** re-probe. Superseded an UNVERIFIED verdict from earlier the same day — at that time project 379335744 had zero exploratory sessions in any state, so the 200 path was structurally unreachable. Write probes since created 779 and its clone 780, both `active` with 2 logs each, giving this capability its first-ever populated object to read.

## Two hypotheses were handed in from an incidental observation during a write probe. Both check out.

### 1. `timeline` is declared as lifecycle events; it is actually the log collection, log-shaped

Declared 200 schema: `timeline[]` is "Ordered list of lifecycle events for this session," each item `{created_by, action, timestamp}` — e.g. `{action: "created", timestamp: "2026-01-16T10:30:00Z", created_by: {...}}`.

Actual, on **both** 779 and 780:

```json
"timeline": [
  {"status": "bug", "elapsed_time": 120, "created_by": {...}},
  {"status": "note", "elapsed_time": 45, "created_by": {...}}
]
```

`action` and `timestamp` are not null or empty — the keys do not exist on either row, on either session. `status` and `elapsed_time` (undeclared) appear instead. This reproduces identically on 780, an independently-cloned copy of the same two logs, so it isn't a one-off artifact of session 779 specifically — it's the shape `timeline` actually has once a session has logs. The declared "lifecycle events" schema for this field looks simply wrong for this entity: what's returned under `timeline` is the session's log collection.

### 2. `actual_duration` is declared as "set on close"; it can be non-null on an active, never-closed session — but only sometimes

Declared: `actual_duration` — "Final recorded duration of the session in minutes (set on close)," nullable.

Session 779: `session_state: "active"`, `closed_at: null`, `closed_by: null` — never closed — and `actual_duration: 165`. Confirmed non-null on an active session, contradicting the declared "set on close" semantics.

But session 780 (the clone, equally active, equally never closed, carrying the *same two log rows* with `elapsed_time` 120 and 45) came back with `actual_duration: null`. So this is not "the field is always populated regardless of close state" — it's specific to 779.

165 is exactly 120 + 45 — the sum of 779's two `elapsed_time` values. The shape of the evidence suggests `actual_duration` is being derived from summed log `elapsed_time` as a side effect of logging, rather than being set only by the documented close action, and that this derived value wasn't recomputed or carried over onto the clone. **This is offered as the observed pattern, not a proven mechanism** — this probe has no visibility into server-side code, and 165 matching the log sum could in principle be coincidence. What's confirmed without qualification is the drift itself: `actual_duration` came back non-null on an active session that was never closed.

## Confirmed family defect: `folder_id` declared, never returned

`folder_id` is in this capability's declared return list. It is absent (key missing, not null) from the response on both 779 and 780. This is the same pattern already confirmed on `create_exploratory_session` and `clone_exploratory_session_v1` for this entity (see `clone_exploratory_session_v1.md`) — now also confirmed on the plain read.

## `project_id` type: this read returns integer; write paths return string

`project_id` is undeclared on this capability but present in the response as an **integer** (`379335744`) on both 779 and 780. The sibling `clone_exploratory_session_v1` finding reported `project_id` as a **string** (`"379335744"`) on its own 201 response. Together these confirm the write serializers (create, clone) are the inconsistent side — the read is consistent with itself across both sessions probed here.

## Additional declared-vs-actual gaps on the flat item shape

- **declared, absent:** `name` (only `title` is present — no `name` key at all), `summary`, `test_plan` (the expanded object; only `test_plan_id` is present, and it's `null` on both sessions since neither is linked to a plan, so the *expansion* itself remains unverified rather than confirmed-absent)
- **undeclared, returned:** `attachment_relations`, `project_id`, `group_id`, `owner` (distinct from `assignee` — both null on both sessions here), `record_status` (`"active"` on both)

## Error-envelope evidence (kept from the prior UNVERIFIED run, re-verified)

`session_id=999999999` still 404s with a bare `{"success":false}` — no `error` object — against a declared 404 schema of `{success:false, error:{code,message,details}}`. The capability's own prose guidance says this verbatim ("a session id that does not exist comes back as a bare `{success:false}`... the upstream error text is deliberately not relayed"), so this is schema-wrong/prose-right, consistent with the rest of this campaign's error-envelope findings. Logged as another instance in `error-envelopes-systemic.md`.

## What remains unverified, even now

A populated object exists for the first time, but several declared shapes are still untested because the two available sessions don't exercise them:

- `test_plan` (expanded object) — both sessions have `test_plan_id: null`
- `configurations`, `tags`, `issues`, `custom_fields`, `attachments`, `attachment_relations` — empty arrays on both sessions; item shape unknown
- `assignee`, `owner`, `closed_by` — null on both sessions; the declared user-reference object `{id,email,full_name,group_id}` is only confirmed for `created_by`, which is populated on both

These are named as UNVERIFIED, not quietly counted as passing.

## Verdict rationale

DRIFT, not PASS: the capability works and returns a well-formed 200, but `declared_missing` and `undeclared_returned` are both non-empty and `timeline`'s item shape is a different schema entirely, not a missing/extra field. Not BLOCKED (it's invokable). Not UNVERIFIED (the primary path and both handed-in hypotheses were fully exercised across two independent populated sessions).
