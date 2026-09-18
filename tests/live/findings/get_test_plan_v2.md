# get_test_plan_v2 — DRIFT

- **Product / entity:** tm / `test_plan` (read)
- **Path:** `GET /api/v2/projects/{project_id}/test-plans/{test_plan_id}` (`json_path: test_plan`)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — **two plans**, `TP-1616` (created by this suite) and `TP-1596` (the older readonly fixture)
- **Run file:** `tests/live/runs/tm/get_test_plan_v2.json`
- **Related:** `findings/create_test_plan_v2.md`, `findings/list_test_plans_v2` (no file — PASS)

## Summary

The capability works and most of its contract is accurate — notably *more* accurate than its create sibling on one point. Two defects remain, both **documentation-precision failures rather than wrong behaviour**, and both confirmed on two independent records.

## Drift 1 — the flat `returns` array overclaims `parent_plan_id`

`parent_plan_id` is listed **unconditionally** in the capability's top-level flat `returns` array, alongside `identifier`, `name` and the rest, as though every response carries it. On both top-level plans probed it is **absent entirely** — not `null`, not present.

The **nested per-field schema is honest** about this: *"present only when this plan is a sub-plan"*, nullable. So the per-field documentation is correct and the flat summary list contradicts it.

This is the same defect the sibling `create_test_plan_v2` probe found on the create route, so it is **not a one-off**: the flat `returns` arrays in this index appear to be generated as a simple union of every possible field, losing the conditionality that the nested schemas preserve. An agent that reads `returns` as "what I will get back" is misled; one that reads the nested schema is not.

**Now confirmed — thread closed.** At the time of this probe no `STP-NNN` sub-plan existed, so whether `parent_plan_id` is ever actually populated was unverified. The sibling `create_sub_test_plan_v2` probe then created `STP-6` and checked it both ways:

> `parent_plan_id` **is** populated on a real sub-plan — on the create response *and* on an independent `get_test_plan_v2` read-back of `STP-6` — both times as **`"TP-1616"`, the parent's identifier**, never the numeric `48283`.

So the nested per-field schema is **substantively correct**, and the defect is narrowly in the flat `returns` array. That narrows the fix: the per-field schema needs no change, only `returns` does. (Worth noting the nested schema does not say *which form* the value takes; "the parent's identifier, not its numeric id" is worth adding.)

## Drift 2 — `urls` and `links` sub-keys are returned but never enumerated

Both `urls` and `links` are declared as bare `{type: object}` with a prose description and **no `properties`**. Actual responses, on both plans:

```
urls:  {self, sub_test_plans}
links: {self, test_runs}
```

These match the prose exactly (*"Web-app deep links for a human, plus a sub_test_plans link on top-level plans only"* / API self and test_runs links), but nothing in the JSON schema enumerates them, so they are structurally undeclared.

**Same pattern as `list_test_plans_v2`**, which declares `urls` as a bare object while returning `self` and `sub_test_plans`. Since the prose does describe the keys, this is weaker than batch 2's genuinely-undocumented fields — but it means no typed client can rely on them and nothing would catch the sub-shape changing.

## What the contract gets right — including one place it beats its sibling

Worth recording so a fix does not regress it:

- **The numeric-id claim is accurate here.** The schema states explicitly that there is no dedicated numeric id field and that `identifier` is the only id in the payload. That is exactly what was observed — the numeric id (`48283` for `TP-1616`, `48245` for `TP-1596`) is recoverable only by parsing `urls.self`. **The create route's prose got this wrong** (it claimed the numeric id "is not in this payload" when it was recoverable); this read route describes reality correctly.
- **`owner` is absent and undeclared** — consistent with the create contract's statement that owner is always the calling user and never returned. Not drift.
- **Null and empty-array handling is honest.** On the older fixture plan, `start_date`/`end_date` came back as explicit `null` (not omitted) when unset, and `tags`/`issues`/`test_runs` as empty arrays rather than being dropped — both matching the declared nullable/array types.
- **All other declared fields present with correct types** on both plans: `identifier`, `name`, `description`, `active_state` (within its closed enum), `tags`, `issues`, `test_runs_count {active, closed}`, `test_runs`, `sub_plans_count`, `start_date`, `end_date`, `created_at`, `project_id`.

## What could not be checked

**`test_runs` was empty on both plans** (`test_runs_count` 0/0), so the declared `{identifier, name}` preview item shape inside it is **unverified**. Correctly recorded as such rather than claimed as a pass — an empty array proves nothing about its element shape.

No sub-plan was available to verify the conditional `parent_plan_id` (see Drift 1).

## Environment note

`TP-1616` needed **three attempts**: two returned status 0 `"the product could not be reached"` before an unchanged third attempt succeeded. `TP-1596` succeeded first try. This is the same preprod intermittency several probes hit today — not a capability defect, and distinct from a plain `{"status":500,…}`.

The agent also correctly declined to treat `TP-1616`'s `test_runs_count` as suspect, given a concurrent sibling probe might attach a run to that plan mid-read — it recorded the coordination note instead of manufacturing a finding.

## Index actions proposed

1. **Fix the flat `returns` arrays to respect conditionality**, or drop `parent_plan_id` from this one. This is worth fixing as a class — `create_test_plan_v2` has the identical problem, which suggests however `returns` is generated, it flattens away conditional presence everywhere.
2. **Enumerate `urls` and `links` sub-keys** in the schema (`urls.self`, `urls.sub_test_plans`, `links.self`, `links.test_runs`), noting that `sub_test_plans` appears on top-level plans only. Applies equally to `list_test_plans_v2`.
3. **Preserve the accurate numeric-id note** in this contract, and **port it to `create_test_plan_v2`**, whose version of the same claim is wrong.
4. Follow up by reading the sub-plan that `create_sub_test_plan_v2` creates, to confirm `parent_plan_id` is populated there.
