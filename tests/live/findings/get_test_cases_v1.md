# get_test_cases_v1 — DRIFT (three documented traps didn't reproduce; two new drifts found instead)

- **Product / entity:** tm / `test_case` (read, list)
- **Environment:** **preprod** (via MCP `invokeCapability`)
- **Probed:** 2026-09-21
- **Run file:** `tests/live/runs/tm/get_test_cases_v1.json`
- **Fixture:** project `379335744` / `PR-2005`, 21 test cases total; `__readonly__` folder 764093 (TC-54455/TC-54456)

## Summary

Three specific behaviours this probe was told to verify — the `all_folders` string-vs-boolean trap, the `per_page` silent-clamp-to-30, and the `sort_by`+`required[fields]` rejection — **did not reproduce** through `invokeCapability`. Two of the three are inconclusive rather than disproved (see below). In their place, two new drifts turned up: **`sort_by=name-ASC` is silently a no-op** while `name-DESC` on the same column works, and **passing `required[fields]` at all suppresses unrelated default fields** (`automation_state`, `tags`) that are present without it. Overall verdict: **DRIFT**.

## 1. `all_folders` string/bool trap — not reproduced, but a different unscoped-read trap found instead

Tested `all_folders: true` (JSON boolean) against `all_folders: "true"` (JSON string): **byte-identical responses**, both the full 21-case project listing with a `folders` block. The claimed strict-string comparison bug does not manifest through this tool.

However, **omitting `all_folders` entirely is its own trap**: it does not return the full 21-case list, and does not come back empty either — it silently returns exactly the 2 cases in the `__readonly__` folder (764093), with `info.count: 2`, and `success: true`. An agent that forgets `all_folders` gets a small, plausible-looking, *wrong* result rather than an obvious signal that scope wasn't applied. This confirms the underlying "missing `all_folders` silently changes scope while claiming success" shape of the reported trap — just not via the string/bool mechanism.

## 2. `per_page` clamp — unfalsifiable through this tool

`per_page: 500` and `per_page: 0` were both rejected **client-side by the MCP tool's own parameter schema** (`'per_page' must be at most 100'` / `'per_page' must be at least 1'`) before reaching the live API. The documented "silently falls back to 30 for any out-of-range value" behaviour of the underlying endpoint could not be observed or disproved this way — the MCP layer's own bounds-check pre-empts it.

In-range values behaved exactly as declared: `per_page: 10` → `info.page_size: 10` (10 rows); `per_page: 100` → `info.page_size: 100` (all 21 rows, single page, `next: null`). No clamping was observed for in-range requests, which is the correct/expected behaviour.

## 3. `sort_by` + `required[fields]` interaction — not reproduced; real bug found instead (name-ASC broken)

The documented rejection ("Sort by column X is not present in required fields") never fired in 5 variants tried — every combination of `sort_by: "name-ASC"` with/without `name` present in `required[fields]`, and with `required[fields]` omitted entirely, returned `200` success.

**But `name-ASC` never actually sorted anything** — row order was identical to the unsorted (id-descending) baseline in all 5 variants, including with a nonexistent sort column (`sort_by: "bogus_col-ASC"`, which also silently no-op'd with `200` instead of the documented 400 listing allowed columns).

**`name-DESC` on the same column, same fixture, DID sort correctly** (descending alphabetically, ties broken consistently). So sorting itself works server-side — `name-ASC` specifically is broken (silently ignored), and malformed sort columns are silently ignored rather than rejected, contrary to guidance in both cases.

## 4. count-vs-rows / pagination — no drift; count is trustworthy here

Deliberately checked given four prior hits elsewhere in this product. Here `info.count` matched reality throughout:

- `per_page=100`: 21 rows returned, `info.count: 21`, single page, `next: null`.
- `per_page=10` walked two pages: page 1 `{page:1, page_size:10, count:21, prev:null, next:2}` (10 rows), page 2 `{page:2, page_size:10, count:21, prev:1, next:3}` (10 rows) — no overlap or gap, `count` stayed fixed at 21 across pages, `next` correctly stayed non-null with 1 row still remaining (not fetched).

This capability is **not** a fifth count-vs-rows hit.

## New, undeclared drift: `required[fields]` silently suppresses unrelated default fields

Not something this probe was asked to check, but visible across every `required[fields]` call: sending `required[fields]` at all — regardless of contents — blanks fields that are otherwise populated on the identical rows. `automation_state` went from a populated object to `null`, and `tags` went from populated arrays to `[]`, purely because `required[fields]` was present in the request. The contract describes `required[fields]` as additive ("extra columns to join"), not as something that suppresses defaults. This is undeclared behaviour worth flagging to the product team alongside the sort bug.

## What matched the contract

- Envelope keys: `success`, `test_cases`, `info`, `folders` — all present as declared.
- `id`/`identifier` typing consistent throughout (integer / `TC-NNN` string), no cross-row inconsistency.
- `estimate` always `null`, matching guidance.
- Pagination (`count`, `page`, `page_size`, `prev`, `next`) internally consistent across pages.

## Declared-vs-actual field gaps

- **Undeclared, returned:** `test_cases[].automation_state` (representative — several other always-present row fields are also undeclared: `is_shared`, `estimated_duration_seconds`, `template_step_type`, `template_id`, `template_name`, `step_count`, `test_run_results_count`, `test_run_results_issues_count`, `test_case_dataset`).
- **Declared, missing:** none found.

## Index actions proposed

1. **Fix or annotate the `all_folders` guidance** — the string/bool distinction did not reproduce through this tool; what does reproduce is that *omitting* `all_folders` silently narrows scope to whatever a bare read defaults to (here, the `__readonly__` folder) while still returning `success: true`. Guidance should describe the omission case concretely, not the string/bool mechanism, unless someone can reproduce the string/bool distinction via a path this probe didn't try (e.g. a different transport than `invokeCapability`).
2. **Report `sort_by=name-ASC` as a product bug**, not an index issue — sorting ascending on `name` is silently ignored while descending works and malformed columns are silently ignored instead of rejected with the documented 400. Needs the product/backend team.
3. **Document that `required[fields]` suppresses unrelated default fields** (`automation_state`, `tags` observed) — currently described as purely additive.
4. **`per_page` clamp claim is untestable via MCP** — the tool's own schema already enforces 1..100, so the underlying endpoint's out-of-range fallback-to-30 behaviour can't be confirmed or denied this way. Note this as a testing-method limitation rather than a pass.
