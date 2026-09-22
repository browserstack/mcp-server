# `resolve_duplicate_v1`: cannot be exercised — dedupe has never run for the only pool project

## Verdict: UNVERIFIED (prerequisite unavailable, not a payload or index defect)

`resolve_duplicate_v1` is a `write`-mode capability on project 379335744 (PR-2005), live
preprod. Its declared contract (via `describeCapability`) is internally consistent and
detailed — required `project_id` path param, `duplicate_id`/`merge_action` in the body,
conditional `source_testcase_id`+`target_testcase_id` (merge) or `archive_testcase_id`
(archive), a bare `{success:true}` 200, and documented 400/401/403/404/409/422/500 paths.
None of that could be exercised on its success path, because **no duplicate pair exists in
this project in any state** — not "already resolved," but never generated.

## The blocker, corroborated by three independent reads

- `get_dedupe_status_v1` (probed separately, `tests/live/runs/tm/get_dedupe_status_v1.json`,
  verdict PASS) returns `{status:'NOT_ENABLED', message:'No dedupe job found for this
  project'}` for project 379335744 — a synthesised status meaning no scan job row has ever
  existed for this project, not "ran and found nothing."
- `list_duplicates_v1`, invoked independently both by this probe and by a sibling
  (`tests/live/runs/tm/list_duplicates_v1.json`, verdict UNVERIFIED), returns
  `{success:true, duplicates:[], info:{count:0,total_pages:0}}` — the same shape the
  capability's own guidance says is indistinguishable from "feature off" without the
  status read. Combined with `get_dedupe_status_v1`, the ambiguity resolves to "feature
  never ran," not "clean project."
- `get_duplicate_source_test_case_v1` (sibling probe,
  `tests/live/runs/tm/get_duplicate_source_test_case_v1.json`, verdict UNVERIFIED) hit the
  identical wall from the other side: it needs a `merged` pair, found none, and could not
  manufacture one without exactly the write this probe covers.
- This probe adds the missing middle piece: **`resolve_duplicate_v1` cannot be the write
  that unblocks the source-snapshot read here**, because there is no `suggested` pair to
  resolve either. All three reads and this write trace back to the same root cause: the
  dedupe pipeline has never been triggered for project 379335744, and — per
  `list_duplicates_v1`'s own guidance — "there is no way to create a suggestion or trigger
  a scan through this API." Nothing reachable through `invokeCapability` can produce a
  duplicate pair from scratch.

One diagnostic call was made: `resolve_duplicate_v1` with a deliberately out-of-range
`duplicate_id` (999999999, `merge_action:'archive'`, `archive_testcase_id:1985018`, a
probe-created case) to confirm the pair-lookup-first error path without any risk to a real
case. It returned exactly the declared shape: `404 {"errors":"Duplicate not found."}`
(plural key, matching the description precisely). That single corner of the contract checks
out; the 200 success path, the 409 migration-pause path, the 422
"Test case not found in duplicates" path, and the 403 `tc_delete`-permission path all remain
unverified.

## Destructive-in-effect, flagged but NOT independently confirmed

`describeCapability`'s own guidance for `resolve_duplicate_v1` states that `merge_action:
'merge'` archives `source_testcase_id` (tagged `'Archived as Duplicate'`, comment posted on
the survivor, source snapshotted) and `merge_action:'archive'` archives
`archive_testcase_id` outright — in both cases removing a test case from active
folders/listings as a side effect of a capability classed `write`, **not** `destructive`.
If accurate, this is the same pattern already confirmed and cleared for
`unlink_test_runs_from_test_plan`: a non-destructive-classed write with a destructive-shaped
effect, routing straight around the runtime gate that blocks the whole `destructive` tier
outright (see `tests/live/findings/destructive-tier-unreachable.md`). **This could not be
verified by observation** — no invocation here reached the success path, so there is no
live evidence the archive actually happens as described. This is reported as an open
question for the product/index team to confirm, not a verified finding: the next time a
project with dedupe enabled and a real, probe-owned `suggested` pair is available, resolve
one pair and read back **both** test cases afterward (never trust the write response, which
the contract itself says is just `{success:true}` with nothing about the affected cases) to
settle it.

## `resolve_duplicate_v1` vs `discard_duplicate_v1`

- **Path shape**: resolve takes `duplicate_id` in the **body**, posting to the collection
  path; discard takes `duplicate_id` as a **path segment**, on a distinct route.
- **Effect**: discard is the "not a duplicate" verdict — touches neither test case, just
  moves the pair to a terminal `discarded` status (one-way, no un-discard). Resolve is the
  "act on it" verdict — always ends with the pair `merged` regardless of whether
  `merge_action` was `'merge'` or `'archive'` (the same field name covers both, and even the
  "archive" branch sets the pair's terminal status to `merged`, not to a separate
  `archived` pair-state — a naming overload worth flagging on its own).
- **Permission**: resolve needs the heavier `tc_delete`; discard needs only `tc_write`.
- **Error envelope**: resolve's 404 uses `errors` (plural, confirmed above); discard's 404
  uses `error` (singular) — one more instance of the error-envelope inconsistency already
  tracked across this surface (3 of 11 declared shapes correct, per the campaign's running
  count).

## What remains untested

Everything on the success path, the 409 migration-pause path, the 422 wrong-test-case-id
path (both the `merge` and `archive` body variants, which the contract says return
differently-shaped 422s), and the 403 permission path. All require a real `suggested` pair
owned by probe-created cases, which this environment cannot produce. No pair involving
`__readonly__` 764093, TC-54455, TC-54456, or TC-54458 (1975349) should ever be used to
close this gap, per this campaign's standing rule.
