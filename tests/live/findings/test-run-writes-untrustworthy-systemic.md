# SYSTEMIC — `test_run` write capabilities do not report their own effect truthfully

- **Product / entity:** tm / `test_run` (writes)
- **Scope:** **not one capability** — 4 of the 6 `test_run` write capabilities probed
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`)
- **Consolidated:** 2026-09-18 (batch 6)
- **Per-capability detail:** `assign_test_run_test_cases.md`, `bulk_update_test_run_test_cases.md`, `replace_test_run.md`, `update_test_run.md`

## The claim

**A 2xx from a `test_run` write tells you almost nothing.** Across six write capabilities probed, four failed to report their own effect truthfully, in three distinct ways. Every case was caught only by re-reading storage independently — none was detectable from the response.

## The evidence

| capability | response | what actually happened |
| --- | --- | --- |
| `assign_test_run_test_cases` | `200 {success:true}` | **nothing** — rows unchanged across 2 re-reads |
| `bulk_update_test_run_test_cases` — remove | `202 {success:true, async:true, unique_id}` | **nothing** — unchanged across 3 re-reads over 45 s |
| `bulk_update_test_run_test_cases` — add | `200` | **happened twice** — duplicated an existing mapping, 4 rows → 5 |
| `replace_test_run` | `200` | happened, but the **body misreported the result** |
| `update_test_run` | `200` (×2 writes) | happened, but the **body misreported the result** — same fields |

The two clean capabilities were `clone_test_run` (verified: run count 3 → 4, source untouched) and `export_test_run_csv` (verified: run byte-identical before and after).

## Failure mode 1 — silent no-op

Two write paths return success and do nothing. The async one is worse: `202 {async:true, unique_id}` actively tells a caller the work is in flight, so a well-behaved agent waits for something that was never queued.

## Failure mode 2 — the write response misreports post-write state

`replace_test_run` and `update_test_run` both return bodies that disagree with storage, **on the same three fields**:

| field | write response | storage |
| --- | --- | --- |
| `assignee` | the **pre-write** value | the post-write value |
| `overall_progress` | `{Untested: 4}` | `{Untested: 5}` |
| `updated_at` | a fresh timestamp | **unchanged** — the response's value never existed |

Crucially, **fields the caller sent are reflected correctly**; fields the caller did *not* send come back stale or invented. The response appears to be assembled partly from the request and partly from a pre-write snapshot rather than read back after the write.

`update_test_run` reproduced this across **two independent writes**, and a control read of untouched fixture `TR-9058` stayed static and self-consistent throughout — so it is not preprod noise. Two capabilities spanning PATCH and POST on the same route family makes it entity-wide.

## Failure mode 3 — `updated_at` is never recorded at all

This one is not a response defect and deserves separating.

`TR-9062` received **multiple verified-successful writes** across this batch — a replace and two updates, each confirmed in storage by fields that genuinely changed. Its stored `updated_at` is **still `2026-09-18T06:27:38.743Z`, identical to `created_at`.**

So the API is not merely misreporting the modification time in its response — **it is not persisting one.** Anything downstream that depends on modification time is broken by this: change detection, incremental sync, cache invalidation, optimistic concurrency, audit trails, "recently modified" views.

This is the most serious single finding in the batch, and it is a **product/data-integrity bug**, not a documentation one.

### Scoped to `test_run` — confirmed, not assumed (added 2026-09-18, batch 7)

The obvious worry was that this might be product-wide. **It is not.** A batch-7 probe of `get_test_case_histories` checked the equivalent on the `test_case` side and found timestamps recorded **correctly**: `TC-54458`'s five history entries carry strictly-increasing `created_at` values that are byte-identical across three endpoints (the v2 listing, the v1 listing, and the v1 single-revision read), and they match the actual edits made to that case in batch 5 event for event.

So the modification-time failure is **specific to `test_run`**, which narrows the investigation considerably and means other entities' change-tracking can be trusted until shown otherwise.

## Why this matters more than ordinary drift

Contract drift makes an agent's code wrong in ways that surface immediately — a missing field, a wrong type. **These failures are invisible.** An agent that assigns work, removes a case, or updates a run receives success and proceeds. The suite found every one of these only because it re-read storage after each write, which is not something a normal caller would do.

It also compounds a separate finding: **five capabilities start jobs whose effects cannot be observed through this index at all** (`findings/unobservable-jobs-systemic.md`). Between the two, an agent using this index has **no general way to distinguish a successful write from a no-op** — which undermines the premise that the index describes a usable API surface.

## Actions proposed

1. **Escalate failure modes 1 and 3 to the product team as bugs.** The silent no-ops and the unrecorded `updated_at` are not documentation problems and cannot be fixed in the index.
2. **Fix the write responses to read back from storage** after the write — or omit the fields they cannot report accurately. Returning a `updated_at` that does not exist is worse than returning none.
3. **Until fixed, add guidance to every `test_run` write** telling callers to verify by re-reading rather than trusting the response. That is what this suite had to do, and it is currently the only reliable method.
4. **Audit write capabilities on other entities for the same three failure modes.** They were found here because a whole family was probed together with storage verification; nothing suggests `test_run` is special, and no earlier batch verified writes this systematically.

## Caveats

- **Preprod only.** Production may differ.
- **No backend source or server-side logs** were consulted, so the causes are unestablished. What is established is the request/response pairs plus independent storage re-reads — two for the assign no-op, three across 45 s for the remove no-op, and two-plus per capability for the response-fidelity and `updated_at` findings, each with a control read of an untouched run in the same window.
- The batch also retracted one suspected server fault (`minify=true`) after re-testing showed it was a preprod flakiness burst. The findings above were each held to the stricter standard adopted afterwards: multiple reproductions plus a passing control call.
