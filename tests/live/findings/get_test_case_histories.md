# get_test_case_histories — DRIFT (low severity)

- **Product / entity:** tm / `version` (read)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — **two** cases: `TC-54458` (heavily edited) and `TC-54455` (untouched)
- **Run file:** `tests/live/runs/tm/get_test_case_histories.json`

## Summary

**This is the best-behaved capability in the whole suite.** Its declared contract matches reality on every axis checked — field presence and types, sort order, conditional enrichment, pagination — against two cases with deliberately different histories. The only defect is a single undeclared field.

## The drift

Every row in `history[]` carries an undeclared **`origin_channel`** (value `"api"`). It appears in neither the nested per-item schema nor the flat `returns` array. No declared field was ever missing.

Low severity — but it is real, and under this suite's rule a non-empty `undeclared_returned` is DRIFT regardless of severity.

## What it got right — worth recording, because almost nothing else has

Checked against two contrasting subjects:

- **Field presence and types** matched exactly on both cases.
- **Newest-first sort order** as declared.
- **Conditional enrichment behaved as documented**: the `modified` map appears only on the newest row per page, and a `create`-sourced row correctly carries no diff.
- **Pagination metadata** (`info.page/page_size/count/prev/next`) all present and correct.
- **An untouched case yields a creation-only trail**, not an empty one — `TC-54455` has exactly 1 entry. That is the right behaviour and it was verified rather than assumed.

## It independently corroborated this suite's own record

`TC-54458` returned **5 history entries**, and they match, event for event, what earlier batches actually did to that case:

| version | recorded | matches |
| --- | --- | --- |
| V1 create | baseline name, `description: null`, priority Medium, tags `[mcp-probe]` | the `create_test_case` probe (batch 5) |
| V2 update | `modified_fields: ["folder"]`, 764138 → 764828 | the `move_test_case` probe |
| V3 update | 5 fields: description, priority, name, step result, tags | the `update_test_case` probe's edit |
| V4 update | `modified_fields: ["description"]` — restored | that probe's description restore |
| V5 update | remaining 4 fields restored | that probe's full restore |

This is a useful cross-check on the suite itself: an independent capability confirms that the writes earlier batches *reported* making are the writes that actually landed. Given that batch 6 found four `test_run` write capabilities misreporting their own effects, having a second source agree with our record is reassuring.

One fixture-narrative nuance, correctly identified rather than reported as a gap: the "clear description to null, then restore" sequence collapses into a **single** V4 event, because the case's original description was *already* `null`. Not a missing history entry.

## It scoped batch 6's most serious finding

Batch 6 found `TR-9062`'s stored `updated_at` **frozen at creation time** despite multiple verified-successful writes — the API not persisting a modification time at all. The open question was whether that was product-wide.

**It is not.** On the `test_case` side, `TC-54458`'s history `created_at` values are strictly increasing, real, and **byte-identical across three endpoints** (this v2 listing, `list_test_case_histories`, and `get_test_case_history` for the same rows). Change-tracking works correctly here.

So the modification-time bug is **specific to `test_run`**. Recorded in `findings/test-run-writes-untrustworthy-systemic.md`.

## A guidance gap worth noting

This capability's **v2 enrichment only covers the newest row per page**. To obtain full old/new diffs for older revisions (V3, V4), the probe had to fall back to the **v1** endpoints — because **there is no v2 single-revision-read capability**, despite this capability's own guidance implying one exists.

That is a guidance-vs-reality mismatch of the kind this batch was told to watch for: the schema is fine, the prose points at something that is not there. Minor, but it would send an agent looking for a capability it cannot find, and the working route (drop to v1, with integer ids) is undocumented here.

## Index actions proposed

1. **Declare `origin_channel`** on the history item schema.
2. **Correct the guidance** that implies a v2 single-revision read exists — either point callers at the v1 endpoints explicitly, or add the v2 capability.
3. Otherwise **leave this contract alone.** It is the closest thing in this suite to a correct one, and it is worth using as the reference model for what the others should look like.
