# Objects created by phase-1 write probing — 2026-09-21

Project **379335744 / PR-2005** (`__mcp-capability-fixture__`), preprod.
Everything here was created by a probe and is safe to remove **except where noted**.

| object | id | created by | removable? |
| --- | --- | --- | --- |
| folder `__mcp-probe-createrootfolder-20260921` | 765811 | `create_root_folder_v1` | yes — `delete_folder_and_contents` (still to be probed) |
| configuration `__mcp-probe-config-20260921` | 5189868 | `create_configuration_v1` | **NO API PATH — UI only** |

## The configuration one is not cleanable, and that is the finding

`create_configuration_v1` is reached through a project but writes **group-scoped**. Confirmed
two ways: the new row carries `group_id: 3452`, the same as every existing configuration, and
a follow-up `get_configurations_v1` against PR-2005 shows the pool going **244 → 245**.

So a call made through *any* project in group 3452 adds an entry that **every other project in
that group reads from**. Duplicate names are not rejected, so a naive retry-on-failure
multiplies entries in a shared pool.

And the profile ships **no delete and no rename capability for configurations**, so an agent
that creates one cannot undo it. Removal requires the Test Management UI.

That combination — project-shaped entry point, group-wide effect, no reversal — is worth
raising on its own, separately from any contract drift.

## Added during wave 1

| object | id | created by | removable? |
| --- | --- | --- | --- |
| test run `__mcp-probe-createrun-20260921` | TR-9110 / uuid 17577900 | `create_test_run_v1` | yes — `delete_v1_test_run` (still to be probed) |
| test case `__mcp-probe-createcase-20260921` | TC-54484 / int 1985018 | `create_test_case_v1` | yes — `bulk_delete_test_cases` (still to be probed) |
| dataset `__mcp-probe-dataset-20260921` | uuid de04f15e-b88a-4409-8b9d-eeff038c3109 | `create_dataset` | yes — `delete_dataset` (still to be probed) |

`create_test_plan_v1` created nothing — it 500s. Verified: the project still shows 29 active plans.

Most of these are deliberately being left in place: the destructive probes still to run need
real objects to destroy, and these are exactly the right ones to use.

| custom field `__mcp-probe-cfdef-20260921` | 106131 (+ dataset 31319) | `create_custom_field_definition_v2` | **delete refused by the invoke runtime** |
| exploratory session `__mcp-probe-exploratory-20260921` | **779** (ES-14) | `create_exploratory_session` | yes — `delete_exploratory_session` (still to be probed) |

Session **779** is the prerequisite for six other capabilities. Use the **integer 779**, not
`ES-14` — the identifier 404s on routing. Run `close_exploratory_session` **last**: whether
closing locks later edits is unverified, and getting that order wrong strands the rest.
| shared step `__mcp-probe-sharedstep-20260921` | 27846 | `create_shared_step_v1` | yes — `delete_shared_step_v1` (still to be probed) |

Note for later probes: **shared-step folders are a separate id namespace** from test-case
folders. Passing `__scratch__` 764138 as a shared-step `folder_id` returns 400 "Target folder
not found". Shared step 27846 was therefore left at root.
| exploratory session `__mcp-probe-exploratory-clone-20260921` | **780** (ES-15) | `clone_exploratory_session_v1`, cloned from source **779** | yes — `delete_exploratory_session` (still to be probed) |

Session **780** is a synchronous clone of source **779** (source had `session_log_count=2` at
clone time, well under the 50-log async threshold). Its 2 logs and its description were copied;
charter/tags/issues/owner were not (source had none of those to copy either, so that's untested
rather than confirmed). Source **779** was re-read but left untouched — not closed, not modified.
Use the **integer 780**, not `ES-15`.
| filter `__mcp-probe-filter-20260921` | 542 | `create_filter` | yes — `delete_filter` (still to be probed) |
| dataset `__mcp-probe-cfdataset-20260921` | 31320 (options 146668/146669), hung off custom field 106131 | `create_custom_field_dataset_v2` | **delete refused by the invoke runtime** — `delete_custom_field_dataset_v2` exists and is well-specified, but its mode is `destructive`, so invokeCapability refused it outright (verbatim: "delete_custom_field_dataset_v2 is a destructive operation and is not available through this surface"). Same non-cleanable pattern as field 106131 itself. Dataset 31320 has no projects linked (created deliberately unlinked to avoid the "project already on another dataset of this field" conflict with dataset 31319, which already owns PR-2005/379335744) — it is invisible in every project but exists and is reusable as the dataset id for probing `update_custom_field_dataset_project_mapping_v2`.
| exploratory logs 543 (for delete probe) + 544 (for update probe) | 543, 544 | `create_exploratory_session_log` | yes — `delete_exploratory_session_log` |
| exploratory clone `__mcp-probe-exploratory-clone-20260921` | 780 (ES-15) | `clone_exploratory_session_v1` | yes — `delete_exploratory_session` |
| report `__mcp-probe-report-20260921` | 10393 / SC-492 | `create_report` | **no delete-report capability in this profile** |
| project `__mcp-probe-project-20260921` | **379339429 / PR-2011** | `create_project_v1` | **NO API PATH — UI only** |

