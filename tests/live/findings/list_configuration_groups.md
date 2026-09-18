# list_configuration_groups — DRIFT

- **Product / entity:** tm / `configuration` (read)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/list_configuration_groups.json`

## Summary

The capability works and returned real, pre-existing account data on the first call, so the item shape was genuinely checkable. **Two declared row fields never appear in the live response.**

This is not a hollow pass caveat — the contract commits to a detailed item shape rather than a thin `{status, body}` passthrough, and most of it matches.

## Declared contract

- No `path_params`, no `body`. Query only: `p` (page, default 1) and `per_page` (default/ceiling 30; values above 300 refused).
- **No project scope at all**, which the guidance states explicitly: *"Nothing here is project-scoped … the same groups come back whichever project the user is working in, and they cannot be filtered to one project."* Confirmed — neither fixture project-id form applies, so there was nothing to test on that axis.
- Declared 200:

```json
{ "success": true,
  "configuration_groups": [ { "id": 0, "name": "", "is_system": false, "group_id": 0,
                              "record_status": "", "created_at": "", "updated_at": "" } ],
  "info": { "page": 1, "page_size": 30, "count": 0, "prev": null, "next": null } }
```

## Actual behaviour

First call (`query: {p:1, per_page:30}`) → **200**, two rows of real pre-existing account data:

| id | name | group_id | is_system | created_at |
| --- | --- | --- | --- | --- |
| 6596 | `CfgGroup_n28g6b` | 3452 | false | 2026-09-11 |
| 6597 | `ScopeTest_xlh4tt` | 3452 | false | 2026-09-11 |

These are leftovers from earlier test activity on this account, not part of the documented fixture pool — which is exactly the right thing to validate against, given this environment's ≥6-day search-indexing lag makes freshly created data unreliable for verification.

**Actual row keys:** `id`, `group_id`, `name`, `is_system`, `created_at`.

## The drift

| declared field | present? |
| --- | --- |
| `record_status` | **absent from every row** |
| `updated_at` | **absent from every row** |

Top-level keys (`success`, `configuration_groups`, `info`) matched the declared schema exactly, and `info`'s pagination shape matched too. No undeclared extra keys were returned.

## Confidence and limits

Both rows were missing the same two fields, consistently. **Only two rows existed on the account**, so this rests on a sample of two — but since both were created independently and neither carries either field, an accidental per-record omission is unlikely. A larger account would confirm it.

Not tested: pagination beyond page 1 (only two rows exist), and the documented `per_page > 300` refusal.

## Side observation — not a drift

`describeCapability` does not return an HTTP method or path for this capability. The probing agent cross-checked `get_configurations_v1` and found the same — method and path are simply not exposed through this MCP surface for named capabilities, which is why this finding, unlike others in the batch, carries no route in its header. That is a property of the surface, not a defect in this contract.

## Index actions proposed

1. **Remove `record_status` and `updated_at` from the declared row shape**, or fix the endpoint to return them. An agent relying on `updated_at` to sort or diff configuration groups would find it absent every time.
2. Worth checking whether the same two fields are over-declared on sibling configuration capabilities, since this looks like a shared serializer description rather than a one-off.

Both are index-side documentation defects. Neither prevents the capability being used.
