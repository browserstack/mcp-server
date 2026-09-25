# `edit_test_run` — `test_case_ids` replaces rather than adds; `owner` is cleared on every edit that omits it

- **Product / entity:** tm / `test_run` (write)
- **Environment:** preprod (`test-management-preprod.bsstag.com`)
- **Probed:** 2026-09-22
- **Run trace:** `tests/live/runs/tm/edit_test_run.json`
- **Related:** `tests/live/findings/test-run-writes-untrustworthy-systemic.md` (this probe reproduces that pattern on a third, v1, endpoint), `tests/live/findings/bulk_set_test_case_assignee_in_run.md` (identified `edit_test_run`'s `test_case_ids` as the real way to map cases into a run — this probe is the follow-up that tested it)

## Finding 1 — `test_case_ids` is documented additive, actually a full replace (CRITICAL, data-loss hazard)

The contract's own guidance states: *"This is additive for cases: test_case_ids and selection ADD to the run and never remove."* That is false.

Against test run **TR-9110** (uuid 17577900, project PR-2005 / 379335744), which held 3 cases (TC-54455, TC-54456, TC-54458):

| call | `test_case_ids` sent | result |
| --- | --- | --- |
| 1 | `[1985019, 1985020]` (2 new cases) | run ended up with **exactly those 2** — TC-54455/54456/54458 silently detached |
| 2 (recovery) | `[1971631, 1971632, 1975349, 1985019, 1985020]` (all 5) | run ended up with **exactly those 5** |

Both re-reads (`list_test_run_test_cases_by_integer_id`) confirm the run's case list becomes exactly the set sent — not the union of the existing set and the new ids. **This is a set/replace operation, not an add.**

The blast radius: any caller — human or agent — who reads the documented "additive" behavior and sends only the new case ids they want to add will **silently wipe every other case already in the run**. Untested cases lose their mapping outright (a fresh `mapping_id` is minted if they're re-added later — the original mapping is gone, not restored); executed cases would additionally lose their results, per the same field's own note that "taking a case out is a separate operation, and that one discards the results recorded against it" — except here it happens as a side effect of an operation documented to never remove anything.

This is exactly the trap that made `bulk_set_test_case_assignee_in_run` look like the tool for "add a case to a run" in the first place (it isn't — it only reassigns rows already present). `edit_test_run`'s own docs point an agent at the same mistake from a different direction.

**Recommendation:** fix the doc to say `test_case_ids` replaces the run's case selection, not that it's additive — or fix the API to actually merge with the existing selection as documented. Either way, an agent must currently read the run's full existing case list first and resend the union, every time.

## Finding 2 — `owner` is cleared to null by any edit that omits it (CRITICAL, product bug, reproduced twice)

Every field other than `owner` on this endpoint is documented "omit the key to leave alone" (tags, is_dynamic, configurations, metadata, attachments). `owner` behaves oppositely: **omitting it clears the run's owner**, even when nothing else about the call relates to ownership.

Reproduced twice in this probe, independently confirmed via two different read capabilities each time (`get_test_run_by_integer_id` and `get_test_run_detail`):

1. An edit sending `test_case_ids` (no `owner`) — owner went from 3741 to null.
2. After explicitly restoring `owner:3741`, an edit sending **only `run_state` and `name`** (no `owner`, no case-selection keys at all) — owner went back to null again.

Both times, owner could be restored by explicitly resending `owner:3741` in a subsequent call — but it does not survive as "current state" the way every other optional field does. **An agent must resend `owner` on every single `edit_test_run` call or the run loses its assignee**, including edits that have nothing to do with ownership (a rename, a case addition).

**Recommendation:** treat `owner` the same as every other optional field on this endpoint — omission should leave it unchanged. This is a real assignment-loss bug, not a documentation gap.

## Finding 3 — the write response itself can be stale (extends existing systemic finding to a third endpoint)

`findings/test-run-writes-untrustworthy-systemic.md` already documented that `update_test_run` and `replace_test_run` return response bodies that disagree with storage for fields the caller didn't send in that call. This probe reproduces the same failure mode on **`edit_test_run` (v1)**:

- After the owner-restore call (`body: {run_state, owner:3741}`), the response itself echoed `owner: null` and an `updated_at` identical to the prior call.
- An independent read one call later showed `owner: 3741` with a freshly-bumped `updated_at` — the write **had** applied; the response body just didn't reflect it.

Fields the caller *did* send in the same call (`name`, `test_case_ids`) came back correctly and immediately in every response observed. The staleness is specific to fields the request didn't touch — the same shape of bug already reported for the v2 routes, now confirmed on a v1 one too, widening that finding's scope.

## Finding 4 — the three-field serializer check (`project_id`, `is_dynamic`, `overall_progress`)

`create_test_run_by_integer_id`'s probe isolated `project_id`-as-integer, `is_dynamic`-as-integer, and `overall_progress`-as-null to `list_test_runs_by_integer_id`'s list serializer, concluding the write path was consistently correct. Checking the same three fields on `edit_test_run`'s response:

| field | declared | edit_test_run actual | verdict |
| --- | --- | --- | --- |
| `project_id` | string | **integer** (`379335744`) | **DRIFT** — matches the list bug |
| `is_dynamic` | boolean | boolean (`false`) | correct |
| `overall_progress` | non-null object | non-null object with real counts | correct |

Two of three are fine, but `project_id` is wrong here too. This means the earlier "one broken reader, write path is consistently right" conclusion does not fully hold: `project_id`-as-integer is shared by **both** `list_test_runs_by_integer_id` (list) and `edit_test_run` (write), while `create_test_run_by_integer_id` (a different write) gets it right. The bug looks tied to whichever serializer code path list and edit share, not to reads-vs-writes generally.

## Finding 5 — `type` / `self_ui_link` still dead; `observability_url` and `skipped_test_case_ids` are fine here (minor, contrast with create)

- `type` and `self_ui_link`: declared on this endpoint's own schema, never present in any of 4 edit responses taken. Consistent with `create_test_run_by_integer_id`'s finding — looks like a vestigial declared field across the whole `test_run` surface.
- `observability_url`: present and populated on every edit response. This is *better* than `create_test_run_by_integer_id`, where the same field is declared but always absent from the create response despite being computed and visible on an immediate read.
- Top-level `skipped_test_case_ids`: present (`[]`) on every edit response. Also better than create, where this key is declared "always added" but never actually appears.

So `edit_test_run`'s serializer keeps two promises that `create_test_run_by_integer_id`'s serializer breaks, for the same entity — the two write paths are not uniformly wrong or uniformly right; each has its own gaps.

## What this unblocks

Despite the drift, the underlying goal succeeded: TC-54485 (1985019) and TC-54486 (1985020) are now mapped into TR-9110, with `mapping_id` **2150424052** (TC-54485) and **2150424053** (TC-54486) respectively, resolved via `list_test_run_test_cases_by_integer_id`. This gives `create_test_result_for_test_case`, `create_step_result` and `update_latest_test_result_for_test_case` a probe-owned case to write results against, without using TC-54458 (the evidence case). **Any probe of those three capabilities must send the full existing case-id union if it ever calls `edit_test_run` itself, per Finding 1 — don't repeat the detachment.**

## Caveats

- Preprod only.
- No backend source consulted — all conclusions are from request/response pairs plus independent re-reads (2+ reads per claim, using at least two different read capabilities where the claim was about run-header fields).
- TR-9110's `name` was changed to `__mcp-probe-createrun-20260921-name-edit-probe` as part of the requested PATCH-vs-PUT test and left that way; it is unambiguously a probe object.