`create_project_v1` is the second and worse instance of the no-cleanup pattern. A
`searchCapability(entity=project, mode=destructive)` over the whole tm profile returns **zero
matches**, so an agent can create a top-level project visible to the entire group and has no
way to remove it. The configuration case at least only pollutes a shared pool; this leaves an
orphaned project.
| subfolder `__mcp-probe-subfolder-20260921` | 765817 (parent 765811) | `create_sub_folder_v1` | delete refused at runtime |
| test plan `__mcp-probe-planclone-20260921` | 48319 / TP-1632 | `clone_test_plan_v1` | delete refused at runtime |
| test run TR-9111 | created as a side effect of the plan clone | `clone_test_plan_v1` | delete refused at runtime |
| custom-field dataset (2nd) | 31320, options 146668/146669 | `create_custom_field_dataset_v2` | delete refused at runtime |
| project settings on PR-2011 | `tc_sharing`, `preferred_jira_host` | `update_project_settings` | PR-2011 is throwaway |
| custom-field dataset option `__mcp-probe-cfoption-20260921` | 146670, dataset 31320, custom field 106131 | `create_custom_field_dataset_option_v2` | yes — `delete_custom_field_dataset_option_v2` exists (mode `destructive`, would be refused by the invoke runtime like every other destructive call so far) |

**Side effect on a pre-existing object**: creating option 146670 with `is_default:true` silently flipped option **146668**'s (`__mcp-probe-cfdataset-20260921-A`) `is_default` from `true` to `false` and bumped its `updated_at` — the previous default was auto-demoted, not left as a second default and not rejected. 146668 was not deleted or renamed, only its `is_default`/`updated_at` changed, so no separate cleanup entry is needed for it, but note it if re-reading dataset 31320's defaults later.

## Outage residue — verified live 2026-09-22, NOT what the probes reported

During the preprod outage two probes reported "nothing was written". **Both were wrong.**
A live read of the folder tree shows:

| object | id | what actually happened |
| --- | --- | --- |
| TC-54487 `__mcp-probe-bulkcase-20260921-3` | 1985021 | **moved** 764138 → 765811 by `bulk_move_test_cases`, which succeeded |
| TC-54490 `__mcp-probe-createcases-20260921-1` | 1985025 | copy of TC-54489 in 765811 |
| TC-54491 `__mcp-probe-createcases-20260921-1` | 1985026 | **second** copy of TC-54489 in 765811 |

`bulk_copy_test_cases` therefore committed **twice** while its agent recorded `status: 0`
transport failures on every attempt. The write reached the server and the response never came
back. That is a timeout-after-commit, an outage artifact rather than a contract defect — but it
is the reason a probe's own account of what it did is never sufficient. State gets verified.

Neither capability has a usable run file: the contract diffs and the partial-failure
experiments were never reached. Both need re-running, now against this corrected state.
| tags `__mcp-probe-mergetag-20260922-a` / `-b` | 541125, 541126 | `merge_tags_v1` (unmerged) | both live on TC-54486 |
| test case TC-54502 (copy of TC-54489) | 1985215, in folder 765817 | `bulk_copy_test_cases` | delete refused at runtime |
| test plan TP-1632 left renamed `__mcp-probe-planclone-20260921-updated` | 48319 | `update_test_plan_v1` | disposable probe plan |

## `update_custom_field_dataset_project_mapping_v2` probe (2026-09-22) — dataset mappings now stable

Custom field 106131's two datasets are back to their intended, non-conflicting state:

| dataset | linked project(s) | link_to_future_projects |
| --- | --- | --- |
| 31319 | PR-2005 / 379335744 (restored) | false |
| 31320 | PR-2011 / 379339429 (new, legitimate) | false |

