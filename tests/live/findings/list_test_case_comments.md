# list_test_case_comments — DRIFT (guidance contradicts the response)

- **Product / entity:** tm / `comment` (read)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — baseline sweep, then re-probed against a real comment
- **Run file:** `tests/live/runs/tm/list_test_case_comments.json`
- **Primary write-up of the shared defect:** `findings/create_test_case_comment.md`

## Summary

The envelope, field presence and types are all **correct** — in isolation this would be a PASS. The verdict is DRIFT because two fields carry values that **contradict the guidance describing them**, confirming on the read side what the write sibling found.

Severity is low-to-moderate: nothing is absent or malformed, but a caller who trusts the descriptions builds a wrong mental model of what a comment references.

## The drift — confirmed independently through this endpoint

The real row (comment id 1307, created by the sibling `create_test_case_comment` probe):

```json
{"id":1307,"user_id":{"id":2522,"full_name":"ing","email":"probe-user@example.invalid"},
 "group_id":2615,"project_id":379335744,"parent_id":null,
 "entity_id":1975349,"entity_type":"TestCase",
 "created_at":"2026-09-18T07:36:43.727Z",
 "comment":"__mcp-probe-comment-2026-09-18T07:36:35Z",
 "edited":false,"is_editable":true}
```

| field | declared / described | actual |
| --- | --- | --- |
| `entity_type` | example `"TRTC"`, described as *"for a comment on a test case inside a test run"* | **`"TestCase"`** |
| `entity_id` | *"the id of the run/case mapping cell"* | **`1975349`** — the plain `test_case_id` |

Both descriptions apply to a **run-scoped** comment, not to this capability. The full analysis of the copy-paste root cause is in `findings/create_test_case_comment.md`; what matters here is that the **read endpoint independently reproduces it**, so it is a property of the stored comment rather than an artifact of the write response.

This is the drift class this batch was specifically told to watch for: **the schema shape matches, and the guidance is still wrong.** A probe checking only field presence and types would have called it PASS.

## What is correct

- **Every declared field present with the correct type** — `id`, `user_id{id, full_name, email}`, `group_id`, `project_id`, `parent_id`, `entity_id`, `entity_type`, `created_at`, `comment`, `edited`, `is_editable`.
- **No undeclared fields returned.**
- **`review_status` absent — correctly so.** It is declared as present only on review-verdict comments, and was explicitly **not** counted as `declared_missing`.
- The top-level envelope and `info` pagination block matched exactly, on both the empty baseline and the populated re-probe.

## Flat `returns` disagreement (pattern evidence, not drift)

`group_id`, `project_id` and `parent_id` are in the nested schema **and** in the real response, but **absent from this capability's flat `returns` array** — the same unreliability recorded across the suite. Noted, not scored.

## How this was verified — and the sample-size caveat

The probe ran in two phases, which is why the run file carries both:

1. **Baseline:** 18 test cases across 3 projects — the whole fixture pool, **every** case in the account's oldest project (`Default Project`, 93 runs against 11 cases), and samples from `Demo KB` — **all zero comments**. Verdict at that point was correctly `UNVERIFIED`: an empty collection proves nothing about item shape.
2. **Re-probe** after the write sibling created comment 1307 on the exact triple recorded as the 0-baseline. Count went 0 → 1 and the item shape became checkable.

**Verified against exactly one comment.** Three declared behaviours remain unexercised because nothing in the fixture produces them: threading (`parent_id` non-null), `edited: true` after an edit, and `review_status` on a review-verdict comment — the last of which is unreachable anyway, since the review workflow is gated off on this project (batch 5).

## Index actions proposed

Both fixes belong to the shared comment-entity defect — see `findings/create_test_case_comment.md`:

1. **Correct `entity_type`** to `"TestCase"` here and rewrite its description.
2. **Correct the `entity_id` description** — it holds the test case id, not a mapping cell id.
3. **Add `group_id`, `project_id`, `parent_id` to the flat `returns` array**, or stop treating that array as a contract.
