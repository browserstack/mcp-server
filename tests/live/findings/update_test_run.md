# update_test_run — DRIFT

- **Product / entity:** tm / `test_run` (write)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — subject `TR-9062`, **two** independent partial writes, each verified by a fresh re-read plus a control
- **Run file:** `tests/live/runs/tm/update_test_run.json`
- **Consolidated in:** `findings/test-run-writes-untrustworthy-systemic.md`

## Summary

This probe existed to settle whether `replace_test_run`'s response-fidelity defect was endpoint-specific or entity-wide. **It is entity-wide.** The same three fields misreport here, across two separate writes, spanning both PATCH and POST on the route family.

It also cleared the twins of one suspicion and found an undocumented difference between them.

## Finding 1 — the write response misreports state, confirming the entity-wide defect

Two partial writes, each compared against a fresh `get_test_run` read:

**Write 1** — `{assignee: "probe-user@example.invalid", run_state: "in_progress"}`:

| field | response echoed | storage |
| --- | --- | --- |
| `assignee` | **`null`** — the stale *pre-write* value | `"probe-user@example.invalid"` — correctly applied |
| `overall_progress` | `{Untested: 4}` | `{Untested: 5}` |
| `updated_at` | fresh `07:16:59.000Z` | **`06:27:38.743Z`** — unchanged |

**Write 2** — `{description: "update-probe-second-description", run_state: "under_review"}`:

| field | response echoed | storage |
| --- | --- | --- |
| `overall_progress` | `{Untested: 4}` | `{Untested: 5}` |
| `updated_at` | fresh `07:17:37.000Z` | **`06:27:38.743Z`** — still unchanged |

Note write 1's `assignee`: the caller **set** it, the write **applied** it, and the response reported the **old** value. So the echo is not simply "request values reflected back" — it is a pre-write snapshot for fields outside some subset, which is arguably worse, because it contradicts the very change the caller just requested.

`TR-9058` (untouched control) stayed static and self-consistent throughout, so this is not preprod noise. Combined with `replace_test_run` misreporting **the same three fields**, this is a route-family defect.

## Finding 2 — `updated_at` is never persisted

Across this batch `TR-9062` took a replace and two updates, **all verified successful in storage** by fields that genuinely changed. Its stored `updated_at` remains identical to `created_at`.

The API is not merely misreporting modification time — **it is not recording one.** That breaks change detection, incremental sync, cache invalidation, optimistic concurrency and audit trails for every consumer of this entity. It is a data-integrity bug rather than a contract defect, and it is the most serious thing found in batch 6.

## Finding 3 — the twins are correctly named (a suspicion cleared)

`replace_test_run` clears fields on omission; the open question was whether `update` did the same, which would have made the two near-duplicates with a misleading name distinction.

**It does not.** Verified directly: `tags` and `description` omitted in write 1 survived unchanged, and `assignee` — set in write 1, omitted in write 2 — also survived. **`update` merges; `replace` clears-on-omission.** The naming is accurate and the capabilities are genuinely distinct.

Worth recording as a negative result: this is one of the few places in the suite where two similarly-named capabilities behaved *differently in exactly the way their names imply*.

## Finding 4 — an undocumented behavioural difference between the twins

`replace_test_run` wraps plain-text `description` input in `<p>` tags on storage; **`update_test_run` does not** — the same kind of input persisted unwrapped.

So the same logical field is transformed differently depending on which capability writes it, and neither contract mentions it. An agent alternating between the two would see its description gain and lose HTML wrapping for no visible reason.

## Finding 5 — the wrapper guidance, for the ninth time

Attempt 1 sent the body wrapped in a `test_run` object, **exactly as this capability's own guidance instructs**:

```
unknown body: test_run. accepted: assignee, configuration_map, ...
```

Rejected client-side. Flat worked. Consolidated in `findings/create_test_plan.md`; counted here only as another instance.

## Confirmed correct

- **Row set untouched** by both writes — 5 rows including the duplicate, as documented for omitted composition keys.
- **`filter_test_cases.is_dynamic` is boolean**, consistent with batch 4 and with `get_test_run`/`list_test_runs`. `list_test_plan_test_runs`'s integer remains the sole outlier.

## Known entity-wide drift, recorded not re-litigated

Declared-but-absent (`id`, `uuid`, `owner`, `is_automation`, top-level `is_dynamic`, `test_plans`, `test_cases_count`, `overall_progress_by_status_id`) and undeclared-but-returned (`filter_test_cases`, `urls`, `links.test_cases`, `issues: []`); `assignee` declared an object and returned a string; `overall_progress` declared as seven fixed lowercase keys and returned as a sparse capitalised map. All as catalogued — fix once at the shared schema, per `findings/get_test_run.md`.

## Index actions proposed

1. **Escalate the `updated_at` non-persistence** to the product team — data integrity, not documentation.
2. **Fix write responses to read back from storage**, or omit fields they cannot report accurately.
3. **Document the `<p>`-wrapping difference** between `update` and `replace`, or make them consistent.
4. **Delete the "wrap in a `test_run` object" guidance.**
5. Keep the update/replace naming as-is — it is accurate, and that is worth not breaking.

## Final state of `TR-9062` (batch residue)

`identifier` TR-9062 · `PR-2005` (numeric `17575382`) · name `__mcp-probe-run-2026-09-18T06-35-00Z` · description `update-probe-second-description` (plain, unwrapped) · tags `["replace-probe-tag"]` · assignee `probe-user@example.invalid` · `run_state` **`under_review`** · `active_state` active · configurations `[]` · `updated_at` **still `06:27:38.743Z`** · storage `overall_progress` `{Untested: 5}`.

**5 rows**, all untested/unassigned: `TC-54458` (2150387254), `TC-54457` ×2 (2150387252, 2150387283 — duplicate preserved), `TC-54456` (2150387251), `TC-54455` (2150387253). **No underlying test case was modified** — only run-level fields and run-owned rows.