**What happened along the way**: the deliberate negative test (mapping 31320 to PR-2005, which
31319 already owned) did **not** produce the documented masked-400 — it returned a clean 200 and
silently **stole** PR-2005 away from 31319 (31319's `linked_project_count` dropped to 0 with no
error surfaced anywhere). This was then used as a free PUT-vs-PATCH test: linking 31320 to PR-2011
*without* unlinking the just-stolen PR-2005 left **both** projects on 31320
(`linked_project_count` 1→2) — confirming `link_projects`/`unlink_projects` are genuinely additive
deltas, unlike `edit_test_run.test_case_ids`. PR-2005 was then explicitly unlinked from 31320 and
relinked to 31319, restoring both datasets to a clean, correct, non-overlapping state — verified
live by `get_custom_field_dataset_v2` reads on both dataset ids after the corrective calls, not
inferred from write responses. See `tests/live/runs/tm/update_custom_field_dataset_project_mapping_v2.json`
for full detail.

## `edit_test_run` probe (2026-09-22) — TR-9110 now holds 5 cases, renamed

**Baseline verified clean first**: TR-9110 held exactly 3 cases (TC-54455/56/58) and owner 3741 before
any call in this probe — the run genuinely had no prior write, unlike the two outage-era probes
above.

`test_case_ids` on `edit_test_run` turned out to **replace**, not add to, the run's case list (see
`tests/live/findings/edit_test_run.md`, Finding 1) — a first call sending only the two new case ids
silently detached TC-54455/56/58. They were recovered by resending all 5 ids in one call. Net
result, now stable:

| object | change |
| --- | --- |
| test run TR-9110 (17577900) | now holds **5** cases: TC-54455, TC-54456, TC-54458, TC-54485, TC-54486. `mapping_id` for the two newly-added cases: **TC-54485 -> 2150424052**, **TC-54486 -> 2150424053**. TC-54455/56/58 were re-attached with **new** mapping_ids (2150424057 / 2150424056 / 2150424058 respectively) — their original mappings (2150421282/2150421284/2150421283) no longer exist. |
| test run TR-9110 name | changed to `__mcp-probe-createrun-20260921-name-edit-probe` (deliberate, part of a requested PATCH-vs-PUT test) |
| test run TR-9110 owner | ended at **3741** (restored — the same edit calls twice silently cleared it to null along the way; see Finding 2 in the findings doc) |
| TR-9110 run_state / active_state | unchanged: `new_run` / `active` — never closed |

TR-9075, TR-9061, TR-9062 (the 14-result evidence run) and TR-9111 were never referenced by any
call in this probe.

## `update_custom_field_dataset_option_v2` probe (2026-09-22) — dataset 31320's default moved again

Baseline verified first: 146670 was the live default (from the earlier create-sibling probe demoting
146668), 146669/146668 both `is_default:false`.

Called with `option_id:146669`, `option_value` unchanged, `is_default:true`. Read dataset 31320 back
afterward (not the write response): 146669 is now `is_default:true` as sent, but **146670 was
silently flipped to `is_default:false`** and its `updated_at` bumped to the same timestamp as this
call — a side effect on an object never named in the request, exactly mirroring the create-path
side effect on 146668 above. 146668 itself was untouched (still `false`, `updated_at` unchanged).

This directly contradicts the capability's own declared guidance ("does not clear the previous
default"). See `tests/live/runs/tm/update_custom_field_dataset_option_v2.json` for the full
before/after and contract detail — verdict `DRIFT` (guidance-vs-behavior, not schema-shape).

| object | change |
| --- | --- |
| custom-field dataset option 146669 (dataset 31320) | `is_default` flipped `false` → `true` (intended) |
| custom-field dataset option 146670 (dataset 31320) | `is_default` silently flipped `true` → `false`, `updated_at` bumped — side effect, not deleted or renamed |

Dataset 31320's live default is now **146669**. No new object created; nothing here needs cleanup
beyond what's already noted for this dataset (delete capability is `destructive` and refused at
runtime, same as before).

## `copy_folder` probe (2026-09-22) — folder 765811 found renamed again, one new folder + two new cases

Baseline note: folder 765811 was found already renamed to `__mcp-probe-renamefolder-20260922`
(a further rename since the outage-residue section above) — a concurrent probe touched it again,
as the task warned might happen. Structure otherwise as expected (1 subfolder: 765817).

