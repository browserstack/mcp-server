# list_test_run_test_case_comments_v1 — DRIFT (a declared id form resolves to the wrong record)

- **Product / entity:** tm / `comment` (read)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — four runs, all five rows of `TR-9062`
- **Run file:** `tests/live/runs/tm/list_test_run_test_case_comments_v1.json`
- **Related:** `findings/error-envelopes-systemic.md`

## Summary

This is the capability documented as mixing id conventions in one request — an integer project id, a prefixed run identifier, and an integer case id. **The mixing itself is declared accurately.** The defect is that one of the two id forms the contract explicitly permits for `test_run_id` **resolves to a different record entirely.**

## The drift — the bare-integer `test_run_id` resolves to the wrong run

The contract declares `test_run_id` as accepting either `TR-NNN` (preferred) or the run's bare integer id, with the regex `^(TR-)?[0-9]+$`.

| form | result |
| --- | --- |
| `"TR-9062"` | **200**, empty comments — works exactly as declared |
| `17575382` (TR-9062's own verified integer id) | **400** `{"success":false,"message":"TRTC not found for given testrun_id:358823, testcase_id:1971631, mapping_id:"}` |

**The error cites `testrun_id: 358823` — an id that matches neither what was sent nor `TR-9062`.** The integer was verified correct beforehand via `get_test_run_by_integer_id_v1`.

Reproduced with a second run: `TR-9061`'s integer `17574995` produced an error citing `358621` — again unrelated, and again a different number. Two different inputs, two different wrong ids, deterministically. This is a stable defect in the bare-integer resolution path, not a fixture error and not preprod flakiness (the `TR-NNN` form succeeded against the same run in the same window).

Whatever that path is doing — a stale mapping table, a different id space, a truncation — it silently looks up **someone else's record**. The 400 is lucky: had id 358823 existed and been visible to this caller, the capability would have returned another run's comments with a 200, which is a far worse outcome than an error.

### Refinement: it only misbehaves on *real* ids (added 2026-09-18)

The sibling write capability `create_test_run_test_case_comment_v1` tested the bare-integer form with a deliberately **implausible** value (`99999999`) and got a clean, honest 400 that **echoed the id back unchanged**: `"TRTC not found for given testrun_id:99999999, …"`.

So the substitution does **not** happen for arbitrary integers. It happened for both **real** run ids tried (`17575382` → 358823, `17574995` → 358621), and the substituted values are themselves plausible-looking ids in some other space.

That points away from truncation or parsing and toward a **lookup/translation step that resolves a real run id into a different id space and then queries with the wrong result** — which is consistent with the two substituted ids being close together (358823, 358621) for two runs created close together.

It also means the danger is real rather than theoretical: the failure mode is reserved precisely for the inputs a caller would actually use. A garbage id fails honestly; a genuine one silently addresses another record.

(The write sibling deliberately did **not** test a real bare integer, to avoid writing a comment onto whatever unrelated record the path resolves to. That was the right call — the read side already establishes the defect, and reproducing it on a write risks doing it to someone else's data.)

**Severity is high** despite the empty result set here: the contract invites a caller to use a form that cannot work, and the failure mode is a wrong-record lookup rather than a clean rejection.

## Second drift — the 400 body ignores the declared envelope

Both 400s returned flat `{success:false, message:"..."}` with no `error` object, no `code`, no `details` — contradicting the declared `{success, error:{code, message, details}}`. Another instance of the systemic problem consolidated in `findings/error-envelopes-systemic.md`.

## What the contract gets right

Worth recording, because the "mixed id forms" warning turned out to be accurate and the capability is otherwise well-declared:

- **`project_id` and `test_case_id` are both declared integer, and both are correct.** Sending the `PR-NNN` / `TC-NNN` string forms was rejected **client-side** by `invokeCapability`, consistent with the declared types. This is the good case — unlike `assign_test_run_test_cases_v2`, where a wrongly-declared integer type made the server's required string value unsendable.
- **`mappingId` is labelled "required" in the query but is genuinely optional**, exactly as the guidance says. Omitting it works, and both of `TC-54457`'s real mapping ids (2150387252, 2150387283 — the duplicated row from batch 6) were accepted without error. The guidance correctly overrides the label; not counted as drift.
- The `TR-NNN` path returns the declared envelope cleanly.

## Baseline — cross-verified two ways

**Zero comments everywhere**, checked across four runs and confirmed independently:

- `TR-9062` — all 5 rows, including the duplicated `TC-54457` mapping
- `TR-9058` (`__readonly__`) — both rows
- `TR-9061` — its 1 row
- `TR-9063` (the batch-6 clone) — 1 checked directly, 3 via `comments_count`

Cross-verification used `get_test_cases_for_v1_test_run`'s independent `comments_count` field, which **agreed in every case**. That is stronger than a single endpoint reporting empty, and it is the right way to establish a baseline that a sibling write probe will be measured against.

## What remains unverified

The declared per-comment item shape (`id`, `user_id` object, `entity_id`, `entity_type`, `edited`, `is_editable`, `review_status`, …) was **never exercised** — no real comment row was returned anywhere. An empty collection proves nothing about item shape.

This capability should be **re-probed once a run-scoped comment exists**, at which point the verdict can move to a shape-verified PASS or DRIFT. The sibling `create_test_run_test_case_comment_v1` probe is the route to that.

## Index actions proposed

1. **Investigate the bare-integer `test_run_id` path as a product bug** — it resolves to an unrelated record. Until fixed, **remove the integer form from the declared regex** so the contract stops inviting a call that cannot work; `^TR-[0-9]+$` would be honest.
2. **Fix the declared 400 envelope** — part of the systemic error-envelope finding.
3. Keep the `mappingId` guidance as-is; it correctly warns that the "required" label is wrong.
