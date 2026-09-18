# create_test_plan_v2 — DRIFT

- **Product / entity:** tm / `test_plan` (write)
- **Path:** `POST /api/v2/projects/{project_id}/test-plans`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/create_test_plan_v2.json`
- **Related:** `findings/rename_folder_v2.md`, `findings/create_folder_v2.md` — same systemic theme

## Summary

**The capability works, but its guidance is backwards about the one thing guidance exists to get right: the call shape.** It instructs the caller to wrap fields in a `test_plan` object and says a flat body "also works." The truth is the exact inverse — the wrapped form is rejected, the flat form succeeds.

## The falsified claim

Guidance, verbatim:

> "Wrap the fields in a `test_plan` object. An unwrapped flat body also works, but a body wrapped under any other key (`plan`, `sub_test_plan`) is read as empty and fails with 400."

**Attempt 1** — built exactly as instructed, `body: {"test_plan": {name, description, start_date, end_date, tags}}`:

```
unknown body: test_plan. accepted: created_at, description, end_date,
issue_tracker, issues, name, start_date, tags, updated_at
```

Rejected **client-side, before any HTTP request.**

**Attempt 2** — the same fields flat at the top level of the body → **200 OK**, plan `TP-1616` created.

So the recommended form is the one that fails, and the form described as a mere alternative is the only one that works. An agent following this guidance is blocked before it reaches the API.

## This is the third variant of the same systemic problem

The index's body-wrapping advice has now been wrong in three distinct ways across this suite, and always in the direction of telling an agent to nest when the surface wants flat:

| capability | what the index says | reality |
| --- | --- | --- |
| `create_folder_v2` (batch 3) | `json_path: /folder/name` etc. | nested rejected client-side; **flat** works |
| `rename_folder_v2` (batch 3) | guidance: *"The body must contain a `folder` object (400 otherwise)"* | false — **flat** works first try |
| **`create_test_plan_v2`** | guidance: *"Wrap the fields in a `test_plan` object"* | backwards — wrapped rejected, **flat** works |

The root cause is consistent and worth fixing once at the surface rather than per capability: **`invokeCapability` accepts body fields flat under their own declared names and applies any `json_path` mapping itself.** Batch 1's `create_template_v2` hit the identical `unknown body: template. accepted: …` rejection, and batch 1's `edit_project_v1` worked precisely because its agent passed flat despite a declared `/project/{field}` path.

Every piece of prose in this index that tells a caller to wrap a body is therefore suspect and should be audited as a class.

## Secondary findings

**The "numeric id is not in this payload" claim is misleading.** The contract's prose says the numeric id that the v1 plan capabilities need is not in the create response. It is in fact recoverable from `test_plan.urls.self` (`.../test-plans/48283`), along with the numeric project id (`379335744`). Not a structural violation — `urls` is declared — but the claim sends a caller off to make another call it does not need.

**`parent_plan_id` is listed unconditionally in the top-level `returns` array** but is **fully absent** (not even `null`) on a top-level plan. The nested schema does note it as conditional, so this is a documentation-precision gap between `returns` and the schema rather than a hard violation.

**`active_state` never reports the documented `new` state.** The contract text says a plan is created in a `new` state, but `active_state` only ever takes `active` / `completed`, and the created plan came back `active`. Worth clarifying which is authoritative.

**Tag order is not preserved.** Sent `["mcp-probe","disposable"]`, returned `["disposable","mcp-probe"]`. Harmless, but an agent diffing tag arrays positionally would see a spurious change.

## Attaching test runs at create time is not supported — confirmed, not assumed

This matters for the chain, and the evidence is unusually clean: the attempt-1 rejection enumerated the **entire** accepted body — `created_at, description, end_date, issue_tracker, issues, name, start_date, tags, updated_at`. There is no `test_runs` or `test_run_ids` field on this route at all. So a plan cannot be created with runs attached, and the sibling `get_test_plan_test_runs_v2` probe needs a separate capability to attach one or it can only observe an empty collection.

That accidental enumeration is a useful side effect of the wrapper rejection: it revealed the complete accepted parameter set in one error message.

## Verification against storage, not the echo

`list_test_plans_v2` on `PR-2005` was read before and after: count went **1 → 2** (`TP-1596` only, then `TP-1616` + `TP-1596`), with the new row matching the create response exactly. Recorded in `setup[]`. Global search was not used (≥6-day indexing lag).

## Not exercised

The contract's `description` sanitisation / link-rewriting behaviour — plain text was sent and echoed back unchanged, so the HTML-handling claim remains unverified. No owner field exists on this route (documented as a v1-only concept), so owner handling was not testable here.

## Index actions proposed

1. **Rewrite the body-shape guidance.** It currently recommends the failing form. Say plainly: send fields flat at the top level of the body.
2. **Audit every capability whose guidance recommends wrapping a body** — on this evidence that advice is wrong wherever it appears, because the surface always takes flat. Fix it as a class, and consider having `describeCapability` state the calling convention once, globally.
3. **Correct the "numeric id is not in this payload" claim** — it is available via `urls.self`.
4. **Reconcile `parent_plan_id`** between the unconditional `returns` list and the conditional schema note.
5. **Clarify the `new` vs `active` state discrepancy.**
6. Optionally note that tag order is not preserved.

## Residue

Plan **`TP-1616`** (numeric id `48283`) on `PR-2005`. Four sibling probes in this batch operate on it, and it will end the batch carrying a sub-plan and an update.