Copied folder 765817 (`__mcp-probe-subfolder-20260921`) into its own parent 765811. Queued
(202, `async:true`) but completed within seconds.

| object | id | created by | removable? |
| --- | --- | --- | --- |
| folder `copy-of-__mcp-probe-subfolder-20260921` | 765883 (parent 765811) | `copy_folder` | delete refused at runtime (same pattern as every other folder create) |
| test case TC-54503 (copy of TC-54502) | 1985216, in folder 765883 | `copy_folder` | delete refused at runtime |
| test case TC-54504 (copy of TC-54487) | 1985217, in folder 765883 | `copy_folder` | delete refused at runtime |

**Could not test the option-id silent-rewrite bug via this folder**: TC-54502, the only case in
765817 with non-null case_type/status, already carries the project's lower/default block
(318591/318599/318605) — it's itself a prior copy. Its copy TC-54503 came out identical, which is
NOT proof of correct preservation (source and default were already the same value). No case with
upper-block ids (318618/318626/318632) exists anywhere under 765817 to test this properly.

Failure experiment (nonexistent `destination_folder_id: 999999999`): bare 404
`{"error":"Source or destination folder not found"}`, no `success` key — a fourth distinct
bad-id behavior alongside the 400s (`bulk_move_test_cases`/`bulk_copy_test_cases`) and the
silent-discard 200 (`create_bulk_test_cases_v1`). Verified nothing was created.

See `tests/live/runs/tm/copy_folder.json` for full detail — verdict `DRIFT` (unique_id declared
`format:uuid` but returned as 32 hex chars with no dashes; otherwise contract matches).

## `update_latest_test_result_for_test_case` probe (2026-09-22) — new result row on TC-54486

| object | id | created by | removable? |
| --- | --- | --- | --- |
| test result (status Blocked) on TC-54486 in TR-9110, mapping_id 2150424053 | 2150424064 | `create_test_result_for_test_case` (setup, since TC-54486 had never been executed in this run) | yes — `delete_test_result_v1` (not probed here) |

Created only as the prerequisite `update_latest_test_result_for_test_case` needs (it edits, never
creates, a result). The target capability then 404'd `{"success":false,"message":"No test results
found"}` on all 3 attempts despite this row being confirmed live and queryable — verdict `BLOCKED`.
See `tests/live/runs/tm/update_latest_test_result_for_test_case.json` for full detail. TC-54458
(1975349), TR-9062, and TC-54485/mapping 2150424052 were never referenced by this probe.

## `bulk_retrieve_test_cases` probe (2026-09-22) — net no-op, but flags a stale fixture premise

**Task premise did not hold**: TC-54464/65/66/67 (1983896-1983899) were expected to already be
archived/binned from an earlier campaign. Live checks showed all four were plain Active cases in
folder 764138 — neither `get_archived_test_cases` nor `list_binned_test_cases_v1` listed them. If
another probe reuses these four ids assuming a pre-archived/binned state, verify first; that state
no longer exists (if it ever did in this workspace).

To actually exercise the capability, this probe archived the four itself (`bulk_archive_test_cases_by_project`),
confirmed the archive with a read, then restored them with `bulk_retrieve_test_cases`. End state is
**identical to the start state**: all four back to Active in folder 764138 with unchanged option ids
(case_type 318599 / priority 318591 / status 318605) — no new object created, nothing left to clean up.

One new failure mode recorded for the "five bulk routes, three behaviours" tally: a selection of 4
valid archived ids + 1 nonexistent id returned a bare, undeclared `404 {"success":false}` and
restored **nothing** (all-or-nothing on a bad id) — different from the empty-selection 400 already
documented for this route. See `tests/live/runs/tm/bulk_retrieve_test_cases.json` — verdict `DRIFT`
(undeclared 404 status; the flat vs `test_case`-nested body shape mismatch already seen on
`bulk_copy_test_cases`/`bulk_archive_test_cases_by_project` applies here too).

## `clone_test_run` probe (2026-09-22) — TR-9110 cloned to TR-9120; results confirmed NOT copied

| object | id | created by | removable? |
| --- | --- | --- | --- |
| test run `__mcp-probe-runclone-20260922` | TR-9120 / uuid 17578918 | `clone_test_run`, cloned from source TR-9110 | yes — `delete_v1_test_run` (still to be probed) |

