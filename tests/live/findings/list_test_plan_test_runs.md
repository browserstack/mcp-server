# list_test_plan_test_runs — DRIFT

- **Product / entity:** tm / `test_plan` (read)
- **Path:** `GET /api/v2/projects/{project_id}/test-plans/{test_plan_id}/test-runs`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/list_test_plan_test_runs.json`

## Summary

Three defects, found only because the probe **manufactured a real row** rather than accepting an empty collection: a declared field that never arrives, an undeclared field that does, and a type that disagrees with a sibling capability about the same underlying value.

## How a real row was obtained — and what that revealed en route

This is worth recording, because the probe would otherwise have been another UNVERIFIED:

1. **Read the readonly fixture plan `TP-1596` first**, before any write. It returned `test_runs: []`, `info.count: 0` — so the fixture proved nothing, and it was left untouched thereafter.
2. **`update_test_plan` cannot link runs.** Its own guidance states a `test_runs` list sent there is **silently discarded**. So the probe used **`update_test_run`** (mode `write`, not destructive) to set `test_plan_id: "TP-1616"` on `TR-9061` — the `__scratch__` run, not the readonly `TR-9058`.
3. **A fifth instance of the flat-vs-wrapped body trap.** That attach call had to be sent flat as `{"test_plan_id":"TP-1616"}`; a `test_run`-wrapped body — which `update_test_run`'s own `json_path` implies — was rejected client-side: `unknown body: test_run. accepted: ...`. See `findings/create_test_plan.md` for the systemic version of this.
4. **Re-fetched `TP-1616`'s runs** → exactly 1 row (`TR-9061`), `info.count: 1`.

## Drift 1 — `test_runs[].test_plan` is declared but never returned

The contract states every row carries a `test_plan` object. The actual row for `TR-9061` has **no such key at all** — and the run is genuinely linked, which is the point: this is not an "unlinked run so the field is empty" case.

The probe confirmed the link independently: the attach call's own response *did* include a `test_plan` object (on that capability's different response shape). So the data exists; this endpoint simply does not project it.

The field is also arguably redundant here — you already know which plan you asked about — which may be why nobody noticed it was missing. But an agent that reads `row.test_plan.identifier` gets `undefined`.

**Confirmed a real gap, not a phantom field (added 2026-09-18).** The open question was whether `test_plan` exists on a run at all. It does: the sibling `list_test_runs` probe **emits `test_plan` with `id` / `identifier` / `name`** for this same run `TR-9061`. So the data is available to the product and this endpoint simply does not project it. That probe also ruled out the innocent reading for the other fixture run — `TR-9058` likewise lacks `test_plan` there, but plan `TP-1596` was verified to have **zero** linked runs, so that absence is correct. See `findings/list_test_runs.md`.

## Drift 2 — `test_runs[].urls` is returned but never declared

Every row carries `urls: {self: <UI deep link>}`. It appears nowhere in the declared schema or the capability's `returns` list.

Note this is **stronger** than the `urls`/`links` gaps in the sibling plan capabilities: there, `urls` was at least declared as a bare `{type: object}` with prose describing its keys. Here the whole `urls` key is undocumented.

## Drift 3 — `filter_test_cases.is_dynamic` type disagrees across capabilities

For the **same run** (`TR-9061`):

| capability | `filter_test_cases.is_dynamic` |
| --- | --- |
| `list_test_plan_test_runs` (this one) | integer `0` |
| `update_test_run` (the attach call) | boolean `false` |

One underlying value, two JSON types depending on which endpoint answers. A typed client deserialising `is_dynamic` as a boolean breaks on this endpoint; one expecting an integer breaks on the other.

This is the third instance in the suite of two surfaces disagreeing about one value — after `create_folder`'s `cases_count` (`null` on create, `0` everywhere else) and `edit_project`'s `projectVisibilityBanner` (`null` from the write, an object from the read). Worth treating as a recurring class: **the index documents one shape per field, but serializers differ per endpoint.**

## What matched

`identifier`, `name`, `description`, `run_state`, `active_state`, `assignee`, `tags`, `overall_progress`, `project_id`, `created_at`, `updated_at`, `links`, and the full `info` pagination envelope with all five required fields — all present with correct types.

## What could not be checked

**`configurations` was an empty array** in the only available row, so its declared integer-element type is **unverified**. An empty array proves nothing about its elements.

Only **one** run was ever available, so everything above rests on a single row — though drifts 1 and 2 are structural (a key absent, a key present) rather than value-dependent, which makes them unlikely to be record-specific.

## Environment note

The first two attempts on `TP-1596` returned status 0 `"the product could not be reached"`; an unchanged third attempt succeeded. Same preprod intermittency as several probes today; distinct from a plain `{"status":500,…}`.

## Index actions proposed

1. **Remove `test_runs[].test_plan` from the declared row shape**, or fix the endpoint to project it. It is currently a promise an agent cannot rely on.
2. **Declare `test_runs[].urls`** (`{self}`).
3. **Reconcile `is_dynamic`'s type** between this capability and `update_test_run` — ideally in the API, since documenting two types for one field helps nobody. Worth checking whether other `filter_test_cases` sub-fields diverge the same way.
4. **Record that `update_test_plan` silently discards `test_runs`** more prominently, and point callers at `update_test_run` for linking. The current arrangement means the obvious capability for the job quietly does nothing.
5. Note that `configurations` may be empty, so its element type is not observable on a fresh run.

## Residue

Test run `TR-9061` is now attached to plan `TP-1616`. Both are fixture-created and live in `__scratch__` / `PR-2005`. `TP-1596` and `TR-9058` were never modified.
