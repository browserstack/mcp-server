# create_filter — DRIFT (response shape disagrees with the declared 200 schema)

- **Product / entity:** tm / `filter` (write, create)
- **Environment:** **preprod** (via MCP `invokeCapability`)
- **Probed:** 2026-09-21
- **Run file:** `tests/live/runs/tm/create_filter.json`
- **Fixture:** project `379335744` / `PR-2005`, first saved filter ever created in this project

## Summary

The create itself works cleanly and on the first attempt — the documented flat body shape (`name`, `entity`, `is_project_level`, `filters`, no wrapper object) is accurate, and a minimal testcase-scoped `filters` value round-tripped correctly. The **request side of the contract is accurate**. The **response side has three concrete disagreements** with the declared 200 schema: a renamed field, two undeclared fields, and one type mismatch. Overall verdict: **DRIFT**.

## What was invoked

```
invokeCapability(name="create_filter", product="tm",
  path_params={"project_id": 379335744},
  body={
    "name": "__mcp-probe-filter-20260921",
    "entity": "testcase",
    "is_project_level": false,
    "filters": {"priority": ["P1"]}
  })
```

Response (200):

```json
{
  "data": {
    "created_at": "2026-09-21T13:30:22.460Z",
    "updated_at": "2026-09-21T13:30:22.460Z",
    "record_status": "active",
    "id": 542,
    "project_id": "379335744",
    "entity_type": "testcase",
    "name": "__mcp-probe-filter-20260921",
    "owner_id": 6013,
    "is_project_level": false,
    "filters": { "priority": ["P1"] },
    "group_id": 3452
  },
  "success": true
}
```

Created filter: **id `542`**, name `__mcp-probe-filter-20260921`, entity `testcase`, project `379335744` — the first saved filter in this project. Safe to delete via `delete_filter` in cleanup.

## What matched the contract

- Body shape: flat, no wrapper — exactly as the guidance states ("The body is flat — there is no wrapper object").
- Required fields (`name`, `entity`, `filters`) behaved as declared; `is_project_level` defaulted/accepted a real boolean.
- The `entity` request enum (`testcase, testplan, testrun, exploratory_session, test_plan_test_case`) is enforced client-side by the MCP tool itself before any HTTP call — confirmed by deliberately sending `entity: "test-plans"`, which was rejected with `{"ok":false,"error":"'entity' must be one of: testcase, testplan, testrun, exploratory_session, test_plan_test_case"}` and no request ever reached the server.
- `filters: {"priority": ["P1"]}` was accepted and echoed back verbatim in `data.filters`.

## Declared-vs-actual field gaps (the drift)

1. **Renamed field**: contract declares `data.owner` (integer, "User ID of the creator"). The actual response has no `owner` key at all — instead there is `data.owner_id` (6013). Same concept, different key name; an agent reading the contract and looking for `owner` on the response will not find it.
2. **Undeclared fields, always present**: `data.record_status` ("active") and `data.group_id` (3452) appear on every create and are not mentioned anywhere in the declared 200 schema.
3. **Type mismatch**: `data.project_id` is declared `type: integer`. The actual value is the JSON string `"379335744"`, not a number — even though the request's `path_params.project_id` was sent as an integer.
4. **Minor internal inconsistency** (contract-vs-contract, not response-vs-contract): the request-side `entity` enum has 5 values, but the declared response's `data.entity_type` enum only lists 3 (`testcase, testplan, testrun`) — it's silent on what `exploratory_session` and `test_plan_test_case` echo back as. Not exercised in this probe (the successful create used `testcase`, which is in both enums), but worth a look since it's an easy fix (just make the two enums agree) or a clue that the two other entity values behave differently on create.

## Not covered by this probe

- No error responses were observed. The primary create succeeded on the first attempt, and the entity-enum experiment (`entity: "test-plans"`) was rejected client-side by the MCP tool before any HTTP request was made — so none of the declared 400/401/403/422/500 error envelopes could be checked against a real error body here.
- The `filters` field's own inner schema is undocumented (declared as a bare `{"type":"object"}` with no properties). Guidance text makes several claims about it (empty `{}` silently rejected downstream as "Filters cannot be empty"; conditions on nonexistent custom fields accepted at write time then silently pruned on first read) that were not independently re-tested here beyond confirming one concrete shape (`{"priority":["P1"]}`) round-trips correctly.

## Entity grouping note (filter)

create_filter's actual behavior — a project-scoped, ungated, standalone saved-view object with its own `id`/`group_id` identity — fits the `filter` entity grouping well; nothing about it suggests it belongs elsewhere. This is a separate question from the previously-flagged placement of `get_entity_filter_details_v1` under `project` instead of `filter`: that capability *resolves* a filter reference (a read/lookup keyed by entity+id) rather than operating on the filter object itself, so its placement is a distinct issue. `filter` as a grouping holds together fine for the CRUD family actually filed under it.

## Index actions proposed

1. Rename the declared response field `owner` to `owner_id` (or otherwise reconcile with the actual key) in create_filter's 200 schema.
2. Add `record_status` and `group_id` to the declared 200 schema, or note them as undocumented-but-always-present.
3. Fix the declared type of `data.project_id` from `integer` to `string` (or document that the API stringifies it on the way out even though it's accepted as an integer on the way in).
4. Reconcile the request-side `entity` enum (5 values) with the response-side `data.entity_type` enum (3 values) — either the response enum is incomplete, or `exploratory_session`/`test_plan_test_case` produce a different response shape worth documenting separately.
