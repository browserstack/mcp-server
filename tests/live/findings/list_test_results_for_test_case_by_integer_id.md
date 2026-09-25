# list_test_results_for_test_case_by_integer_id — DRIFT

- **Product / entity:** tm / `result` (read, v1)
- **Environment:** preprod
- **Probed:** 2026-09-21, against the pool's one rich subject — PR-2005 / TR-9062 / TC-54458 (integer 1975349), which carries 14 recorded results
- **Run file:** `tests/live/runs/tm/list_test_results_for_test_case_by_integer_id.json`
- **Related:** `findings/list_test_results_for_test_case.md` (the v2 sibling this probe was asked to compare against)

## Summary

Invoked clean on the first attempt — no retries needed. The envelope and pagination are exactly as declared, and the count-vs-rows question (open elsewhere in the campaign with only 5 hits) checks out perfectly here: `info.count` is 14, `len(test-results)` is 14, exact match, no paging required. Two real drifts and two undeclared fields turned up in the item shape.

## Drift 1 — `configuration_id` is declared but never emitted

The item schema declares `configuration_id` as a nullable integer (example `16`). Across all 14 rows, the key is **entirely absent** — not present-and-null, just missing. This differs from the v2 sibling, which emits `configuration_id: null` explicitly for the same kind of unconfigured row. Same semantic gap (no configuration on this run/case), different wire behavior between the two endpoints.

## Drift 2 — `custom_fields` type mismatch, shared with v2's (already-patched) defect

Schema declares `custom_fields` as type `object`; the response is `[]`, an empty array, on all 14 items. This is the same underlying API behavior the v2 finding flagged (`findings/list_test_results_for_test_case.md`, Drift 2) — but v2's index entry has since been corrected to declare `custom_fields` as an array. **v1's declaration was not corrected along with it** and still says `object`. Recommend the same fix applied here: either declare `custom_fields` as an array (matching v2's now-accurate docs) or treat the array-instead-of-object shape as a genuine API defect worth raising to the product team, applied consistently across both endpoints.

## Undeclared — `updated_by` and `info.truncated`

`updated_by` (a full user object, identical shape to `author`) is present on every one of the 14 rows and is not mentioned anywhere in the declared item schema. `info.truncated: false` is present on the pagination object; the declared `info` schema only requires `page`/`page_size`/`count`/`prev`/`next` and does not mention `truncated`.

## Not shared with v2 — `result_status` is fully populated here

This is the headline comparison the probe was asked to make. v2's `result_status` is deliberately cut down to `{field_value}` alone (confirmed by re-reading v2's live contract, which now explicitly documents this). **v1 does not share that defect.** All 14 rows here carry the complete declared object — `id`, `field_value`, `internal_name`, `field_name`, `colour` — plus the optional `value_category`. This is a genuine, confirmed **serializer difference between the two endpoints for the same underlying result rows**, not an inconsistency within either one. A caller that needs `internal_name` (the lowercase machine token) or `id`/`colour` must go to v1 — v2 cannot supply them, by design and as documented.

## The near-duplicate question

`list_test_results_for_test_case_by_integer_id` (v1) and `list_test_results_for_test_case` are semantically near-identical — same entity, same case-in-run scoping — and a routing eval treated them as a genuine tie because neither is marked preferred or deprecated in the index. Reading both contracts directly:

| | v1 | v2 |
|---|---|---|
| **id form** | `project_id` bare integer, `test_case_id` bare integer (internal id), `test_run_id` bare integer or `TR-`-prefixed | `PR-NNN` / `TR-NNN` / `TC-NNN` identifier strings only; bare integers 404 or fail to resolve |
| **envelope** | `test-results` (hyphen), plus top-level `unique_issues` | `test_results` (underscore), no `unique_issues` |
| **row fields** | heavier: full `author` object, undeclared `updated_by` object, `backtrace`, `attachments[]`, `links`, full `result_status`, `test_run_step_result` | narrower: `created_by` as a plain email string, no `attachments`/`backtrace`/`links`, cut-down `result_status`, but adds `test_case_id`/`test_run_id` echoed as identifiers, `execution_id`, `dataset[]`, `urls` |
| **configuration_id** | declared, but the key is never emitted (declared_missing) | emitted explicitly as `null` |
| **paging** | fixed page size of 30, only `p` is caller-controllable | `page_size`/`count` (alias, wins if both sent), restricted to exactly 30 or 300 |
| **preferred/deprecated** | not marked | not marked |

Neither capability carries a preference or deprecation marker in its metadata. The tie a routing eval hit is real — the index gives no steer — and the actual differentiator is id-form and row-richness, not recency: v1 suits a caller with numeric ids who wants the full status vocabulary and author/attachment detail; v2 suits a caller working in `PR-`/`TR-`/`TC-` identifier form who only needs the display-case status and doesn't mind the narrower row.

## Index actions proposed

1. Fix `custom_fields` on this (v1) capability's schema the same way it was fixed on v2 — declare it as an array, or raise the array-instead-of-object behavior to the product team as a genuine API defect (recommend doing this consistently for both endpoints rather than patching v2 alone).
2. Either stop declaring `configuration_id` here, or confirm with the product team why it's never emitted (unlike v2, which emits it as null for the same kind of row).
3. Add `updated_by` to the declared item schema — it appears on every row.
4. Add `truncated` to the declared `info` schema.
5. Consider an explicit preferred/deprecated (or "prefer v2 for identifier-based callers, v1 for full status detail") note on one or both capabilities to resolve the routing tie.
