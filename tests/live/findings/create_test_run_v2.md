# create_test_run_v2 — DRIFT (including a true `create_root_folder_v1`-class defect)

- **Product / entity:** tm / `test_run` (write)
- **Path:** `POST /api/v2/projects/{project_id}/test-runs`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — 3 attempts
- **Run file:** `tests/live/runs/tm/create_test_run_v2.json`
- **Related:** `findings/create_test_plan_v2.md` (the wrapper-guidance class), `findings/error-envelopes-systemic.md`

## Summary

Three distinct defects, one of them the most serious kind this exercise exists to find: **a declared request parameter whose shape the API rejects.** Plus the largest response drift in the suite so far — **15 declared fields that never arrive**.

## Drift 1 — the declared `test_cases` shape is wrong (the create_root_folder_v1 class)

The contract declares `test_cases` as an **array of `{test_case_id}` objects**. The API requires an **array of bare `TC-NNN` strings**.

| # | `test_cases` sent | result |
| --- | --- | --- |
| 2 | `[{test_case_id: "TC-54457"}, …]` — **exactly as declared** | **400** `Invalid JSON data`, validator errors at `#/test_run/test_cases/0..3`: *"did not match type: string"* |
| 3 | `["TC-54457","TC-54458","TC-54455","TC-54456"]` | **200**, run `TR-9062` created |

**This is materially different from the seven "wrapper guidance" cases found earlier in this suite.** Those were prose telling a caller to nest a body that `invokeCapability` wants flat — a surface-convention confusion, where the declared *parameters* were correct. Here the declared parameter's own **type** is wrong: the tool passed it through faithfully and the API rejected it.

That is precisely the `create_root_folder_v1` defect — a published capability whose declared request shape cannot work — and it is the first true instance this suite has found. An agent following the contract exactly cannot create a test run with test cases.

## A bonus: the error proves how `json_path` actually works

The attempt-2 validator errors are addressed to **`#/test_run/test_cases/0..3`** — a path the caller never sent, because the body went flat. This is direct server-side confirmation of the model this suite has been asserting across eight capabilities: **`invokeCapability` accepts flat fields and re-nests them under the declared `json_path` before dispatch.**

Worth recording as evidence in its own right. It means the wrapper guidance found on `create_test_plan_v2`, `rename_folder_v2`, `create_sub_test_plan_v2` and others is not merely unhelpful — it describes the *post-mapping* HTTP body, and presenting that to a caller as a calling instruction is the mistake.

## Drift 2 — 15 declared fields never returned

The nested 200 schema promises, and the response omits entirely:

`id`, `uuid`, `type`, `owner`, `environment`, `overall_progress`, `overall_progress_by_status_id`, `test_cases_count`, `is_automation`, `observability_url`, `metadata`, `assignee_imported`, `is_dynamic`, `test_plans`, `self_ui_link`, `links.detail`

This is the **largest response drift recorded in the suite**.

> **Answered (added 2026-09-18): it is entity-wide, and it is one fix.** The sibling `get_test_run_v2` probe checked all 15 by name across **three** runs (`TR-9062`, `TR-9061`, `TR-9058`) and found **every one of them absent there too** — an identical gap list from an independent read on independent records. That rules out a create-response projection gap and points at a **shared, over-declared `test_run` response schema**. Correct the shared schema once and both capabilities come right together; do not patch per-endpoint. Same shape of problem as batch 4's `test_plan` family, where all five operations drifted in concert. See `findings/get_test_run_v2.md`.

Conversely, three fields are **returned but absent from the nested schema**: `filter_test_cases`, `urls`, `links.test_cases` (covered only by the unreliable flat `returns` array).

## Drift 3 — `assignee` declared an object, returned a string

Declared as an object; actually returned as the plain email string `"ing@bsstag.com"`. A typed client deserialising it as an object breaks.

This is the fourth instance in the suite of a declared type not matching reality, after `is_dynamic` (bool vs int across endpoints), `cases_count` (`null` vs `0`), and `projectVisibilityBanner` (`null` vs object).

## Drift 4 — the wrapper guidance, for the eighth time

