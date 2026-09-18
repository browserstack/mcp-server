# create_sub_test_plan_v2 — DRIFT

- **Product / entity:** tm / `test_plan` (write — creates a child plan)
- **Path:** `POST /api/v2/projects/{project_id}/test-plans/{test_plan_id}/sub-test-plans`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/create_sub_test_plan_v2.json`
- **Related:** `findings/create_test_plan_v2.md`, `findings/get_test_plan_v2.md`

## Summary

The capability works and the sub-plan was verifiably created. Three documentation defects, plus a **sixth** instance of the body-wrapper trap — and this one is the most clear-cut yet, because the guidance is unusually emphatic and unusually wrong.

## Drift 1 — the guidance names the wrapper explicitly, and the wrapper fails

Guidance, verbatim:

> "Wrap the body in a `sub_test_plan` object, **NOT** `test_plan`."

That instruction goes out of its way to correct a wrapper name — and both wrappers are wrong. Attempt 1, built exactly as instructed:

```
unknown body: sub_test_plan. accepted: description, end_date,
issue_tracker, issues, name, start_date, tags
```

Rejected **client-side, before any HTTP request**. Attempt 2, the same fields flat → **200**.

This is the sixth instance across the suite (`create_folder_v2`, `rename_folder_v2`, `create_template_v2`, `create_test_plan_v2`, `update_test_run_v2`, and now this one). The pattern is invariant: **`invokeCapability` takes body fields flat under their own names and applies any `json_path` itself.** Every wrapper instruction in this index is wrong; see `findings/create_test_plan_v2.md` for the consolidated view. What makes this instance notable is that the guidance was *edited* to be more specific about the wrapper, which means someone touched it without ever invoking it.

## Drift 2 — `sub_plans_count` is documented as `null` on a sub-plan; it returns `0`

The nested schema says `sub_plans_count` is "null on a sub-plan." The created sub-plan `STP-6` returned the **integer `0`**.

## Drift 3 — `sub_plans_count` is missing from the flat `returns` array

It is returned on the response but absent from the capability's flat `returns` list (15 keys), appearing only in the nested schema.

This is the **mirror image** of the `parent_plan_id` defect on the sibling read capabilities, where the flat `returns` array *over*claims a conditional field. So the flat `returns` arrays in this index are unreliable in **both** directions — they can list fields that never arrive and omit fields that always do. That makes `returns` unusable as a contract, which matters because it is the most prominent, easiest-to-read part of what an agent is shown.

## Drift 4 — `urls` declared as a bare object

`urls` is declared `{type: object}` with no enumerated properties while returning `urls.self`. The recurring pattern across this whole plan family (`list_test_plans_v2`, `get_test_plan_v2`, `get_test_plan_test_runs_v2`).

## It closed an open question the batch could not otherwise close

A sibling `get_test_plan_v2` probe found `parent_plan_id` absent on top-level plans but had **no sub-plan available** to check whether it is ever actually populated. This probe created the first one:

**`parent_plan_id` IS populated on a real sub-plan** — on the create response *and* on an independent `get_test_plan_v2` read-back of `STP-6` — both times as **`"TP-1616"`, the parent's identifier**, never the numeric `48283`.

So the nested schema's "present only when this plan is a sub-plan" is **substantively correct**, and the defect is narrowly in the flat `returns` array's unconditional listing. That distinction matters for the fix: the per-field schema needs no change, only `returns` does.

## Verified in storage, not from the echo

- `STP-6` created under `TP-1616`, numeric plan id `48284` (recoverable only via `urls.self` — no numeric id field, same as the parent).
- **`TP-1616`'s `sub_plans_count` went 0 → 1**, confirmed by re-reading with `get_test_plan_v2`. A real attachment.
- **Sub-plans are excluded from `list_test_plans_v2`.** That listing on `PR-2005` (count=300, single page) still returned only `TP-1616` and `TP-1596` — `STP-6` does not appear. Worth documenting: an agent enumerating plans via the listing will never see sub-plans, and there is no obvious capability that lists them (the parent's `urls.sub_test_plans` link is the only hint).

No `declared_missing` — everything in the flat `returns` array was present.

## Not tested

**Nesting a sub-plan under a sub-plan.** Not attempted. The path-param regex `^(TP|STP)-\d+$` *would* route-match an `STP` parent, but the prose only ever describes a `TP-NNN` parent and states a sub-plan "cannot be re-parented or promoted afterwards," while giving **no explicit depth limit either way**. Reported as an open contract gap rather than inferred from a call — the right call, since an accidental two-level nest could not be undone (no re-parenting, and deletes are gated).

No 4xx/5xx HTTP response occurred — the one rejection was client-side pre-flight — so the error-envelope question does not apply here.

## Index actions proposed

1. **Delete the wrapper instruction.** Say plainly: send fields flat at the top level. This is part of the suite-wide wrapper audit.
2. **Fix `sub_plans_count`** — document it as integer `0` on a sub-plan, not `null`, and add it to the flat `returns` array.
3. **Stop treating flat `returns` as a contract**, or regenerate it to respect conditionality and completeness. It currently both over- and under-claims across this family.
4. **Enumerate `urls.self`** (and the family's other `urls`/`links` sub-keys).
5. **Document that sub-plans do not appear in `list_test_plans_v2`**, and say how an agent is meant to enumerate them.
6. **State the nesting depth limit** explicitly, since the regex and the prose disagree about what is permitted.

## Residue

Sub-plan **`STP-6`** (numeric `48284`) under `TP-1616` on `PR-2005`. Deletes are gated, so it persists.
