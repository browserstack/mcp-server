# close_test_run_v1 — DRIFT

- **Product / entity:** tm / `test_run` (write, v1)
- **Environment:** preprod
- **Probed:** 2026-09-22, project PR-2005 (379335744)
- **Run file:** `tests/live/runs/tm/close_test_run_v1.json`
- **Target:** TR-9111 (uuid 17578623) — an orphaned run left over from a `clone_test_plan_v1` side effect, since unlinked from its plan and holding 1 case. Held to last in the campaign deliberately, since closing may lock the run. TR-9110, TR-9120, TR-9075, TR-9061 and TR-9062 were left untouched as instructed.

## Summary

The close itself worked cleanly on the first attempt — no body, as documented ("anything you send is ignored"), and `run_state`/`active_state` moved to `closed`/`closed` exactly as the contract describes. The real finding is that **the write's own 200 misreports two of its own fields**, caught only because this run was read back immediately afterward instead of trusting the response — the same self-misreporting pattern this campaign has already caught on `clone_test_run` (`test_cases_count: 0` when 5 cases were already live).

## The drift: `uuid` and `closed_by` are wrong on the write's own response

The close response's `data.testrun` came back with:

- `uuid: 359844` — **wrong**. TR-9111's real uuid, confirmed both before closing (`get_test_run_by_integer_id_v1`) and immediately after (same read, again), is `17578623`. 359844 isn't a stale echo of anything this run has ever had — it's a different number entirely.
- `closed_by: null` — **wrong**. An immediate `get_test_run_by_integer_id_v1` read-back shows `closed_by` fully populated: `{id: 2522, browserstack_user_id: 6013, email: "probe-user@example.invalid", full_name: "ing", group_id: 2615, onboarded: 1}`.
- `closed_at: "2026-09-22T05:43:17.718Z"` on the write response, versus `"2026-09-22T05:43:15.505Z"` on the read-back — close, but not identical; the write response's `closed_at` looks like it's echoing `updated_at` rather than the actual close-snapshot timestamp.

A caller trusting the close response literally would believe the run has no `closed_by` and would carry the wrong `uuid` into any follow-up call keyed by it.

## Declared-but-absent and undeclared-but-returned fields

Against the full declared `testrun` schema:

- **`declared_missing`:** `type`, `self_ui_link`, `observability_url` — all three are declared properties on `data.testrun`, none are present in the actual response. `type`/`self_ui_link` match the pattern already seen on every other test-run capability probed this campaign; `observability_url` is additionally listed in the capability's own top-level `returns` summary and *is* reliably present on this same run via other reads (e.g. `get_test_run_by_integer_id_v1`), so its absence here is specific to this write's response, not a project-wide gap.
- **`undeclared_returned`:** `attachments`, `created_by`, `updated_by` — all three come back on the response but appear nowhere in the declared schema.

## The three-field serializer question, checked against this write path

This campaign has tracked `project_id` (declared string), `is_dynamic` (declared boolean) and `overall_progress` (declared 7-key object) as three fields where `get_test_runs_v1` gets all three wrong. On `close_test_run_v1`'s own write response:

- `is_dynamic`: returned as `false` — a real boolean. **Correct.**
- `overall_progress`: returned as the full `{untested, passed, retest, failed, blocked, skipped, in_progress}` object. **Correct.**
- `project_id`: returned as a bare integer `379335744`, though the schema declares it a string. **Wrong** — the same mistake `get_test_runs_v1` makes, so this isn't confined to that one read endpoint; a write path gets it wrong too.

## First closed run in the project — the previously-empty closed-run reads now have data

Before this probe, `get_test_runs_v1`'s `count` object had read `{active: 33, closed: 0}` on every single check across the whole campaign. After closing TR-9111:

- `get_test_runs_v1` re-read: `{active: 32, closed: 1}` — the active total dropped by exactly one and the closed total incremented, verified against the actual rows returned (TR-9111 no longer appears on the active listing's first page), not just the count object.
- **`get_closed_test_runs`** now returns a real row for TR-9111 (`info.count: 1`, `count: {active: 32, closed: 1}`), confirming the flat `{success, test_runs, info, count}` shape and the row shape it declares. **But** this capability's own `closed_at`/`closed_by` on that row both come back `null`, despite the run genuinely having both populated (confirmed via `get_test_run_by_integer_id_v1`). This is a second, independent capability with the same closed_at/closed_by blind spot as the write path above — worth its own follow-up against `get_closed_test_runs`'s index entry.
- **`get_closed_test_runs_info_v1`** (monthly closed-run count chart) returned real, non-zero data for the first time: `data: [["Oct",0],["Nov",0],...,["Sep",1]]`, `empty_data: false`. Matches the declared positional `[label, count]` pair shape.
- **`get_closed_test_runs_split_v1`** (closed runs per month, split by result status) also returned real data for the first time: `data: [{name: "Untested", data: [0,...,1], result_status: {id: 318615, internal_name: "untested", ...}}]`, `date_list: [...,"Sep"]`, `empty_data: false`. Matches the declared per-status-series shape. The split landed under "Untested" because the run's single case is still untested — this endpoint splits by the case's current result status, not by anything about the close event.

All three convert from UNVERIFIED (empty-collection, item shape unconfirmed) to real, shape-confirmed evidence.

## Does closing lock the run? No.

A harmless follow-up `edit_test_run` (rename only, resending the mandatory `run_state: "closed"`) returned 200 and the rename was **real**, not a no-op under a 200 — confirmed by reading the run back afterward: the new name persisted, `run_state`/`active_state` stayed `closed`, `closed_at`/`closed_by` were unchanged. `owner` was already `null` before this edit, so the known owner-clearing side effect of `edit_test_run` had nothing to clear here and is not a new finding.

## What remains unverified

- Whether `get_closed_test_runs`'s `closed_at`/`closed_by` blind spot is specific to this run/project or systemic — only one closed run exists to test against so far.
- The async/queued paths of `close_test_run_v1` were not exercised — this is a synchronous transition and the 200 arrived immediately with the final state already set.

## Index actions proposed

1. Fix `close_test_run_v1`'s own response serializer: `uuid` should be the run's actual uuid, and `closed_by` should be populated from the same write that populates `closed_at`, not left null.
2. Fix `project_id` to serialize as declared (string) on this write path, matching the schema instead of the integer it currently returns.
3. Either return `type`/`self_ui_link`/`observability_url` on this response or drop them from the declared schema; document `attachments`/`created_by`/`updated_by` since they are reliably present.
4. Follow up on `get_closed_test_runs`'s null `closed_at`/`closed_by` on a genuinely closed row — file separately against that capability's index entry.
