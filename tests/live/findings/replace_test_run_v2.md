# replace_test_run_v2 — DRIFT (the write's own response misreports what it wrote)

- **Product / entity:** tm / `test_run` (write)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — subject `TR-9062`, one partial-body write, verified by two re-reads plus a control
- **Run file:** `tests/live/runs/tm/replace_test_run_v2.json`
- **Related:** `findings/assign_test_run_test_cases_v2.md`, `findings/bulk_update_test_run_test_cases_v2.md`, `findings/get_test_run_v2.md`

## Summary

The write works. **Its 200 response body does not tell the truth about what it wrote** — field-specifically, not as blanket staleness. Plus a destructive omission the contract's own warning list fails to mention.

## Finding 1 — the write response misreports post-write state

A deliberately partial body (`{"description": "...", "tags": ["replace-probe-tag"]}`) returned 200. Comparing that response against two independent `get_test_run_v2` re-reads (one after a delay):

| field | write response echoed | actual storage | verdict |
| --- | --- | --- | --- |
| `assignee` | `"probe-user@example.invalid"` — the **old** value | **`null`** (cleared by the write itself) | **wrong** |
| `overall_progress` | `{Untested: 4}` | `{Untested: 5}` | **wrong** |
| `updated_at` | a fresh `2026-09-18T07:11:25.000Z` | **`06:27:38.743Z`** — unchanged since creation; never persisted | **wrong** |
| `tags` | `["replace-probe-tag"]` | same | correct |
| `description` | as sent | same | correct |

**This is not staleness.** The fields the caller *sent* are reflected correctly; the fields the caller did *not* send are reported at stale-or-invented values. So the response appears to be assembled partly from the request and partly from a pre-write snapshot, rather than read back from storage after the write.

The `updated_at` case is the sharpest: the response advertises a timestamp that **does not exist in storage at all**. A caller using it for optimistic concurrency, cache invalidation or change detection would be working from a fabricated value.

**Consequence for an agent:** the single most natural thing to do after a write — read the response to learn the new state — produces wrong answers here, and precisely for the fields a replace is most likely to have changed. An agent would conclude the assignee survived when the write had just destroyed it.

Preprod was healthy in this window (a control read of untouched fixture `TR-9058` returned normal data), so this is not server intermittency.

## Finding 2 — `assignee` is cleared by omission, and the contract's own warning list omits it

The capability's stated intent is that *"every field you leave out is reset"*, and the guidance carries an explicit **omission-warning bullet list** — which names `run_state`, `test_plan_id`/`sub_test_plan_id` and `issues`, but **not `assignee`**.

Omitting `assignee` silently cleared it to `null`. The general statement covers it; the specific warning list, which is what a caller actually scans before a destructive call, does not. Data loss the contract half-warns about is close to not warning at all.

## Finding 3 — "replace" does not replace the row set

All **5 rows survived untouched**, including the accidental `TC-54457` duplicate (both `latest_result_id` 2150387252 and 2150387283), confirmed by two independent re-reads. Membership is **union-only**: omitting `test_cases` / `folder_ids` / `include_all` touches nothing. This matches the contract's own guidance — so it is documented, not drift — but it is worth stating because the name suggests otherwise.

**The family is inconsistent on this**, which is the interesting part:

| capability | same source run, same duplicate |
| --- | --- |
| `replace_test_run_v2` | **preserves** all 5 rows, duplicate included |
| `clone_test_run_v2` | **dedupes** to 4, re-deriving the case list |
| `bulk_update_test_run_test_cases_v2` (remove) | **no-ops** — cannot remove rows at all |

So of three capabilities that could plausibly normalise a run's membership, the one named "replace" preserves, the one named "clone" rebuilds, and the one that exists to remove does nothing. An agent has no way to predict this from the names.

## Finding 4 — one addition to the entity-wide catalogue

An undeclared **`issues` array** (`[]`) is returned by both this write **and** `get_test_run_v2`. Since it appears on two capabilities it looks entity-wide rather than endpoint-specific, and it was not in the previously catalogued list — adding it to the shared-schema fix.

## Known entity-wide drift, recorded not re-litigated

The 15 declared-but-absent fields and the undeclared `filter_test_cases` / `urls` / `links.test_cases` all appeared exactly as catalogued on `create_test_run_v2` and `get_test_run_v2`; `assignee` again a plain string despite being declared an object; `overall_progress` again a sparse capitalised map. Fix once at the shared schema — see `findings/get_test_run_v2.md`.

## How this fits the batch's worst pattern

Four of six `test_run` write capabilities now fail to tell a caller the truth about their own effect:

| capability | response | reality |
| --- | --- | --- |
| `assign_test_run_test_cases_v2` | `200 {success:true}` | nothing happened |
| `bulk_update_test_run_test_cases_v2` (remove) | `202 {success:true, async:true}` | nothing happened |
| `bulk_update_test_run_test_cases_v2` (add) | 200 | happened *twice* — duplicated a row |
| **`replace_test_run_v2`** | 200 | happened, but **the body misreports the result** |

Every one was caught only by an independent storage re-read. **There is no way, from inside a response, to tell a successful write in this family from a failed or misreported one.**

## Index actions proposed

1. **Escalate the response-fidelity bug to the product team.** The write response should be read back from storage after the write, or those fields should be omitted rather than returned wrong. Returning a non-existent `updated_at` is the most damaging part.
2. **Add `assignee` to the omission-warning list** — and audit that list against the full set of fields the endpoint actually resets.
3. **Document the family's membership inconsistency** (preserve vs dedupe vs no-op) somewhere a caller will see before choosing a capability.
4. **Add `issues` to the shared `test_run` response schema.**
5. **Until the fidelity bug is fixed, add guidance telling callers to re-read after a write** rather than trusting the response — which is what this suite has had to do throughout.

## Post-state

`TR-9062`: `description` `<p>replace-probe-partial-description</p>` (note the API wraps plain input in `<p>` tags), `assignee` `null`, `tags` `["replace-probe-tag"]`, `run_state`/`active_state`/`configurations`/plan-linkage unchanged, same 5 rows including the duplicate, run intact.
