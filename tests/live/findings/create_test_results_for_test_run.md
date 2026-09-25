# create_test_results_for_test_run — DRIFT (and the v1/v2 twins disagree on six axes)

- **Product / entity:** tm / `result` (write)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — one write, verified twice in storage
- **Run file:** `tests/live/runs/tm/create_test_results_for_test_run.json`
- **Related:** `findings/search_test_results.md`, `findings/list_test_results_for_test_case.md`

## Summary

**This capability works, and it is the only one in seven batches to create a `result`.** Its own write response matched its declared schema exactly. The DRIFT comes from two places: the **stored** result disagrees with the read capability's schema, and the **v1 and v2 forms of this operation disagree with each other on six separate axes**.

## It works — verified twice, not trusted from a 2xx

Given that batch 6 found four `test_run` writes reporting success while doing nothing, this was checked properly:

- **Before:** `list_test_results_for_test_case` → `test_results: []`; the run row at `latest_status: "untested"`, `latest_result_id: 2150387254`.
- **Write:** flat body `{test_case_id: "TC-54458", status: "Passed", description: "…"}` against `path_params {project_id: "PR-2005", test_run_id: "TR-9062"}` → **200**, `{success:true, "test-result": {id: 2150387456, status: "Passed", …}}`. First attempt, exactly as declared.
- **Verify 1:** `list_test_results_for_test_case` now returns **one row**, id 2150387456, `result_status.field_value: "Passed"` — an endpoint that had returned `[]` on every pairing ever tried, across two batches.
- **Verify 2:** `list_test_run_test_cases` shows the row at `latest_status: "passed"`, `latest_result_id: 2150387456`.

## Finding 1 — the v1 and v2 twins disagree on six axes

The task asked specifically whether the v1 and v2 forms agree. **They do not**, and this is the most extensive same-entity disagreement the suite has found — worse than `get_` vs `list_custom_fields`, and different in kind from the `test_plan` / `test_run` cases where a whole family was wrong the *same* way. Here the two forms are wrong **relative to each other**:

| axis | v1 `create_test_result_for_test_case` | v2 (this capability) |
| --- | --- | --- |
| **status input** | integer `status_id` | display-case **name** string `"Passed"` — v2's guidance states v1's `status_id` is *"NOT accepted here"* |
| **status output** | both a lowercase token (`status: "passed"`) **and** a full `result_status` object | only display-case `status: "Passed"` — **no `result_status` object at all** |
| **`issues` shape** | objects `{issue_id, issue_type}` | plain strings `["JIRA-12"]` — **a direct contradiction on the same field name** |
| **envelope** | wrapped in `data`, HTTP **201** | `test-result` at top level, HTTP **200** |
| **id forms** | plain integer project/case ids; either `TR-` or bare-integer run id | requires `PR-NNN` / `TR-NNN` / `TC-NNN` strings; bare integers **404** |
| **duplicate handling** | has a top-level `mapping_id` to disambiguate | **no such parameter exists** |

The `issues` contradiction is the sharpest: same field, same entity, opposite shapes. An agent that learns one form and applies it to the other gets a rejection at best.

**The missing `mapping_id` is not hypothetical here.** This very fixture contains `TC-54457` mapped **twice** to `TR-9062` (a batch-6 bug duplicated the row). v1 could target one specific mapping; **v2 cannot address them separately at all.** So the capability gap has a live instance sitting in the fixture.

## Finding 2 — the stored result contradicts the read capability's schema

Enumerated via `list_test_results_for_test_case`:

- **`result_status` returned as `{"field_value":"Passed"}` only.** Its schema declares `id`, `internal_name`, `field_name` and `colour` as **required** siblings — all four absent. `declared_missing`.
- **`custom_fields` returned as `[]` — an array — where the schema declares type `object`.** A type mismatch, not an empty-value quibble: a caller doing `custom_fields.someKey` gets `undefined` and one doing `Object.keys()` gets `[]` either way, but a typed client breaks.

Everything else matched: `id`, timestamps, `created_by`, `description`, `test_case_id`, `test_run_id`, `issues`, `step_result`, `configuration_id`, `dataset`, `urls`.

**Oddity, recorded but not scored:** the stored row carries a **non-null `execution_id`** (a long hex string) even though this was a plain `test_case_id`-targeted manual submission, and `execution_id` is documented elsewhere as an *alternative* automation target. The declared type is satisfied, so it is not drift — but it suggests `execution_id` is always populated rather than being the discriminator the docs imply.

## Finding 3 — the outcome vocabulary, and why "mark a test as passed" misses

The task asked what vocabulary a search would have to match. **The same outcome is represented four ways across this product:**

| surface | form |
| --- | --- |
| this capability — input **and** echo | display case — `"Passed"` |
| `list_test_results_for_test_case` → `result_status.field_value` | display case — `"Passed"` |
| `list_test_run_test_cases` → `latest_status` | **lowercase** — `"passed"` |
| `search_test_results` → flat `status` | **lowercase** internal token, and `null` in 29 of 30 rows |

Each capability matches its *own* declared example, so none is individually drifting — but collectively there is no single token for "passed" that works everywhere.

**For the failing search query specifically:** a user typing "mark a test as passed" uses the lowercase form, which matches the *internal* token exposed by the read surfaces, while the **write** capability — the one the query should reach — documents only display case. The retrieval vocabulary and the actionable vocabulary differ by case.

The probe deliberately did **not** test whether a lowercase input is also accepted, to avoid creating a second permanent, undeletable result beyond the one authorised. **That remains open**, and it is the single cheapest thing to check next: if `"passed"` is accepted on input, the fix is documentation; if not, the contract should say so explicitly.

## Index actions proposed

1. **Reconcile v1 and v2, or document the divergence loudly.** Six axes is enough that an agent cannot safely generalise from one to the other. The `issues` shape contradiction should be fixed outright.
2. **Fix `result_status`'s required-siblings declaration** on `list_test_results_for_test_case` — only `field_value` is returned.
3. **Correct `custom_fields` to an array**, or have the endpoint return an object.
4. **Add a `mapping_id` parameter to v2**, or document that duplicate mappings cannot be targeted — there is a live instance of exactly that in this fixture.
5. **Document the outcome vocabulary in one place**, including which surfaces use display case and which use lowercase tokens, and whether input accepts both.
6. Clarify whether `execution_id` is always populated or is genuinely an alternative target.

## Residue

**Result id `2150387456`**, status `Passed`, on `TR-9062` / `TC-54458` (mapping `2150387254`). Results cannot be deleted through this surface — deletion is `destructive` and refused — so this is **permanent**, and it is the only test result in the fixture pool.
