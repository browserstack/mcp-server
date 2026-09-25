# bulk_edit_test_cases_in_test_run — DRIFT (response shape contradicts its own guidance; silent partial failure; status-id disagreement between readers)

- **Product / entity:** tm / `test_run` (write)
- **Environment:** preprod
- **Probed:** 2026-09-22 — project `PR-2005` (379335744), run `TR-9120` (uuid 17578918, a disposable clone holding 5 untested cases at the time of probing)
- **Run file:** `tests/live/runs/tm/bulk_edit_test_cases_in_test_run.json`

## What this capability actually does — confirmed, not just quoted from the contract

The capability's own `describeCapability` guidance already states it "writes execution results, not the test cases themselves." That claim was verified empirically rather than trusted: after setting TC-54485's row in TR-9120 to Blocked, a direct read of the case itself (`get_test_case_by_integer_id`) showed its own `description`, `status` (Active, id 318632) and `updated_at` (2026-09-21T13:42:43Z, from an unrelated earlier probe) completely unchanged — a full 16 hours older than this write. Only the run row's `latest_status` and a newly-minted result (id 2150424086) moved. So this naming concern, unlike three other capabilities flagged elsewhere in this campaign, is **not** a fourth misnomer — the name and the write-scope match.

## Finding 1 — the declared response item shape is not what comes back

`describeCapability` declares the `test_cases[]` item as a narrow, purpose-built shape and says so explicitly: *"Built by a different serializer from the run's case LISTING... kept separate so corrections to the listing shape do not silently redescribe this one."* Declared fields: `identifier`, `name`, `description`, `priority` (string label), `status` (string), `case_type`, `latest_status`, `latest_result_id`, `assignee` (string), `folder_path` (int array), `configuration_id`, `dataset`, `project_id` ("PR-1" string), `source_project_id` ("PR-7" string).

The actual response, on both writes made in this probe, is the **wide `list_test_run_test_cases_by_integer_id` row shape**, unmodified: `assignee`/`priority`/`case_type`/`automation_state` come back as full objects, not strings; there is no `latest_result_id` (it's `mapping_id`); no `configuration_id` (it's `configuration`, and it's `null` rather than absent); no `folder_path` (it's `test_case_folders_path`, an array of objects); no `source_project_id` at all; and `project_id` is a bare integer, not `"PR-2005"`. Roughly 35 additional undeclared keys ride along (`mapping_id`, `result_status`, `result_custom_fields`, `custom_fields`, `defects`, `tags`, `owner`, `links`, …) — see the run file's `probe.item_shape` for the complete list.

The "kept separate" claim in the guidance is false for this environment: the listing shape is exactly what is returned.

## Finding 2 — status-id disagreement between two readers of the identical result row

Sent `status_id: 318612` (resolved via `get_test_runs_form_fields` as "Blocked"). Two reads of the *same* result (id `2150424086`), taken back to back:

| reader | `result_status.id` for the same Blocked result |
| --- | --- |
| `list_test_run_test_cases_by_integer_id` (run-row re-read) | `318612` — matches what was sent |
| `list_test_results_for_test_case_by_integer_id` (per-result read) | `318639` — same `field_value: "Blocked"`, same `internal_name: "blocked"`, same `colour: "#818CF8"` |

Same status, same result row, same instant — two different numeric ids depending which endpoint answers. This reproduces, with fresh evidence tied to this capability's own write, the 318612-vs-318639 pattern already suspected elsewhere in this campaign.

## Finding 3 — silent partial failure: a bad `mapping_id` produces zero signal, not an error

Sent `mapping_ids: [2150424067 (valid, TC-54456), 999999999 (nonexistent)]`. Result: **200**, `success: true`, the valid row correctly updated to Failed, and `skipped_test_case_ids: []` — empty, not populated (that field is documented as covering review-gate exclusions only, and it doesn't cover this case either way). Nothing in the response indicates one of the two requested ids matched nothing. An agent cannot tell from this response whether all, or only some, of its `mapping_ids` were applied.

This is a fourth distinct partial-failure behavior across this bulk-route family in this campaign: silent-discard-200 (`create_bulk_test_cases`), named-skip (`edit_test_run` / `list_test_run_test_cases_by_integer_id`), all-or-nothing-502 (`bulk_set_test_case_assignee_in_run`), and now silent-no-op-200-with-no-signal-at-all (this capability).

## What worked cleanly / negative results worth recording

- **No duplicate-row bug on this route.** Re-read TR-9120's row count via `list_test_run_test_cases_by_integer_id` after each of the two writes: `info.count: 5` both times, 5 identifiers, 5 rows. The `create_step_result` defect (one call minting two case-level result rows) does **not** reproduce here.
- **`description` is persisted, but invisible from the run-listing readers.** The comment text sent in `description` shows up correctly via `list_test_results_for_test_case_by_integer_id` (the per-result read) but both `list_test_run_test_cases_by_integer_id` and `get_test_run` report `result_notes: null` / no comment field at all on the identical row. Checking either listing read alone would wrongly conclude the comment never landed.
- **`mapping_id` instability reconfirmed.** TC-54485: `2150424068 → 2150424086`. TC-54486: `2150424070 → 2150424087`. TC-54456: `2150424067 → 2150424089`. All freshly resolved immediately before use, per the task's standing warning.
- Used **TC-54485** and **TC-54486**'s rows for the primary probe, not TC-54458, per instruction — even though a write to TC-54458's row inside TR-9120 could not have touched the campaign's evidence copy (that lives in TR-9062, never referenced here).
- TR-9110, TR-9062, TR-9061 and TR-9075 were never referenced by any call in this probe.

## Index actions proposed

1. **Fix or retract the "different serializer" claim** in the guidance — either make the response actually match the declared narrow shape, or replace the declared schema with the real wide listing shape so the contract stops promising something it doesn't deliver.
2. **Investigate the status-id split** (318612 vs 318639 for the same "Blocked" result) — this is now confirmed on two different capabilities' read paths in this campaign and looks like two independent id spaces (or a stale mapping table) rather than a one-off.
3. **Add a signal for unmatched `mapping_id`s** — even a count (`applied: 1, requested: 2`) would let an agent detect a partially-silent failure instead of assuming success from a bare 200.