Guidance says "every field goes inside a `test_run` object." Attempt 1 did exactly that and was rejected **client-side**:

```
unknown body: test_run. accepted: assignee, configuration_map, ...
```

Consolidated in `findings/create_test_plan_v2.md`; counted here only as another instance.

## No numeric run id exists anywhere on the v2 surface

Confirmed across three capabilities — the create response, `list_test_runs_v2`, and `get_test_run_test_cases_v2` all omit any numeric/uuid run id, and `list_test_runs_v2`'s own guidance admits its serializer emits none.

**One serializer produces malformed URLs because of it.** The sibling `get_test_run_test_cases_v2` probe found each row's `urls.self` comes back with an **empty path segment where the run id belongs**:

```
.../test-runs//1975349/2150387254
              ^^ run id missing
```

**Scoped by direct check (2026-09-18):** this is **specific to `get_test_run_test_cases_v2`**, not general. The orchestrator called `get_test_run_v2` directly and its embedded `test_cases[].urls.self` values are well-formed, with the identifier populated — `.../test-runs/TR-9062/1975349/2150387254`. So that endpoint interpolates `TR-NNNN` where the other leaves a hole. A localised bug in one serializer, worth fixing there.

**Consequence, stated accurately:** v1 run capabilities need the numeric id, and the v2 surface does not expose it — **but they are still reachable.** The `get_test_run_progress_v1` probe resolved `TR-9062` → `17575382` via **`get_test_runs_v1`**, so a v1 listing call bridges the gap. (It also found that route accepts the `TR-NNNN` form directly, making the bridge unnecessary in that case.) The defect is the missing id on v2 and the misleading guidance about it — **not** an unreachable v1 surface, which is how this finding originally overstated it. The `get_test_run_progress_v1` probe was asked to test exactly this — if the id cannot be resolved through any capability in the index, a whole v1 surface is unreachable from v2-created objects. (For reference, batch 1's `TR-9061` pairs with numeric `17574995`, so the ids do exist; the question is whether they are *obtainable*.)

## Verified against storage

`list_test_runs_v2` on `PR-2005` before and after: **2 runs → 3**, with `TR-9062` present. `get_test_run_test_cases_v2` confirmed all four requested cases actually landed, synchronously — no `202`/build-pending state was observed. Not trusted from the echo. Global search was not used (≥6-day indexing lag).

## Fixture safety note

`TR-9062` deliberately includes the two `__readonly__` cases `TC-54455` / `TC-54456` alongside the scratch cases, to give the assign/bulk-update siblings more rows. **They are attached only as run-owned test-run-test-case records**; status/assignee writes by later probes modify those rows, never the underlying cases. Row ids: `TC-54457`→2150387252, `TC-54458`→2150387254, `TC-54455`→2150387253, `TC-54456`→2150387251.

> **Correction (added 2026-09-18).** This finding originally described the row id as "recoverable only via each row's `urls.self`". That is true of **this create response**, but not of the family: the sibling `get_test_run_test_cases_v2` probe confirmed `latest_result_id` is a **declared, top-level, directly-returned integer** on every row there, and that capability's own guidance says to use it. So the awkward URL-parsing is a create-response gap, not a general one — which narrows the fix.

## Index actions proposed

1. **Fix `test_cases` to an array of `TC-NNN` strings.** Highest priority — it makes the documented call impossible today.
2. **Reconcile the 15 missing fields** — pending the `get_test_run_v2` result, most likely by removing them from a shared `test_run` response schema that over-declares. Do not fix per-endpoint until that comparison is in.
3. **Declare `filter_test_cases`, `urls`, `links.test_cases`** in the nested schema.
4. **Correct `assignee` to a string**, or have the endpoint return the object.
5. **Delete the "wrap in a `test_run` object" guidance** — part of the suite-wide wrapper audit.
6. **Document that no numeric run id is available on the v2 surface**, and say how a caller reaches the v1 run capabilities.

## Residue

Run **`TR-9062`** in `PR-2005` with four attached cases. Six sibling probes operate on it; it will end the batch cloned, reassigned, bulk-updated, replaced and updated.
