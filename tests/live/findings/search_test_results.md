# search_test_results — DRIFT

- **Product / entity:** tm / `result` (read)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — **30 real rows**, the first genuine execution data seen in seven batches
- **Run file:** `tests/live/runs/tm/search_test_results.json`

## Summary

**This is the only capability in the whole suite that produced real `result` data.** A single unfiltered call returned `info.count: 227467` with 30 populated rows carrying genuine `passed` / `failed` / `blocked` statuses and real timestamps from 2026-09-17/18, drawn from sibling projects in the shared preprod account.

Every other `result` probe across seven batches hit empty collections. So this probe alone verified the `result` item shape — and found six defects in it.

## What it settles about the `result` entity

**A "result" means a genuine logged execution, not a placeholder.** Every test-run row carries a non-null `latest_result_id` even when never executed (`latest_status: "untested"`), which raised the question of whether those placeholder rows are results.

They are not. All 30 rows had real `result_status` values; **no `untested` or null-status rows appeared at all**, consistent with this being backed by the actual execution table — a never-executed mapping simply has no row for this search to find. This independently confirms the sibling `list_test_results_for_test_case` conclusion, reached from the opposite direction (it saw only empties where placeholders existed).

## Drift 1 — two fields for the same concept disagree *within one response object*

The row carries both a nested `result_status.field_value` and a **flat top-level `status`**:

| | value |
| --- | --- |
| `result_status.field_value` | display case — `"Failed"`, `"Passed"`, `"Blocked"` |
| `status` | **`null` in 29 of 30 rows**; in the one populated row, the lowercase internal token `"blocked"` |

So in that single row, the two fields describing the same outcome **disagree in casing**, and `status` also disagrees with what the write sibling expects.

`status` is additionally declared as a **non-nullable string** and was null 29 times out of 30 — a type violation on top of the inconsistency.

**This is the cheapest kind of bug for an agent to fall into**: `status` is the more obvious field name, it is declared non-nullable so a caller has no reason to guard it, and it is usually null.

## Drift 2 — the outcome vocabulary, and what a search would have to match

`result_status.field_value` uses display case (`"Passed"`, `"Failed"`, `"Blocked"`) and **matches** what the write sibling `create_test_results_for_test_run` documents (`status: "Passed"/"Failed"/"Untested"`, configured display-case names). So read and write agree on the *nested* field — good.

But the flat `status` carries the **lowercase internal token**. Anything reasoning over outcomes must know which of the two fields it is reading, and they are not interchangeable.

This bears directly on the search query **"mark a test as passed"**, which currently fails to reach the write capability: the vocabulary an agent would naturally use (lowercase `pass`/`passed`) matches the *internal* token, while the documented enum is display-case. Worth noting for whoever tunes retrieval — the surface vocabulary and the documented vocabulary differ by case, and one of the two fields exposing it is almost always null.

## Drift 3 — declared fields never returned

- `result_status.entity_type` — **declared required**, never returned
- `author.reports_and_notification_enabled` — declared, absent in all 30 rows
- `updated_by.reports_and_notification_enabled` — declared, absent in all 30 rows
- `issues[].issue_type` — the contract states explicitly that "each entry carries `issue_id` and `issue_type`"; `issue_type` never appeared

## Drift 4 — undeclared fields returned

`result_status.value_category`, `result_status.valueDetails`, `issues[].created_at`.

Note `valueDetails` is camelCase amid otherwise snake_case fields — a hint it comes from a different serializer layer.

## Drift 5 — non-nullable declarations that are always null

- `attachments` — declared a non-nullable **array**, was `null` on every one of 30 rows. Never once observed as an array.
- `updated_by` — declared a non-nullable **object**, likewise always null.

A caller doing `attachments.length` or `attachments.map(...)` gets a TypeError on every row, not an empty result. This is the same defect shape as `create_test_case`'s omitted `attachments`, now on a different entity.

## What the contract gets right

- **It is account-wide by design**, with no project parameter — and the contract says so. Passing `project_id` was rejected **pre-flight by the tool's own allow-list** (`unknown query: project_id. accepted: compact, include_relations, issue_id, issue_type, p, per_page, priority, q`), not silently dropped. So one unfiltered call covers the whole account.
- `test_run_id` is overwritten to the `"TR-NNN"` string form under `compact=false`, and `links.self` appears only when tied to `project_id` — **both behave exactly as the guidance describes.** Accurate guidance, recorded as such.

## Severity

Low-to-moderate. The endpoint works, is genuinely populated, and most declared fields matched. The drift concentrates in nested sub-object field lists plus the nullability and casing problems — but Drift 1 and Drift 5 would both break a typed client immediately.

## Index actions proposed

1. **Fix `status`** — declare it nullable, reconcile its casing with `result_status.field_value`, or remove it. Two fields for one concept that disagree, where the obvious one is usually null, is a trap.
2. **Declare `attachments` and `updated_by` nullable**, or have the endpoint emit `[]` / an object.
3. **Remove `result_status.entity_type`, the two `reports_and_notification_enabled` fields, and `issues[].issue_type`** from the declaration, or fix the endpoint to emit them. The `issue_type` claim is in the prose as well as the schema, so both need correcting.
4. **Declare `result_status.value_category`, `result_status.valueDetails`, `issues[].created_at`.**
5. **Record the outcome vocabulary explicitly** — display case in `result_status.field_value`, lowercase internal tokens in `status` — since this is what any retrieval over "passed"/"failed" has to match.
