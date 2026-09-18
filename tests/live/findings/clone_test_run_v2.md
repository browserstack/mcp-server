# clone_test_run_v2 — DRIFT (one new behavioural gap; the rest is known systemic drift)

- **Product / entity:** tm / `test_run` (write — creates a copy)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — source `TR-9062`, clone `TR-9063`
- **Run file:** `tests/live/runs/tm/clone_test_run_v2.json`
- **Related:** `findings/get_test_run_v2.md`, `findings/create_test_run_v2.md` (the entity-wide schema drift)

## Summary

The clone works, is synchronous, and was verified in storage. **One genuinely new defect** — the run-level assignee is silently dropped. Everything else in its diff is the already-documented entity-wide `test_run` schema problem, recorded for completeness rather than as new information.

## The new finding — the run-level `assignee` is dropped, undocumented

| | run-level `assignee` |
| --- | --- |
| source `TR-9062` | `"ing@bsstag.com"` |
| clone `TR-9063` | **`null`** |

The contract offers `copy_tc_assignee`, but its own description scopes it to **per-case** assignees. There is **no declared option to carry the run-level owner/assignee**, and nothing in the guidance says it is dropped.

So an agent cloning a run loses its owner with no warning and no way to ask for it to be preserved. A caller would have to notice the `null` and re-set it — which requires knowing to look.

This is a **behavioural gap**, not a schema mismatch: the field is declared and returned correctly, it just silently loses its value across the operation.

## The crux question answered — the clone dedupes

The source carried an **accidental duplicate** row (`TC-54457` mapped twice, `latest_result_id` 2150387252 and 2150387283) created by `bulk_update_test_run_test_cases_v2` and impossible to remove because its removal path no-ops.

**The clone got 4 rows, not 5.** `TC-54457` appears exactly once, with a fresh `latest_result_id` (2150387393). So clone **re-derives the case list rather than copying the row table**, even with `test_case_selection` defaulted to "all".

Two useful consequences:

1. It is a real, documented-by-observation behaviour worth adding to the guidance — clone is not a byte-for-byte copy of the mapping table.
2. **It is currently the only way to get a clean copy of a run whose rows have been duplicated**, given that `remove_test_cases` does not work. That is a practical workaround worth recording for anyone who hits the duplication bug.

## Verified in storage, and the source left intact

Not trusted from the response:

- `list_test_runs_v2` on `PR-2005`: **count 3 → 4**, with `TR-9063` present.
- `get_test_run_test_cases_v2` on `TR-9063`: full row set returned on the very next call — **synchronous**, 200 (not the `202 {async:true}` its sibling returns).
- `get_test_run_test_cases_v2` and the run header re-read on **`TR-9062`** afterwards: still exactly 5 rows with the identical five `latest_result_id` values, tags/assignee/run_state unchanged. **Cloning did not mutate the source.**

That last check matters given this batch's silent-write problems, and it came back clean.

## What could not be determined

Recorded as inconclusive rather than asserted:

- **`run_state` semantics** — both source and clone are `new_run`, but the source already *was* `new_run`, so whether clone resets to default or carries the source's state is untested. A source in `in_progress` would settle it.
- **`configurations`** — empty on both; the source has none, so copying behaviour is unobserved.
- **Plan linkage** — the source was never linked to a plan, so whether a clone inherits one is untested. (`TR-9061` is plan-linked to `TP-1616` and would answer this, but it is a fixture run and was not cloned.)
- **Per-case assignees / `copy_tc_assignee`** — all source rows have `assignee: null`, so the flag's effect could not be observed. This is a real gap: the one option that *is* declared for assignee-copying went untested, while the undeclared run-level behaviour is what broke.

## Known systemic drift, recorded not re-litigated

`declared_missing`: `id`, `uuid`, `owner`, `is_automation`, `is_dynamic`, `test_plans`, `test_cases_count`, `overall_progress`, `overall_progress_by_status_id`, `links.detail`.
`undeclared_returned`: `filter_test_cases`, `urls`, `links.test_cases`.

Both lists match the **entity-wide over-declared `test_run` schema** already documented on `create_test_run_v2` and `get_test_run_v2` — now confirmed on a third and fourth capability in the family. It drives the DRIFT verdict under this suite's rule that a non-empty diff is DRIFT regardless of severity, but it is **not a new defect** and should be fixed once at the shared schema, not per capability.

**No numeric id** is exposed for `TR-9063` either — consistent with the rest of the v2 surface.

## Index actions proposed

1. **Document that the run-level assignee is not carried**, or add an option to carry it. This is the only new defect here and the only one specific to this capability.
2. **Document that clone re-derives the case list** rather than copying mappings — including that it dedupes, which is currently a useful escape hatch from the duplication bug.
3. Fix the shared `test_run` response schema (tracked on `get_test_run_v2`) — this capability comes right with it.

## Residue

Clone **`TR-9063`** (`__mcp-probe-clone-2026-09-18T07-05-00Z`) in `PR-2005`, 4 rows, all `untested`. Deletion is `destructive` and refused by the runtime, so it persists and is reported in the batch residue.
