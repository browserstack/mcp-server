# create_test_case_comment — DRIFT (copy-pasted entity semantics)

- **Product / entity:** tm / `comment` (write)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — succeeded first attempt, verified in storage
- **Run file:** `tests/live/runs/tm/create_test_case_comment.json`
- **Related:** `findings/list_test_run_test_case_comments.md`

## Summary

**The write works correctly** — a real comment was created and independently confirmed (count 0 → 1, returned object identical to what the write reported). After batch 6, where four `test_run` writes reported success while doing nothing or misreporting state, that is worth stating plainly.

The drift is that **two fields carry semantics copied from a different capability**, describing a run-scoped comment on a capability that comments on a plain test case.

## Drift 1 — `entity_type` is declared `"TRTC"`, returns `"TestCase"`

The schema's example is literally `TRTC`, and its description reads: *"'TRTC' for a comment on a test case inside a test run."*

**The actual value is `"TestCase"`.**

That description plainly describes the **run-scoped** comment capability (`create_test_run_test_case_comment` / `list_test_run_test_case_comments`), not this one. So the declared value and its prose appear to have been copied across from the run-scoped sibling, where they are presumably correct, onto a capability where they are wrong.

**This resolves an open question.** `"TRTC"` on a *case*-comment capability raised the possibility that case comments and run-case comments share one storage type. They do not — the entity types differ, and the declaration is simply wrong here.

An agent branching on `entity_type == 'TRTC'` to recognise its own comment would never match.

## Drift 2 — `entity_id` holds the test case id, not a mapping cell

The schema describes `entity_id` as the id of the run/case mapping cell. It actually holds **`1975349` — the plain `test_case_id` from the path**.

Same root cause: a mapping-cell id is what a *run-scoped* comment would reference. On this capability there is no run and no mapping cell, so the description cannot apply.

Taken together, Drifts 1 and 2 are one defect with two symptoms: **the comment entity's documentation was written for the run-scoped case and applied to both.**

## What the contract gets right

- **Every declared field is present and correctly typed** — `id`, `user_id{id, full_name, email}`, `group_id`, `project_id`, `parent_id`, `created_at`, `comment`, `edited`, `is_editable`.
- **`review_status` is absent, and that is correct** — declared as present only on review-verdict comments. Explicitly **not** counted as `declared_missing`.
- **No undeclared fields were returned.**
- **The schema is honest about its own `json_path` being wrong**: it notes that *"the published spec wraps it under an extra `comment` key that the server does not send"*, so the declared `/comment/comment` path is acknowledged as incorrect. A flat body worked first try. This is the only place in seven batches where a contract **admits** a wrapper defect rather than asserting one — worth noting as the right way to handle a known-bad spec inheritance.

## Flat `returns` disagreement (pattern evidence, not drift)

`group_id`, `project_id` and `parent_id` appear in the nested schema **and** in the real response, but are **missing from the flat `returns` arrays** of both this capability and `list_test_case_comments`. Consistent with the suite-wide finding that flat `returns` arrays are unreliable in both directions; recorded here as another data point rather than as a separate defect.

## Verified in storage

Baseline confirmed 0 comments on the target triple (project int `379335744`, folder `764828`, case int `1975349`) before the write — matching a sibling's sweep of 18 cases across 3 projects. After the write, `list_test_case_comments` returned **1** comment whose `id`, `created_at` and text matched the write response exactly.

This is a **genuine write**, not a false 2xx.

## Index actions proposed

1. **Correct `entity_type`** to `"TestCase"` on this capability and on `list_test_case_comments`, and rewrite the description — the current text describes the run-scoped capability.
2. **Correct the `entity_id` description** — it holds the test case id here, not a mapping cell id.
3. **Audit the comment entity's field documentation as a whole.** Two fields on two capabilities carry run-scoped semantics; whatever produced that likely affected the rest of the entity's prose.
4. Keep the honest `json_path` note — it is the correct pattern, and other capabilities with inherited wrapper defects should say the same thing rather than instructing callers to wrap.

## Residue

**Comment id 1307**, text `__mcp-probe-comment-2026-09-18T07:36:35Z`, on `TC-54458` (case int `1975349`, folder `764828`, project int `379335744`). Comments cannot be deleted through this surface — deletion is `destructive` and refused by the runtime — so this is **permanent**. It is the first and only comment in the fixture pool.
