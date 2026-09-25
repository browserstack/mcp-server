# bulk_update_test_run_test_cases — DRIFT (high severity, functional)

- **Product / entity:** tm / `test_run` (write — case membership, add/remove)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — subject run `TR-9062`
- **Run file:** `tests/live/runs/tm/bulk_update_test_run_test_cases.json`
- **Related:** `findings/assign_test_run_test_cases.md` — the same silent-success failure mode

## What this capability actually is

Worth stating up front, because the probe brief got it wrong: its body has exactly three fields — `add_test_cases`, `remove_test_cases`, `preserve_existing_results`. **It is a case-membership endpoint, not a status setter.** There is no status field and no `execution_id` parameter, so the `execution_id` integer/string catch-22 that makes its sibling `assign_test_run_test_cases` unusable does **not** apply here. Rows are addressed by `test_case_ids` (`TC-NNN` strings) plus optional integer `configuration_ids`.

(The probe was briefed to "set a status on two rows"; it read the contract, reported that no such mechanism exists, and adapted to exercise the real function. That was the correct response to an incorrect instruction.)

## Drift 1 — `add_test_cases` duplicates rather than targeting

The guidance states that omitting `configuration_ids` **"targets the null-configuration mapping."**

`add_test_cases` was called for `TC-54457`, which was **already mapped** with `configuration_id: null`. Instead of no-op'ing or updating that existing mapping, the API created a **second, independent null-config mapping** for the same case — a new `latest_result_id` (2150387283) and a new `execution_id` — silently taking the run from **4 rows to 5**.

So "targets the null-configuration mapping" is false: it does not target the existing mapping, it creates another one. A caller re-adding a case it already has — an easy thing to do idempotently-minded — silently duplicates it.

## Drift 2 — `remove_test_cases` is a silent no-op

Attempting to undo the duplicate, `remove_test_cases` was called for `TC-54457` **twice** — once plain, once with `configuration_ids: []`. Both returned the **documented** success shape:

```json
202 {"success": true, "async": true, "unique_id": "..."}
```

Storage was then re-read **three times over 45+ seconds** (to allow for the declared asynchrony): **zero change.** Both `TC-54457` mappings present, untouched, identical timestamps.

The asynchrony is the aggravating factor here. `assign_test_run_test_cases`'s no-op at least returns a synchronous 200 that a caller might think to verify. This one returns `async: true` with a `unique_id`, which actively tells the caller "this is in flight, check later" — and there is nothing to check, because nothing was queued. A caller waiting patiently waits forever.

## The pattern: silent-success writes in the test_run family

This is the **second** write capability in this batch to report success and do nothing:

| capability | response | actual effect |
| --- | --- | --- |
| `assign_test_run_test_cases` | `200 {success:true}` | none — rows unchanged (2 re-reads) |
| `bulk_update_test_run_test_cases` (remove) | `202 {success:true, async:true, unique_id}` | none — rows unchanged (3 re-reads, 45 s) |

Both were caught only by independent storage re-reads. Neither would be detectable from the response. **For an agent, this is the worst failure mode in the suite**: a BLOCKED capability announces itself, a drifted response can be worked around, but a write that lies about succeeding corrupts whatever the agent does next.

Two of the six `test_run` write capabilities exhibiting it suggests checking the remaining four specifically for the same thing, rather than assuming a 2xx means anything.

## An unintended state change — reported, not hidden

The duplicate could **not** be undone, because the removal path does not work. `TR-9062` therefore ended this probe with **5 rows instead of 4**:

| case | `latest_result_id` | note |
| --- | --- | --- |
| `TC-54457` | 2150387252 | original |
| `TC-54457` | **2150387283** | **accidental duplicate** |
| `TC-54458` | 2150387254 | untouched |
| `TC-54455` | 2150387253 | untouched (readonly fixture case) |
| `TC-54456` | 2150387251 | untouched (readonly fixture case) |

All five `untested` and unassigned; the run itself intact, not closed or deleted. The drift from 4 → 5 was caused entirely by a documented call behaving contrary to its documentation, and the cleanup path being non-functional. Downstream probes were told.

**No underlying test case was modified** — `TC-54455`/`TC-54456` are attached only as run-owned rows.

## Environment and harness notes

- One status-0 preprod burst on `list_test_run_test_cases` was confirmed as environment noise via a successful `list_test_runs` control call, then succeeded on unchanged retry. Correct handling under the standard adopted after a retraction earlier in this batch.
- The probe's **first** attempt (removing `TC-54457` + `TC-54458` together) was refused by the local Claude Code auto-mode permission classifier ("Modify Shared Resources") **before reaching preprod**. That is a client-side safety gate, not evidence about the API, and was recorded separately from the live attempts.

## Index actions proposed

1. **Correct the `add_test_cases` guidance.** It does not target an existing null-config mapping; it creates a duplicate. Either document that, or fix the endpoint to be idempotent — the latter is almost certainly what callers expect.
2. **Investigate `remove_test_cases` as a product bug.** A `202 {async:true}` that queues nothing is worse than an error. If removal requires a `configuration_ids` value that neither the contract nor the row data makes discoverable, that needs documenting; if it is simply broken, it needs fixing.
3. **Audit the remaining `test_run` write capabilities for silent success** — two of six confirmed so far.
4. **Document how to remove a duplicated mapping**, since the natural path does not work and a duplicate cannot currently be cleaned up through the index at all.

## What this evidence cannot settle

No backend source or logs were consulted, so **why** the removal no-ops is unknown — an unimplemented async worker, a silently-dropped parameter, or a matching rule that needs a configuration id the caller cannot supply are all consistent with what was seen. What is established is the request/response pairs plus three independent storage re-reads across 45 seconds.
