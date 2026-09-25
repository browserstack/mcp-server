# bulk_set_test_result_status — DRIFT (moderate severity, undocumented behavior)

- **Product / entity:** tm / `result` (write — bulk status change on test-run rows)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Probed:** 2026-09-18 — subject run `TR-9062` (final probe of the 69-capability, seven-batch suite)
- **Run file:** `tests/live/runs/tm/bulk_set_test_result_status.json`
- **Related:** `findings/bulk_update_test_run_test_cases.md` — same duplicate mapping (`TC-54457` / mapping ids `2150387252`, `2150387283`), same `TR-9062`, same missing-`mapping_id` gap

## This one is NOT a silent no-op

Unlike four of the six `test_run` write capabilities found in batch 6, this capability's `200 {"success": true}` was truthful about causing a real, verified change, twice:

| call | status sent | mapping that changed | before → after |
| --- | --- | --- | --- |
| 1 | `"Failed"` (title case) | `2150387283` | `untested` → `failed` |
| 2 | `"passed"` (lowercase) | `2150387283` | `failed` → `passed` |

Both calls returned exactly the declared schema — `{"success": true}`, nothing missing, nothing extra. `TC-54458` (the suite's only pre-existing verified `passed` result, mapping `2150387456`) and both `__readonly__` rows (`TC-54455`/`2150387253`, `TC-54456`/`2150387251`) were confirmed unchanged in storage across all three reads. No over-application, no under-reporting of the row it actually touched.

## The finding: duplicate-mapping resolution is silent and undocumented

`TC-54457` has two mappings in `TR-9062` — `2150387252` (original, created 06:27:38) and `2150387283` (the batch-6 `add_test_cases` duplicate, created 06:51:21). This capability addresses rows **only by case identifier** (`test_case_ids: ["TC-54457"]`) — it declares no `mapping_id` parameter at all, confirming a sibling's finding that the v1 result-create capability has `mapping_id` to disambiguate duplicates while this v2 capability has none.

Given that, targeting `TC-54457` does not set both mappings, and does not fail — it silently resolves to **exactly one** of the two, every time. Across two separate calls with two different target statuses, the **same** mapping (`2150387283`, the later-created duplicate) changed both times; the original mapping (`2150387252`) was never touched by either call and is still `untested`.

This looks deterministic (consistent with "the run's most-recently-created mapping for this case wins"), but:
- nothing in the guidance documents this resolution rule or even acknowledges that a case can be multiply mapped within one run,
- the response gives **zero signal** that only one of two mapped rows for the targeted case was affected — a caller addressing "`TC-54457`" and getting `{"success": true}` back has no way to know that a same-named row exists and was left at its old status.

A caller who assumes "target case `TC-54457`" means all of that case's rows in the run will silently under-apply the change to the older/original mapping. That is the same *class* of defect as the batch's silent-no-op findings (2xx that doesn't truthfully describe its own coverage) even though, in this instance, the capability was honest about the row it did change — it just never had a way to say *which* row, or that another one with the same case id existed and was skipped.

## Vocabulary

Input accepted both display-case (`"Failed"`) and lowercase (`"passed"`) case-insensitively, exactly as the guidance promises ("matched case-insensitively against the configured internal name or display value"). The capability's own response never echoes the status or any affected id back — both calls returned only `{"success": true}` — so "which form it returns" cannot be observed from this capability directly; it simply doesn't return anything to check. The resulting stored state, read back via `list_test_run_test_cases.latest_status`, rendered lowercase (`"failed"`, then `"passed"`) regardless of which case was sent, consistent with that sibling's own documented lowercase form.

## Permanent residue

This probe cannot be undone (results have no version history). Final state of `TR-9062`:

| case | mapping id | final `latest_status` |
| --- | --- | --- |
| `TC-54458` | 2150387456 | `passed` (untouched — the suite's pre-existing verified result) |
| `TC-54457` | 2150387252 | `untested` (targeted twice by case id, never actually changed) |
| `TC-54457` | 2150387283 | **`passed`** (was `untested`; changed by this probe) |
| `TC-54456` | 2150387251 | `untested` (readonly, untouched) |
| `TC-54455` | 2150387253 | `untested` (readonly, untouched) |

## Index actions proposed

1. **Document the duplicate-mapping resolution rule** — state explicitly which mapping wins when a targeted case id has more than one mapping in the run (observed here: the later-created one, consistently), or state that behavior is undefined and callers must not rely on it.
2. **Consider a `mapping_id`/`execution_id` alternative targeting param**, mirroring the v1 result-create capability, so a caller can disambiguate duplicate mappings the way `bulk_update_test_run_test_cases`'s own duplicate-creation bug now makes necessary in this exact run.
3. **No fix needed for truthfulness** — the response does match its declared schema and did not misreport what happened to the row it touched. This is a coverage/documentation gap, not a fabricated-success bug.
