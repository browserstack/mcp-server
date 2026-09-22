# bulk_assign_test_cases_to_test_run — DRIFT (name/intent mismatch, undeclared 502, wrong guidance)

- **Product / entity:** tm / `test_run` (write)
- **Environment:** preprod
- **Probed:** 2026-09-21 — project `PR-2005` (379335744), run `TR-9110` (uuid 17577900)
- **Run file:** `tests/live/runs/tm/bulk_assign_test_cases_to_test_run.json`

## Summary

Three separate findings, in order of severity.

## Finding 1 — the capability does not "assign test cases to a test run"

Despite the name, and despite `entity: test_run`, this capability **cannot add a case to a run**. Its own `describeCapability` intent says plainly: *"Set the assignee on many test cases inside a test run in one call"* — it reassigns the owner of rows **already mapped into the run**. The body accepts `assignee_id`, `mapping_ids`, `select_all`, `de_selected_ids`, `folder_id`, `q`, `automation`, `test_run_ids` — nothing that inserts a new case.

Verified empirically: `TR-9110` held 3 cases (TC-54455/54456/54458) before and after every call made against this capability in the probe. `test_cases_count` never moved.

The task behind this probe needed 4 additional cases (TC-54485/54486/54487/54489) actually mapped into `TR-9110` so the "result family" of capabilities (`create_test_result_for_test_case`, `create_step_result_v1`, `update_latest_test_result_for_test_case`, `bulk_edit_test_cases_in_test_run`) would have a case-in-a-run-we-own to target. That requires a genuinely different capability — `edit_test_run` (top-level `test_case_ids`, additive) or `bulk_update_test_run_test_cases_v2` (`test_run.add_test_cases`, always async 202). An attempt to use `edit_test_run` for that setup step was refused by this session's own write-permission scope (harness auto-mode classifier: "Modify Shared Resources"), not by the API — the probe was authorized only for `bulk_assign_test_cases_to_test_run` itself. So **TC-54485/54486/54487/54489 were never mapped into TR-9110, and no mapping_id exists for them.**

**Anyone reaching for this capability by name to get cases "assigned to" a run will be doing the wrong thing.** It silently accomplishes nothing toward that goal (case count never changes) while returning 200 and looking like it worked, because it does successfully reassign whatever mapping_ids you gave it — just not the operation the name promises.

## Finding 2 — undeclared 502 on any bad id, not the documented no-op

The capability's own guidance claims: *"Passing the case's `id` here assigns nothing and still returns 200."*

Tested directly: sent TC-54455's test-case `id` (`1971631`) in `mapping_ids` (instead of its `mapping_id`, `2150421282`).

Result: **502** `{"success":false,"message":"Failed to update assignee"}` — not 200, not a no-op.

Same result for a wholly fabricated `mapping_id` (`999999999`) mixed in with two valid ones:

```json
{"assignee_id": 3741, "mapping_ids": [2150421282, 2150421284, 999999999]}
```

→ **502** `{"success":false,"message":"Failed to update assignee"}`. Removing the bad id and resending the same two valid mapping_ids succeeded cleanly (200).

502 is not among the declared responses (200, 400, 401, 403, 404, 422, 500) — the real failure mode for a bad id sits entirely outside the documented error surface, and the documented recovery behavior ("assigns nothing, still 200") could not be reproduced in either form tested (2/2 reproductions of the 502).

## Finding 3 — partial failure is all-or-nothing, unlike sibling capabilities

The task's standing question for every bulk route: does a bad id alongside good ones get silently dropped (like `create_bulk_test_cases_v1`), or named in a `skipped_test_case_ids`-style field (like `edit_test_run` and `get_test_cases_for_v1_test_run` both expose)?

Answer for this capability: **neither.** One bad `mapping_id` fails the **entire** batch with the undeclared 502 above — the two valid rows were **not** assigned (confirmed by re-reading `TR-9110` before the clean retry). There is no `skipped_test_case_ids` field on this capability's declared or observed response at all. This is a third, distinct partial-failure behavior in this bulk-route family: 200-and-silently-drop (`create_bulk_test_cases_v1`), 200-and-name-the-skips (`edit_test_run`, `get_test_cases_for_v1_test_run`), and now all-or-nothing-502 (`bulk_assign_test_cases_to_test_run`).

## What worked cleanly

- `assignee_id` correctly sets (or, if omitted, would clear) `test_assignee` on rows addressed by real `mapping_id`s.
- Both run-id forms in the path succeeded: `"TR-9110"` and the bare integer string `"17577900"` — matching the declared `^(TR-)?[0-9]+$` pattern.
- `project_id` as the wrong type (`"PR-2005"` string instead of integer `379335744`) was rejected **client-side** by `invokeCapability` itself (`'project_id' must be a number'`) before ever reaching the API — a clean rejection, just not a live-API 4xx.
- `TC-54458`'s mapping (the campaign's 14-result evidence case) was never touched by any call in this probe, confirmed by re-read after every write.

## Minor — response inconsistency worth a second look

The re-listed rows embedded in the 200 write response report `"test_run_id": 359842"` on every row, while a direct `get_test_cases_for_v1_test_run` read of the identical rows (immediately before and after) reports `"test_run_id": 17577900"` (the run's real `uuid`). Did not affect this probe's conclusions since `mapping_id` and case identifiers were consistent throughout, but the write-response embedding appears to surface a different internal id than the run's public integer id.

## Index actions proposed

1. **Rename or re-scope the capability's intent framing** so agents don't reach for it to add cases to a run — or add an explicit `guidance` line pointing to `edit_test_run` / `bulk_update_test_run_test_cases_v2` for that job.
2. **Correct the guidance claim** "Passing the case's id here assigns nothing and still returns 200" — empirically it 502s.
3. **Declare 502 as a real response**, or fix the backend to return a documented 4xx (400/422) for an unresolvable `mapping_id`, ideally naming the bad id the way `edit_test_run` does with `skipped_test_case_ids`.
4. **Investigate the `test_run_id` field mismatch** between the write-response's embedded listing and a direct read of the same rows.