Cloned with `copy_all_cases:true, copy_tags:true, copy_tc_assignee:true, copy_issues:true`. TR-9120
holds the same 5 cases as TR-9110 (TC-54455/56/58/85/86) but **all reset to untested** — confirmed by
independent reads (`get_test_runs_v1`, `get_test_cases_for_v1_test_run`), not the clone's own inline
response, which under-reported its own result as `test_cases_count:0` / all-zero progress moments
after the 5 cases were already live (same defect family as `clone_exploratory_session_v1`). TC-54485's
Passed and TC-54486's Blocked results did **not** carry across — correct, desired behavior for a fresh
re-execution run. Owner, tags and configurations were untestable (source had none to copy either way).
`clone_test_run`'s own write response gets `project_id`/`is_dynamic`/`overall_progress` right (string /
boolean / real object), matching `create_test_run_v1`; a `get_test_runs_v1` re-read of the same new run
gets all three wrong again (integer, integer, **null** — not even a zeroed object). See
`tests/live/runs/tm/clone_test_run.json` — verdict `DRIFT` (stale inline response; `created_by` /
`observability_url` / `type` / `self_ui_link` declared, none returned).

**TR-9110 found further drifted from its own documented baseline, not by this probe**: this probe made
exactly one write call (the clone itself, which cannot touch the source per its own contract), yet a
post-clone read of TR-9110 shows TC-54485 now appearing **twice** at brand-new mapping_ids 2150424076/
2150424077 (both Passed, created ~45s after this probe's clone call), superseding the 2150424062 cited
in earlier docs, and owner reading **null** instead of the 3741 recorded as restored in the
`edit_test_run` section above. TC-54486's mapping_id (2150424064, Blocked) and the run's aggregate
counts (5 cases, 1 passed/1 blocked/3 untested) are unchanged. Attributed to another probe writing to
TR-9110 concurrently in this shared fixture, not to `clone_test_run`. Anyone probing TR-9110 next
should re-baseline it live rather than trusting the numbers recorded above.

## TR-9110 must be re-baselined live before further use

The `clone_test_run` probe flagged that TR-9110 had drifted from this ledger's recorded state.
It is explained, not mysterious:

- TC-54485 now appears **twice**, at mapping ids **2150424076 / 2150424077**, and the previously
  recorded 2150424062 is gone. That is `create_step_result_v1`, which persisted **two** case-level
  result rows from a single call.
- `owner` reads **null** where this ledger recorded 3741 as restored. `edit_test_run` clears
  `owner` on any edit that omits it, which is the documented cause.

Aggregate counts are still correct (5 cases, 1 passed / 1 blocked / 3 untested). But
**`mapping_id` is not stable** — it shifts to the latest result's id after a write — so any
probe touching TR-9110 must resolve ids live immediately before use and must not trust the
values recorded here.

## `bulk_edit_test_cases_in_test_run` probe (2026-09-22) — wrote to TR-9120, not TR-9110

Resolved TR-9120's mapping_ids live first (all 5 rows untested, as the task expected): TC-54486
`2150424070`, TC-54485 `2150424068`, TC-54458 `2150424069`, TC-54456 `2150424067`, TC-54455
`2150424066`.

Two writes made, both to TR-9120 only:

| row | mapping_id sent | new status | new mapping_id |
| --- | --- | --- | --- |
| TC-54485 (1985019) | 2150424068 | Blocked (318612) | 2150424086 |
| TC-54486 (1985020) | 2150424070 | Blocked (318612) | 2150424087 |
| TC-54456 (1971632) | 2150424067 | Failed (318611) | 2150424089 |

The second write also included a fabricated `mapping_id` (999999999) alongside TC-54456's real one,
to test partial-failure behavior — silently ignored, no signal, no new row created. TR-9120's row
count stayed at 5 after both writes (no duplicate-row bug on this capability). TC-54458's row in
TR-9120 was deliberately left untouched. TR-9110, TR-9062, TR-9061 and TR-9075 were never
referenced. See `tests/live/runs/tm/bulk_edit_test_cases_in_test_run.json` and
`tests/live/findings/bulk_edit_test_cases_in_test_run.md` — verdict `DRIFT` (declared response
item shape is contradicted by the actual wide listing shape returned; status_id 318612 read back
as 318639 by a sibling reader on the identical result row; silent partial failure with a bad
mapping_id).

## `close_test_run_v1` probe (2026-09-22) — TR-9111 closed, first closed run in this project

Closed TR-9111 (uuid 17578623) as instructed — the orphaned run left over from the earlier
`clone_test_plan_v1` side effect, unlinked from its plan, holding 1 case. TR-9110, TR-9120,
TR-9075, TR-9061 and TR-9062 were never referenced by this probe.

| object | change |
| --- | --- |
| test run TR-9111 (17578623) | `run_state`/`active_state` → `closed`/`closed`; `closed_at` `2026-09-22T05:43:15.505Z`, `closed_by` user 2522 (confirmed by read-back, not the write response — see below) |
| test run TR-9111 name | changed again to `...- closed-run edit probe` by a deliberate post-close `edit_test_run` lock test (see below) |

Before this probe, project-wide `get_test_runs_v1` `count` had read `{active: 33, closed: 0}` on
every check across the whole campaign. After closing: `{active: 32, closed: 1}` — verified against
actual rows (TR-9111 dropped off the active listing), not just the count object. `get_closed_test_runs`,
`get_closed_test_runs_info_v1` and `get_closed_test_runs_split_v1` all now return real, non-empty
data for the first time — see `tests/live/findings/close_test_run_v1.md` for the shapes.

**Closing does not lock the run.** A follow-up `edit_test_run` (rename only, resending the
mandatory `run_state:closed`) returned 200 and the rename genuinely persisted — confirmed by a
read-back, not the no-op-under-200 pattern this campaign has caught elsewhere. Owner was already
null on TR-9111 before this edit, so no owner-clearing side effect applies here.

**Self-misreporting on the close's own response**: `close_test_run_v1`'s 200 returned
`uuid: 359844` (wrong — TR-9111's real uuid is 17578623, confirmed both before and after closing)
and `closed_by: null` (wrong — a read-back immediately after shows it fully populated). Same
family of defect as `clone_test_run`'s stale `test_cases_count`. See
`tests/live/runs/tm/close_test_run_v1.json` and `tests/live/findings/close_test_run_v1.md` —
verdict `DRIFT`.

## Production residue — 2026-09-22 (review-workflow probe)

Created in **production** `Demo Project 1` (332537), folder 9697326 "MCP Testing", to probe the
two review-workflow capabilities that preprod cannot exercise (feature off there).

| id | identifier | name | state |
| --- | --- | --- | --- |
| 138758377 | TC-6272345 | `__mcp-probe-prod-review-20260922-170927` | left in `in_review` |

Deliberately created rather than reusing the three existing cases in that folder — those were
made on 2025-04-25 by someone else and are not this campaign's to modify.

Not cleanable through this surface: the destructive tier is refused at `invokeCapability` before
binding, so nothing here can delete it. Safe to delete by hand.

## Production residue — 2026-09-22 (test-plan archive probe)

Created in **production** `Demo Project 1` (332537) to exercise the archive family, which is
feature-gated off on preprod. Test plans this campaign created, never existing demo plans.

| identifier | name | state |
| --- | --- | --- |
| TP-4430 (195535) | `__mcp-probe-prod-plan-20260922-171806` | archived |
| — | `__mcp-probe-prod-plan2-*`, `-plan3-*`, `-plan4-*` | active (shape-check creates) |

Also on preprod, from the create_template_v2 shape probing: several `__mcp-probe-tmpl-*` attempts,
all of which returned 400 and created nothing.

Not cleanable through this surface (destructive tier refused before binding). Safe to delete by hand.

## Preprod residue — 2026-09-22 (send_report_email_now_v1 probe)

| id | title | why |
| --- | --- | --- |
| report 10442 | `__mcp-probe-email-report-20260922-194636` | created solely so the email probe had a report of its own to send, rather than mailing someone else's report data |

One email was sent, to the operator's own address only, with a single `pdf` attachment.
Not cleanable through this surface (the destructive tier is refused before binding).

## Production residue — 2026-09-23 (template probe, second prod credential)

Workspace-level, created while verifying `create_template_v2`:

| id | name | linked to |
| --- | --- | --- |
| 1088008 | `__mcp-probe-template-renamed-104210` (created as `__mcp-probe-template-20260923-104130-17-18`) | project 4067615 |

A workspace template is visible to anyone authoring test cases in a linked project, so unlike
the other residue in this file this one is worth removing promptly. It cannot be deleted through
this surface — `delete_template_v2` is `mode: destructive` and refused before binding.
