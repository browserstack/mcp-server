# search_all_projects — DRIFT

- **Product / entity:** tm / `project` (read)
- **Path:** `GET /api/v1/global/search`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-17
- **Run file:** `tests/live/runs/tm/search_all_projects.json`

## Summary

The capability works — it invokes cleanly and returns real, richly-shaped data; no call in the whole probe returned anything but 200 except the deliberate 400 tests. But the declared contract disagrees with reality in three reproducible ways, one of which would actively break a caller.

## Drift 1 — the declared 400 schema contradicts reality (and contradicts the capability's own guidance)

**Declared** (`responses.400.schema`):

```json
{ "success": false, "error": { "code": "...", "message": "...", "details": "..." } }
```

**Actual**, for both a missing `entity` and a blank `q[query]`:

```json
{"error": "No entities provided for search"}
{"error": "No search string provided"}
```

A bare string under `error`. No `success` key. No `code`/`message`/`details` sub-fields.

**This is the finding that matters most**, because the index contradicts *itself*: the capability's prose `guidance` already warns correctly that the body is "a bare `error` message with no `success` key, so do not look for success: false to detect the failure" — while the machine-readable schema block two fields away declares the opposite. An agent branching on `response.success` (which is what the structured schema tells it to do) will mis-handle every 400 from this endpoint.

## Drift 2 — the `report` entity silently ignores `per_page`

| call | `per_page` sent | `test_case` / `test_plan` / `project` | `report` |
| --- | --- | --- | --- |
| 6-entity search | 3 | honoured exactly | `page_size: 30`, ~30 rows |
| isolated | 5 | — | `page_size: 30`, ~30 rows |

Every other entity type honoured `per_page`; `report` always returned 30. The contract documents `per_page` as applying per entity type with a ceiling of 30 and says nothing about `report` being exempt.

## Drift 3 — `report.info` is returned but never declared

The 200 schema for `report` declares only `data`, `scheduled_report_count`, `total_report_count`. Every real response also carried a full pagination `info` block.

## Documented behaviours that were confirmed CORRECT

Worth recording so nobody re-tests them:

- **Entity token vocabulary.** Hyphenated plurals (`test-cases`) are rejected with a 400 naming the invalid token, exactly as documented. The snake_case singular tokens are right.
- **`combine=true` is a preview.** It caps the merged list at 5 rows while `info.count` still reports the true total — observed 21805 across three entity types, precisely as the guidance warns.
  - One unexplained detail: `info.page_size` came back **90**, not 5 or 30. Harmless, but undocumented.

## Note on the fixture — not a contract defect

**Every query targeting `__mcp-capability-fixture__`, its cases ("probe case A" / "probe case B"), its plan or its run returned 200 with zero rows**, across ~10 query variants, both project-scoped and account-wide.

This is almost certainly **search-index lag, not a capability defect**: the pool was seeded at `10:38:10Z` and the probe ran at `10:45:11Z` — the fixture was ~7 minutes old, whereas every hit that *was* returned was ≥6 days old. It is undocumented behaviour but not attributable to this contract.

**The probe did not treat those empty results as a pass.** It used real account-wide data to check the row and `info` shapes instead, which is what surfaced drifts 1–3. This matters: had it asserted only against the fixture, it would have reported an empty-result PASS and found nothing.

**Practical consequence for this suite:** freshly seeded objects are not immediately findable via global search. Any future probe that depends on searching for just-created data needs to account for that lag or assert another way.

## Index actions proposed

1. **Fix the declared 400 schema** to the actual bare `{error: "<string>"}` shape — or, if the product intends to standardise on the enveloped error, fix the API. Right now the index states both and they cannot both be true.
2. **Document `report`'s `per_page` exemption**, or fix the endpoint to honour it.
3. **Add `info` to the declared `report` 200 shape.**
4. Optionally note the `combine=true` `info.page_size: 90` oddity.

All three drifts are index-side documentation defects, not product bugs — with the possible exception of #2, where either the doc or the endpoint could be the thing that's wrong. None of them prevent the capability being used.
