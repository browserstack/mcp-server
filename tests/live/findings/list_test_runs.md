# list_test_runs — DRIFT

- **Product / entity:** tm / `test_run` (read)
- **Path:** `GET /api/v2/projects/{project_id}/test-runs`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — **two real rows** (`TR-9058`, `TR-9061`)
- **Run file:** `tests/live/runs/tm/list_test_runs.json`
- **Related:** `findings/list_test_plan_test_runs.md` — this probe corroborates and sharpens that one

## Summary

Invoked cleanly with real data, and drifted in both directions. Its most valuable output is not its own diff, though — it is the cross-capability evidence it gathered, which turns two earlier single-endpoint observations into confirmed defects.

## Drift 1 — `issues` and `issue_tracker` declared, never returned

Both are listed in the flat `returns` array and appear on neither row. Another instance of the flat `returns` array over-claiming, now seen across four capabilities in this suite.

## Drift 2 — undeclared fields returned

| field | status |
| --- | --- |
| top-level `urls` (with a real `self` key) | present in the flat `returns` array but **absent from the nested per-item schema** |
| `links.self`, `links.test_cases` | `links` declared as a bare `{type: object}` with no enumerated properties |
| `test_plan.identifier`, `test_plan.name` | `test_plan`'s prose mentions only an `id` sub-field |

The `urls` case is a neat illustration of why the flat `returns` array and the nested schema need reconciling: the field is declared in one and missing from the other, so which you call "declared" depends on which half you read.

## Drift 3 (qualified) — `overall_progress`

Declared in the nested schema, absent on both rows. **This is probably correct behaviour**: both runs are in `new_run` state and the contract documents `overall_progress` as omitted when nothing has been executed. Recorded for completeness rather than as a defect — and see the timing note below, where it later appeared.

## The three-way type split on `is_dynamic` — now confirmed

This suite had one observation of a field carrying two JSON types depending on the endpoint. This probe deliberately re-fetched **the same run, `TR-9061`**, through a second capability and settled it:

| capability | `filter_test_cases.is_dynamic` |
| --- | --- |
| `list_test_runs` (this one) | boolean `false` |
| `update_test_run` | boolean `false` |
| `list_test_plan_test_runs` | **integer `0`** |

One field, one record, three endpoints, two types. The outlier is `list_test_plan_test_runs`, which makes that the endpoint to fix rather than the contract.

This is the fourth instance in the suite of one value differing by endpoint, after `cases_count` (`null` on folder create, `0` elsewhere), `projectVisibilityBanner` (`null` from the project write, object from the read), and this. **The pattern is now well-evidenced enough to treat as a class: the index documents one shape per field while the serializers differ per endpoint.** No amount of per-capability review catches it; only fetching the same record through several capabilities does.

## It also proves `list_test_plan_test_runs`'s missing `test_plan` is a real gap

`list_test_plan_test_runs` declares `test_runs[].test_plan` and never returns it. The open question was whether the field exists at all.

It does. **`list_test_runs` emits `test_plan` with `id` / `identifier` / `name`** for `TR-9061`, which is genuinely linked to `TP-1616`. So the data is available to the product, and the other capability's omission is a projection gap in that endpoint — not a field the index invented.

The probe also ruled out the innocent explanation for the *other* row: `TR-9058` has no `test_plan` here either, but a check against `TP-1596` confirmed that plan has **zero** linked runs, so the omission is correct for that record. Distinguishing "correctly absent" from "wrongly absent" is exactly the diligence this needed.

## A timing artifact, correctly not reported as drift

Between the probe call and the later cross-check, `TR-9061`'s `updated_at` changed and `overall_progress: {Untested: 1}` appeared — the run's state genuinely changed between calls, most likely from concurrent fixture activity in this batch. The agent recorded it as a timing artifact rather than manufacturing a shape difference from it. Worth noting because it is a real hazard when several probes share one fixture: **a field appearing between two calls is not necessarily drift.**

## Confirmed correct

- The v2 route requires `PR-NNN`; the bare integer is rejected client-side (`'project_id' must match ^PR-\d+$`), exactly as declared.
- `page_size: 300` and `include_closed` behaved as documented.
- Two rows returned, so the item shape was genuinely verifiable — not an empty-collection case.

## Addendum (batch 7) — it 500s on other projects

A later probe (`list_test_results_for_test_case`) needed to enumerate runs in older projects and found **`list_test_runs` returns 500 on `PR-1` (Default Project) and `PR-73` (Demo KB)**, while a `list_projects` control call succeeded **in the same window** — so this is not the preprod flakiness that has affected this suite, and it meets the evidentiary standard adopted after a retraction in batch 6.

It works on the fixture project `PR-2005`, where this capability was probed and returned two rows cleanly. So **something about those older projects breaks it.** Both are substantially larger and older — `Demo KB` holds 386 test cases and 184 runs — so plausible causes include scale, a data shape absent from the fresh fixture, or runs of a type the serializer mishandles (both projects' runs turned out to be automation-build runs with `test_cases_count: 0`).

This was **not** part of this capability's own probe and is recorded for visibility rather than folded into its verdict, which stands on the fixture-project evidence. But it matters: a listing capability that works on a new project and fails on a mature one would be invisible to any test that only ever looks at fresh fixtures — which is exactly what this suite does.

A related observation from the same probe: **`list_test_runs_by_integer_id` returned 400 regardless of arguments** in that window, despite having worked in batch 6 to resolve `TR-9062` → `17575382`. Not enough evidence to call, but worth a look alongside the above.

**Suggested next step:** call `list_test_runs` against `PR-1` and `PR-73` with server-side logs attached. The diff between those and `PR-2005` should localise it quickly.

## Index actions proposed

1. **Remove `issues` and `issue_tracker`** from the declared returns, or fix the endpoint to emit them.
2. **Add `urls` to the nested per-item schema** (it is in `returns` only), and **enumerate `links.self` / `links.test_cases`**.
3. **Enumerate `test_plan`'s sub-fields** — it returns `id`, `identifier` and `name`, while the prose mentions only `id`.
4. **Fix `is_dynamic`'s type on `list_test_plan_test_runs`** — two capabilities say boolean and one says integer, so the odd one out is the bug. Worth checking whether other `filter_test_cases` sub-fields diverge the same way.
5. **Note that `overall_progress` is omitted until something is executed**, in the nested schema and not only the prose.
