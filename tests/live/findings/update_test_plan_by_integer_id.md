# update_test_plan_by_integer_id — DRIFT

- **Product / entity:** tm / `test_plan` (write)
- **Path:** `PUT/PATCH /api/v1/projects/{project_id}/test-plans/{test_plan_id}` (integer ids)
- **Environment:** **preprod** (v1 API; v2 was still hanging at probe time, v1 was healthy)
- **Probed:** 2026-09-22
- **Run file:** `tests/live/runs/tm/update_test_plan_by_integer_id.json`
- **Related:** `findings/update_test_plan.md` (same wrapper defect, same entity, v2), `create_test_plan_by_integer_id` (BLOCKED — see notes below)

## Summary

**The update itself is clean and safe.** A flat rename landed in storage, was independently re-read to confirm, did not disturb the plan's linked run, and correctly bumped `updated_at`. The only defect is, again, the wrapper guidance — and settling it here matters because it rules out a much worse possibility.

## Drift — the wrapper claim is backwards, and worse than v2's version

Guidance, verbatim:

> "Everything goes inside a `test_plan` object. A flat body is rejected before any field is read."

This is stated more forcefully than `update_test_plan`'s version ("wrap... a flat body is accepted too") — it says flat is *rejected*, not just non-preferred. Live behavior is the opposite:

- **Nested** (`{"test_plan": {"name": "..."}}`) → rejected **client-side**, no HTTP request made:
  ```
  unknown body: test_plan. accepted: attachments, custom_fields, description, end_date,
  issues, name, owner, parent_plan_id, plan_status, reviewers, start_date, tags, test_runs.
  test_plan is a wrapper this surface builds for you from each field's json_path — send
  the fields directly instead of nesting them
  ```
- **Flat** (`{"name": "..."}`) → `200`, persisted, verified by re-read.

Same defect family as `update_test_plan` and the `create_test_plan_by_integer_id` wrapper trap — the **eighth**-ish instance of this suite's wrapper mismatch, on this same entity for the third time (create, update-v1, update-v2).

## Why this one specifically needed settling: does the create_test_plan_by_integer_id bug generalize?

`create_test_plan_by_integer_id` is **BLOCKED**: guidance also demands the `test_plan` wrapper, `invokeCapability` also rejects nested client-side, but the flat body it falls back to then returns a reproducible, undeclared `500 {status:500, error:"Internal Server Error"}` — with preprod demonstrably healthy, ruling out the earlier outage as an excuse.

The open question was whether `update_test_plan_by_integer_id`'s flat body would **also** 500, which would mean this entity's whole v1 write surface (not just create) is broken. **It does not.** The flat body on `update_test_plan_by_integer_id` returns a clean `200` with the correctly-updated plan. So:

- The wrapper-guidance defect generalizes (three capabilities on this entity now share it).
- The **500** does **not** generalize — it is isolated to `create_test_plan_by_integer_id`. This entity's write surface is in better shape than the create-side defect alone might suggest; update is healthy.

## What is correct

- **The update works and persists.** `name` changed and was independently confirmed via a follow-up `get_test_plan_by_integer_id` read, not trusted from the response echo.
- **PUT-vs-PATCH settled: partial-update semantics.** A body containing only `name` left tags, owner, assignee, dates, custom_fields, attachments, issues, `sub_plans_count` and `test_runs_count` all untouched. (One minor exception: `description` moved from `""` to bare `null` despite never being sent — a representation quirk, not data loss, and worth a small caveat on "omitted fields are preserved.")
- **Run linkage was not disturbed.** `list_test_plan_test_runs_by_integer_id` showed the same single run, `TR-9111`, linked before and after — the rename did not silently unlink it, and `test_runs` was never included in the body (guidance: omitting it "leaves the linkage alone," confirmed).
- **`updated_at` genuinely moves.** Pre-update it was byte-identical to `created_at` (untouched since the clone); post-update it advanced to the real write time — unlike `update_filter`'s already-documented inert `entity`/`updated_at` under a 200.
- **The stopped prior attempt left no trace.** Verified by reading before touching anything: name and `updated_at` on the target plan were unchanged from the clone baseline, and the protected fixture plan `TP-1616` (id 48283) was still byte-identical to the state `clone_test_plan` last verified.

## Reader disagreement, re-confirmed after a real write

`list_test_plan_test_runs_by_integer_id(48319)` confirms `TR-9111` linked. `list_test_runs_by_integer_id(project_id=379335744, include_test_plan='true')`, re-read in the same pass, still shows `test_plans: []` for that same run. This is the same systemic defect `clone_test_plan`'s probe already found on `TR-9061` and on freshly-minted `TR-9111` — now reproduced a second time, across two probes on two different days, after an unrelated write on the plan. Staleness/caching is ruled out as an explanation; this is a genuinely broken reader (`list_test_runs_by_integer_id` + `include_test_plan`), not a broken write path.

## Contract completeness

- **Declared but missing:** `test_plan.reviewers` — listed in `returns`, absent entirely (not null, just not a key) from the live body. Expected here (no reviewers were ever configured, and a reviewers-only edit was out of scope for "update only the name"), but it is the shallowest missing path so it's recorded.
- **Undeclared but returned:** `test_plan.test_plan_progress`, `test_plan.test_results_trend`, `test_plan.test_results_trend_v2` — same three fields already flagged as undeclared on the sibling read capability `get_test_plan_by_integer_id`, inherited here because this capability's success body is "the plan, re-read" using the same shape.

## Index actions proposed

1. **Fix the wrapper guidance** — say flat, not nested; the current wording ("a flat body is rejected") is the exact opposite of live behavior. Part of the suite-wide wrapper audit already tracked against `create_test_plan_by_integer_id` / `update_test_plan`.
2. **Add `test_plan_progress` / `test_results_trend` / `test_results_trend_v2` to `returns`**, or cross-reference the `get_test_plan_by_integer_id` fix so both capabilities are corrected together (same root shape).
3. **No action needed on the 500** — confirmed isolated to `create_test_plan_by_integer_id`; do not conflate the two capabilities when scoping a fix.

## Fixture state

`TP-1632` (id 48319, `TP-1632`) is a disposable, probe-owned scratch plan minted by `clone_test_plan` specifically to give later write probes something to target — left renamed (`__mcp-probe-planclone-20260921-updated`) rather than restored, since it is not a shared fixture. `TP-1616` (id 48283) was read twice for verification and never written to.
