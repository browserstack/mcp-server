# create_test_run_test_case_comment_v1 — DRIFT

- **Product / entity:** tm / `comment` (write, run-scoped)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — succeeded first attempt, verified in storage
- **Run file:** `tests/live/runs/tm/create_test_run_test_case_comment_v1.json`
- **Related:** `findings/add_test_case_comment_v1.md`, `findings/list_test_run_test_case_comments_v1.md`

## Summary

The write works and was verified (count 0 → 1, identical object on re-read). **It also confirms this capability is the one the shared comment documentation was written for** — and exposes one field whose value a caller cannot derive or verify.

## It resolves the `TRTC` question — this capability is the original

`entity_type` came back **`"TRTC"`**, exactly as declared, with a description that fits: *"for a comment on a test case inside a test run."* That is precisely what this capability does.

Meanwhile the sibling `add_test_case_comment_v1` — which comments on a plain test case, with no run involved — **declares the same `"TRTC"` value and description but returns `"TestCase"`.**

So the copy-paste direction is now established: **the documentation is correct here and was wrongly propagated to the case-comment capability.** That matters for the fix — the case-comment contracts should be corrected to `"TestCase"`, and this one left alone.

This is the kind of conclusion only cross-capability probing reaches. Either capability examined alone would have looked like an isolated value mismatch.

## The drift — `entity_id` matches nothing the caller supplied

Returned `entity_id: **6809361**`.

| candidate | value | matches? |
| --- | --- | --- |
| `mappingId` sent | 2150387254 | no |
| `test_case_id` sent | 1975349 | no |
| any other input | — | no |

The schema describes `entity_id` as *"the run/case mapping cell id"*, which implies it should equal the `mappingId` the caller passed. **It does not, and nothing in the request or in any read response produces `6809361`.**

The field is stable — identical on the write response and on re-read — so it is a real, persistent identifier in some internal space. But the description gives a caller no way to **derive it beforehand or verify it afterwards**, which is the practical problem: an agent cannot correlate a comment back to the row it commented on using documented values.

Note the contrast with the case-comment sibling, where `entity_id` held the plain `test_case_id` — **understandable but also not what its schema described.** So `entity_id` is documented wrongly on *both* capabilities, in two different ways.

## It refined the read sibling's id bug

The brief invited a controlled test of the declared bare-integer `test_run_id` form, which `list_test_run_test_case_comments_v1` was found to resolve to an unrelated real record.

Using a deliberately **implausible** value (`99999999`) produced a clean, honest 400 that **echoed the id back unchanged**:

```
{"success":false,"message":"TRTC not found for given testrun_id:99999999, testcase_id:1975349, mapping_id:2150387254"}
```

So the substitution does **not** occur for arbitrary integers — only for **real** run ids, where it resolved `17575382` → `358823` and `17574995` → `358621`. That points at a lookup/translation step rather than parsing or truncation, and it means the failure is reserved for exactly the inputs a caller would really use. Recorded in `findings/list_test_run_test_case_comments_v1.md`.

**The probe deliberately did not test a real bare integer here**, to avoid writing a comment onto whatever unrelated record the path resolves to. That was the right call: the read side already establishes the defect, and reproducing it on a *write* risks doing it to someone else's data.

## What is correct

- **The write is genuine.** Baseline independently re-confirmed as 0, then count 0 → 1 with an identical object (same id, text, `created_at`) on re-read via `list_test_run_test_case_comments_v1`. No false 2xx, unlike four `test_run` writes in batch 6.
- **`entity_type` is declared and returned correctly** — the only comment capability where this is true.
- **The schema admits its own `json_path` is wrong**, as its case-comment sibling does. The flat body worked first try. This remains the right way to handle an inherited bad spec, and the contrast with the nine capabilities that confidently instruct callers to wrap is stark.
- The 400 from the side experiment was **honest and specific**, echoing all three supplied ids.

## Pattern evidence, not scored

- `group_id` appears in the nested schema and the real response but is **missing from the flat `returns` array** — the same unreliability seen on both case-comment capabilities.
- The 400 body was flat `{success, message}` against a declared `{success, error:{code, message, details}}` — another instance of the systemic error-envelope problem (`findings/error-envelopes-systemic.md`).

## Index actions proposed

1. **Leave `entity_type` alone here** — it is correct. Fix it on `add_test_case_comment_v1` / `get_test_case_comments_v1` instead, to `"TestCase"`.
2. **Fix the `entity_id` description on this capability.** It is neither the `mappingId` nor the `test_case_id`; document what it actually is and, ideally, expose it somewhere a caller can read it back.
3. **Remove the bare-integer `test_run_id` form** from the declared regex until the resolution bug is fixed — see the read sibling's finding.
4. **Add `group_id` to the flat `returns` array**, or stop treating that array as a contract.

## Residue

**Comment id 1308**, text `__mcp-probe-trtc-comment-2026-09-18T07:40:04Z`, on `TR-9062` / `TC-54458` (mapping `2150387254`). Comments cannot be deleted through this surface — deletion is `destructive` and refused — so this is **permanent**. It is the only run-scoped comment in the fixture pool.
