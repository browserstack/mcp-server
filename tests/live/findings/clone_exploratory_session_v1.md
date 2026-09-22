# clone_exploratory_session_v1 — DRIFT

- **Product / entity:** tm / `exploratory_session` (write, v1)
- **Environment:** preprod
- **Probed:** 2026-09-21, project PR-2005 (379335744)
- **Run file:** `tests/live/runs/tm/clone_exploratory_session_v1.json`
- **Source:** session **779** (ES-14, `__mcp-probe-exploratory-20260921`), re-read immediately before cloning — `session_log_count` was **2** at that point (it had been 0 at creation; a concurrent probe had since added 2 logs), `charter` was already **null**.
- **Created object:** exploratory session id **780** (ES-15), title `__mcp-probe-exploratory-clone-20260921`. Source session 779 was left untouched and not closed.

## Summary

The clone invoked cleanly on the first attempt with a **flat** body (no `exploratory_session` wrapper), confirming the capability's own guidance for the wrapper shape. Only the **synchronous** path was exercised — source had 2 logs, far below the documented 50-log threshold — so the asynchronous branch (≥50 logs, 202, no session object) remains **unverified** in this run. The real finding is narrower than "does it work": the clone's own success response **under-reports the logs it just copied**.

## The drift: clone's inline response says 0 logs; a follow-up read says 2

The 201 response body (`success:true, async:false, unique_id:null`) included the full `exploratory_session` object, but `session_log_count` was **0** and `timeline` was **`[]`** — as if no logs had been copied. The sync-path guidance explicitly promises "the copy fully built" for sources under 50 logs.

A same-second follow-up told a different story:

- `list_exploratory_session_logs` on the new session (780) returned **both** of session 779's logs, content and status intact (`bug`/120s, `note`/45s).
- A fresh `get_exploratory_session` on 780 showed `session_log_count: 2` and a populated `timeline` matching the source.

So the logs genuinely were copied synchronously and correctly — the clone endpoint's **own success response** is simply stale about `session_log_count`/`timeline` at the instant it replies. A caller trusting the clone response body literally, without an immediate follow-up read, would wrongly conclude the sync clone dropped all logs.

## Confirmed family defect: `folder_id` declared, never returned

`folder_id` is a property of the declared 201 `exploratory_session` schema. It is absent from the actual clone response and from a direct `get_exploratory_session` re-read of the new session — matching the same "declared but absent entirely" pattern already confirmed elsewhere in this entity family.

## Charter / tags / issues / owner non-copy claims: untestable on this source

The guidance states charter and folder are never copied, and that `copy_tags`/`copy_issues`/`copy_session_owner` all default false so the clone arrives untagged, issue-free and unassigned. All true-sounding here — but session 779's own `charter` was already `null`, and its `tags`/`issues`/`assignee`/`owner` were already empty/null, **before** cloning. (`charter` was reportedly silently dropped on session 779's own `create_exploratory_session_v1` call too — sent non-empty at creation, returned `null` on both the create response and every subsequent read, this probe's re-read included.) So a null/empty clone proves nothing beyond "null in, null out." This probe does **not** confirm the non-copy claims; it just fails to contradict them. A source with a genuinely non-empty charter, tags, issues and an assignee would be needed to actually test the claims.

Similarly, `session_state` on the clone came back `"active"`, matching the source — but the source was never closed (per instruction), so the guidance's claim "the clone is always created in the active state, even when the source session is closed" is also unverified by this run.

## Minor: `project_id` type inconsistency between write and read responses

The clone's own 201 response returned `exploratory_session.project_id` as a **string** (`"379335744"`). An immediate `get_exploratory_session` read of the same session id returned it as an **integer** (`379335744`). `project_id` isn't declared on this capability's contract either way (undeclared-returned), so this isn't a contract violation, but it is a real type inconsistency for the same field on the same object between the write path and the read path.

## No error-envelope or entitlement-gate defect observed here

The call succeeded on the first attempt, so the family's confirmed bare-`{success:false}` error-envelope defect and the 200-for-refusal entitlement pattern were not exercised by this probe.

## What remains unverified

- **Async path (≥50 logs):** not exercised — session 779 had only 2 logs. The declared 202 shape (`success, async:true, unique_id`, no session object) differs structurally from the 201 shape actually observed, so a caller cannot tell from the contract alone which shape they'll get without first checking `session_log_count` on the source (the guidance does say to do this).
- **Charter/tags/issues/owner non-copy behavior on a source that actually has them.**
- **Session-state-always-active claim when cloning a closed source.**

## Index actions proposed

1. Flag the clone endpoint's own success response for correctness: `session_log_count`/`timeline` on the sync path should reflect the logs that were actually copied by response time, not report zero when logs demonstrably exist a moment later.
2. Add `folder_id` to the "known absent from responses" list already tracked for this entity family, or remove it from the declared schema.
3. If a source session with a non-empty charter/tags/issues/owner becomes available, re-run this probe against it to actually test the non-copy claims rather than inferring from an empty source.
