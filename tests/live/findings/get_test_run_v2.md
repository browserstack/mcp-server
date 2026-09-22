# get_test_run_v2 — DRIFT (and a reproducible 500 on a declared query param)

- **Product / entity:** tm / `test_run` (read)
- **Path:** `GET /api/v2/projects/{project_id}/test-runs/{test_run_id}`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — **three runs**: `TR-9062` (fresh), `TR-9061` (plan-linked), `TR-9058` (older fixture)
- **Run file:** `tests/live/runs/tm/get_test_run_v2.json`
- **Related:** `findings/create_test_run_v2.md`, `findings/error-envelopes-systemic.md`

## Summary

Six defects. The most important is not any one of them but the **confirmation that the `test_run` response schema is over-declared entity-wide** — which converts what looked like 15 separate create-endpoint gaps into a single fix.

## Finding 1 — the 15 missing fields are missing here too: one fix, not two

Every field the sibling `create_test_run_v2` probe found absent is **also absent here**, across all three runs:

`id`, `uuid`, `type`, `owner`, `environment`, `overall_progress_by_status_id`, `test_cases_count`, `is_automation`, `observability_url`, `metadata`, `assignee_imported`, `is_dynamic` (top-level), `test_plans`, `self_ui_link`, `links.detail`

An identical gap list across an independent create and an independent read, on three different records, is strong evidence of a **shared over-declared `test_run` schema** rather than two coincidental projection gaps. This is the same shape of problem batch 4 found when all five `test_plan` operations drifted together.

**Practical consequence for the fix:** correct the shared schema once and both capabilities (and probably the rest of the family) come right together. Do **not** patch per-endpoint.

## Finding 2 — the guidance on the numeric run id is actively wrong

There is **no numeric or uuid run id anywhere** on the v2 surface; `identifier` (`TR-NNNN`) is the only id. That was already established across three capabilities.

What is new and worse: **this capability's own guidance says "the integer lives in `uuid` — take it for the numeric id."** `uuid` never appears in any response. So the contract does not merely omit the id, it **directs the caller to a field that does not exist**.

This compounds the gap noted in `findings/create_test_run_v2.md`: v1 run capabilities need a numeric id, and the one place the index tells you to look for it is empty.

**But the v1 surface is not unreachable.** The sibling `get_test_run_progress_v1` probe resolved `TR-9062` → `17575382` via **`get_test_runs_v1`**, and separately found that route accepts the `TR-NNNN` form directly anyway. So the practical impact is a misleading pointer and an extra bridging call, not a dead end — worth stating precisely, because the reverse would be a much more serious claim.

## Finding 3 — `assignee` declared an object, returned a string

Returned as a plain email string (`"probe-user@example.invalid"`) or `null` — never the declared object. **Identical to the create response**, so this is another entity-wide type error rather than an endpoint quirk.

## Finding 4 — `overall_progress` is present here, but with an incompatible shape

Unlike create (where it is absent entirely), the read **does** return `overall_progress`. It does not match the declaration:

| | shape |
| --- | --- |
| **declared** | seven fixed lowercase keys, always present: `untested, passed, retest, failed, blocked, skipped, in_progress` |
| **actual** | sparse and capitalised — `{"Untested": 4}`, only non-zero statuses |

So a caller reading `overall_progress.untested` gets `undefined` even when four cases are untested. Both the **casing** and the **always-present** guarantee are wrong.

This also explains batch 4's `list_test_runs_v2` observation that `overall_progress` was "omitted when nothing executed" — the field is sparse by nature, so an all-zero run yields an empty or absent object. The contract's fixed-seven-keys model does not describe this API.

## Finding 5 — `test_plans` (array) vs `test_plan` (object), with a string id

When a run genuinely carries a plan link (`TR-9061` → `TP-1616`), the response returns a **singular `test_plan` object**, not the declared `test_plans` array:

```json
"test_plan": { "id": "TP-1616", "identifier": "...", "name": "..." }
```

Two errors in one: the field name/cardinality is wrong, and `id` is a **string** (`"TP-1616"`) where the contract declares an integer.

This is the **sixth** appearance of `test_plan`-entity drift, after the five capabilities batch 4 found — here nested inside a different entity's response. Worth flagging to whoever fixes the `test_plan` family that its shape leaks into `test_run` responses too.

## Finding 6 — undeclared fields returned

`filter_test_cases`, `urls`, `links.test_cases` — all three returned, none declared (the schema declares only `links.{self,detail}`). **Matches the create response exactly**, reinforcing the shared-schema conclusion.

Beyond the checklist, two more: a full **`test_cases` array** of rich nested objects, and an **`issues` array**. Neither appears anywhere in the contract. `issues` was empty on all three runs, so **its item shape is UNVERIFIED** — not cleared.

## Finding 7 — `minify` is a declared parameter with no effect

> **RETRACTED AND REPLACED (2026-09-18).** This section originally reported that `minify=true` **reliably returned HTTP 500 with a literal `null` body (2/2)** while the default succeeded (3/3), and recommended reporting it to the product team as a crash. **That was wrong**, and it was retracted before it left this suite.
>
> **What happened:** the orchestrator re-tested it directly. `minify=true` returned **200**. A sibling probe (`get_test_run_progress_v1`) had meanwhile hit **three consecutive null-body 500s** on unrelated, already-trusted calls and correctly attributed them to preprod instability. So the original 2/2 was a flakiness burst that coincided with the `minify=true` calls, not a parameter-triggered crash. **A 2-of-2 reproduction is not sufficient evidence on an environment known to fail in bursts** — that is the lesson worth keeping.

**The real defect, confirmed by direct comparison:** `minify=true` and `minify=false` return **byte-identical, fully-populated payloads** — same `test_cases` array with all four rows expanded, same `overall_progress`, same everything.

So `minify` is declared, accepted, and **does nothing**. An agent passing it to reduce payload size on a large run gets no reduction and no indication that the parameter was ignored.

Lower severity than a crash, but better evidenced — and it is a genuine declared-vs-actual gap rather than an environment artifact.

## Confirmed correct — the `is_dynamic` outlier is now settled

`filter_test_cases.is_dynamic` came back **boolean** (`false`) on all three runs. Combined with `list_test_runs_v2` (boolean) and `update_test_run_v2` (boolean), that is **three capabilities returning boolean against one returning integer**.

`get_test_plan_test_runs_v2` is conclusively the outlier, so the fix belongs there rather than in the contract. This closes a question open since batch 4.

## Index actions proposed

1. **Fix the shared `test_run` response schema** — remove or correct the 15 over-declared fields, add `filter_test_cases`, `urls`, `links.test_cases`, `test_cases`, `issues`. One change, two-plus capabilities fixed.
2. **Delete the "the integer lives in `uuid`" guidance** and document that no numeric run id is exposed on v2 — plus how to reach the v1 run capabilities, if there is a way.
3. **Correct `assignee` to a nullable string.**
4. **Redeclare `overall_progress`** as a sparse, capitalised, status-keyed map rather than seven fixed lowercase keys.
5. **Correct `test_plans` → `test_plan`** (singular object) with a **string** `id`, and check the rest of the `test_plan` family for the same leak.
6. **Fix or withdraw `minify`** — it is currently accepted and ignored. Either implement it or remove it from the contract, since a parameter that silently does nothing is worse than an absent one. (No product bug here — see the retraction in Finding 7.)
7. **Fix `get_test_plan_test_runs_v2`'s `is_dynamic`** to boolean, matching the other three.
