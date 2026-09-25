# list_test_results_for_test_case — DRIFT

- **Product / entity:** tm / `result` (read)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — empty baseline across two batches, then re-probed against the suite's only real result
- **Run file:** `tests/live/runs/tm/list_test_results_for_test_case.json`
- **Related:** `findings/create_test_results_for_test_run.md`

## Summary

Two confirmed defects in the declared item shape, found only once a real result existed to check against. The capability's **core semantics are sound** — it correctly distinguishes recorded executions from placeholders.

## It answers the entity's central question correctly

Every test-run row carries a non-null `latest_result_id` even when nothing has been executed, which raised a real question: does this endpoint return those placeholders as results?

**No.** Across two batches it returned `test_results: []` for **ten** case×run pairings while every one of those rows had a non-null `latest_result_id`. Once a genuine execution was recorded, it returned exactly that one row.

So: **placeholder mapping rows are never returned; real recorded executions are.** The contract is sound on that axis, and this is confirmed from both directions — this capability seeing only empties where placeholders existed, and `search_test_results` independently finding 30 real rows account-wide with no `untested` or null-status entries among them.

## Drift 1 — `result_status` is missing four declared-required siblings

The schema declares `id`, `field_value`, `internal_name`, `field_name` and `colour` **together**. The response contains only:

```json
"result_status": {"field_value": "Passed"}
```

`id`, `internal_name`, `field_name` and `colour` are all absent. Independently confirmed by the sibling create probe reading the same row.

This matters beyond tidiness: `internal_name` is the lowercase token form, and its absence here is part of why the outcome vocabulary is inconsistent across the product (see `findings/create_test_results_for_test_run.md`). A caller wanting the machine-readable form cannot get it from this endpoint.

## Drift 2 — `custom_fields` type mismatch

Schema declares type **`object`**; the response is **`[]`**, an empty array. A typed client breaks; an untyped one silently gets nothing from `custom_fields.someKey`.

## Drift 3 — undeclared `urls.self`

`urls` is declared as a bare `{type: object}` with no sub-keys, and the response carries `urls.self` (a full result URL). Counted as drift under the standing rule, but this is the **already-catalogued** systemic pattern of `urls`/`links` being declared bare across many capabilities — not a novel defect, and it should be fixed at that level rather than here.

## Correctly judged benign — `execution_id`

The stored row carries a non-null `execution_id` (a 64-char hex string) despite being a plain `test_case_id`-targeted manual submission, where `execution_id` is documented elsewhere as an *alternative* automation target.

**This capability's own schema declares `execution_id` as `{type: string, nullable: true}` with no claim tying its nullness to the submission method** — so nothing here is contradicted, and it was rightly **not** scored against this verdict. The oddity belongs to `create_test_results_for_test_run`'s review, where it is recorded.

This is the right distinction to draw: a field being surprising is not the same as a contract being wrong, and attributing it to the wrong capability would have sent the fix to the wrong place.

## Sample-size caveat — carried explicitly, not glossed

This rests on **exactly one** result: `Passed`, issue-free, config-free, dataset-free, case-level.

Only the two settled defects (`result_status` siblings, `custom_fields` type) are confirmed with confidence. Every "matches" verdict on a currently null or empty field is confirmed **only in that null/empty state**. Still unverified:

- `issues[]` item shape
- `step_result` populated shape
- `configuration_id` populated shape
- `dataset` populated shape
- `result_status` for any non-`Passed` status

An `[]` proves nothing about its elements — the same principle that kept this capability UNVERIFIED for two batches applies within the row as well as to the collection.

## How the verdict moved

1. **Batch 5 + batch 7 baseline:** empty across ten case×run pairings, plus a search for executed runs in older projects that found none reachable. Correctly `UNVERIFIED` — an empty collection proves nothing about item shape.
2. **Re-probe** after `create_test_results_for_test_run` recorded result `2150387456` on `TR-9062`/`TC-54458`. Count 0 → 1, item shape finally checkable, verdict settled as `DRIFT`.

Worth noting this is the fourth time in the suite that a create sibling unblocked a read probe's verdict (`list_reports` in batch 3, `list_test_case_comments` and this one in batch 7). Where a read and a write on the same entity are probed together, the write should run first or the read will almost always end UNVERIFIED.

## Index actions proposed

1. **Fix the `result_status` declaration** — either stop requiring the four absent siblings, or have the endpoint return them. Returning `internal_name` would also help the product's outcome-vocabulary inconsistency.
2. **Correct `custom_fields` to an array**, or have the endpoint return an object.
3. **Enumerate `urls.self`** — part of the suite-wide `urls`/`links` cleanup.
4. Re-verify the nullable fields against a result that actually populates them (a failed result with issues, a configured/data-driven run) before treating their shapes as checked.
