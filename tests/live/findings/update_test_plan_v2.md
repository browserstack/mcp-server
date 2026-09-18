# update_test_plan_v2 — DRIFT

- **Product / entity:** tm / `test_plan` (write)
- **Path:** `PATCH /api/v2/projects/{project_id}/test-plans/{test_plan_id}`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/update_test_plan_v2.json`
- **Related:** `findings/create_test_plan_v2.md`, `findings/get_test_plan_test_runs_v2.md`

## Summary

**The update itself is clean** — the rename/description/retag landed in storage, was verified by re-reading, and was fully restored afterwards. Two guidance claims are wrong, and the second one is interesting because the guidance may be right about the *API* while being unreachable through the surface an agent actually uses.

## Drift 1 — the wrapper claim, for the seventh time

Guidance, verbatim:

> "Wrap the body in a `test_plan` object… An unwrapped flat body is accepted too."

Attempt 1, wrapped exactly as recommended:

```
unknown body: test_plan. accepted: description, end_date, issue_tracker,
issues, name, plan_status, start_date, tags
```

Rejected **client-side**. Flat succeeded. So the recommended form fails and the "also accepted" alternative is the only one that works — identical to `create_test_plan_v2`, and the **seventh** instance in this suite (`create_folder_v2`, `rename_folder_v2`, `create_template_v2`, `create_test_plan_v2`, `create_sub_test_plan_v2`, `update_test_run_v2`, and this one).

## Drift 2 — the documented "silent discard" of `test_runs` does not happen

This is the more interesting one. Guidance says a `test_runs` list sent here is:

> "SILENTLY DISCARDED — 200, plan unchanged, nothing linked, no warning."

That is a deliberately-documented trap, and a sibling probe relied on it (routing around via `update_test_run_v2` instead, which worked). **But it does not happen.** `test_runs` is not a declared body field on this capability at all, and sending it flat was rejected **client-side before any HTTP request**:

```
unknown body: test_runs. accepted: description, end_date, issue_tracker,
issues, name, plan_status, start_date, tags
```

So neither documented element holds: there is no 200, and there is no silence — the caller gets an immediate, explicit error.

### Why this drift is worth recording even though the real behaviour is *safer*

An explicit rejection is better for a caller than a silent lie, so the practical outcome is an improvement on what the docs promise. But it is still drift, for three reasons:

1. **The stated mechanism is wrong**, and an agent that reads the guidance will believe it needs a defensive re-read after every update to check whether its `test_runs` silently vanished. It does not.
2. **It reveals a limit on what this surface can test.** `invokeCapability` validates the body against the *declared* field list and rejects unknown keys pre-flight. So **any guidance describing what the API does with an undeclared parameter is unobservable through this surface** — the claim may well be true of the raw HTTP API while being unreachable here. This suite cannot confirm or refute it, and that is a structural limitation worth knowing about, not a gap in this probe.
3. It means the index is documenting raw-API behaviour in a surface where that behaviour cannot occur, which will mislead exactly the audience the index is written for.

## What is correct

Recorded so a fix does not regress it:

- **The update works and persists.** Name, description and tags were changed, then confirmed by an independent `get_test_plan_v2` read — not trusted from the response echo.
- **Sparse-update semantics hold.** Omitted fields kept their stored values.
- **Run linkage was untouched.** `get_test_plan_test_runs_v2` still returned exactly `TR-9061`, nothing added or removed — so whatever the guidance says about discarding, the update genuinely does not disturb linked runs.
- **Response shape matched the declared `returns` list**, with no undeclared fields, and with `parent_plan_id` correctly absent (top-level plan). The flat `returns` array overclaims it unconditionally while the nested schema correctly scopes it to sub-plans — the same known pattern as the sibling capabilities, cross-referenced in `findings/get_test_plan_v2.md` rather than re-filed here.
- **No lifecycle change.** `plan_status` was never sent and `active_state` stayed `"active"` throughout.

## Fixture left as found

`TP-1616`'s name, description, tags, dates, `active_state`, run linkage (`TR-9061`) and `sub_plans_count` (1) were all restored to their pre-probe state, and the restoration was itself verified by re-reading. Originals were captured **before** any mutation. `TP-1596` was never written to.

## Index actions proposed

1. **Fix the wrapper guidance** — recommend flat. Part of the suite-wide wrapper audit (see `findings/create_test_plan_v2.md`).
2. **Remove or rewrite the `test_runs` silent-discard warning.** Either drop it, or state explicitly that it describes raw-API behaviour and that this surface rejects the field outright. As written it warns of a hazard that cannot occur here.
3. **Keep pointing callers at `update_test_run_v2`** for linking a run to a plan — that part of the advice is correct and useful, and it is the only working route.
4. Fix the flat `returns` overclaim of `parent_plan_id` (tracked in the `get_test_plan_v2` finding; same root cause).

## A note for the suite itself

Drift 2 establishes a general limit worth carrying forward: **`invokeCapability` rejects undeclared body keys pre-flight**, so no probe through this surface can verify (or refute) documented behaviour about parameters the contract does not declare. Any such guidance in the index is, by construction, untestable here — and should probably be marked as raw-API-only or removed, since the index's audience reaches the API exclusively through this surface.
