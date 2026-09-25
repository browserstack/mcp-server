# create_shared_step — DRIFT

- **Product / entity:** tm / `shared_step` (write, v1)
- **Environment:** preprod
- **Probed:** 2026-09-21, project PR-2005 (379335744)
- **Run file:** `tests/live/runs/tm/create_shared_step.json`
- **Created object:** shared step id **27846**, title `__mcp-probe-sharedstep-20260921` — left at folder root (Unassigned); flag for cleanup.

## Summary

The write itself works cleanly and the steps container is correctly typed on both the request and response side — this capability does **not** reproduce the cross-reader `test_case_steps` object-vs-array defect. The drift is narrower: an undeclared response field, and an error envelope that doesn't match the capability's own declared error schema.

## Pool fact corrected: shared steps already existed

Before writing anything, `get_shared_steps` was invoked against project 379335744 and returned one pre-existing shared step (`__probe-shared-step`, id 27842, 0 linked test cases, 1 step). The id pool's priming note recording `shared_step: null` for this project is **wrong** — this is one of the two known-stale facts in that 3-day-old fixture, now confirmed incorrect rather than merely suspected.

## Steps container — consistent, not the known defect

`shared_step_details` is declared as an **array** in both the request-body contract and the success-response schema (item objects requiring `id`/`step`/`result`/`order`), and the actual create response returned it as an array of one object (id 76580) with all declared fields populated. Declared array, returned array — no mismatch. This means the confirmed `test_case_steps` object-vs-array drift seen on at least three read capabilities does **not** extend to this write/serializer path, at least not for this field. The defect is scoped to the read-side readers, not shared with this write's serializer.

## Drift — undeclared `data.tags` in the success response

`tags` is documented as an accepted request-body input, but the declared 200 response schema's `data` properties do not mention it. The actual create response includes `data.tags: []` regardless. Recommend adding `tags` to the declared response schema (it's already a known field, just missing from the output side of the contract).

## Drift — error envelope doesn't match its own declared shape

The capability declares a 400 error shape of `{success, error:{code, message, details}}`. The actual 400 returned when a bad `folder_id` was supplied was:

```json
{"errors":{"message":"Target folder not found"},"no_toast":false,"success":false}
```

Differences: plural `errors` (not singular `error`), no `code` field at all, and an undocumented `no_toast` boolean. This is consistent with the broader pattern noted elsewhere in this campaign — error-envelope shape declared correctly in only a minority of capabilities probed so far.

## No entitlement-gate-as-200 defect here

Both the failing call (bad folder_id) and the succeeding call returned the correct HTTP status (400 and 200 respectively) — no 200-wrapping-`success:false` refusal was observed on this capability.

## Also worth flagging: `folder_id` is a separate id namespace from test-case folders

The first attempt used the pool's `__scratch__` test-case folder id (764138) and got a 400 "Target folder not found." The capability's own guidance is explicit that shared-field/shared-step folders are a **separate object with a separate id namespace** from test-case folders (confirmed by `list_shared_components`'s guidance). This isn't a contract bug — the guidance says so — but it's a sharp edge: the id pool doesn't carry a valid shared-step-folder id, so any capability in this family that needs one will hit the same wall. Worth a pool addition if more shared-step/shared-field write probes are planned.

## Index actions proposed

1. Add `tags` to the declared 200 response schema's `data` properties (matches an already-declared request-body input).
2. Correct the declared 400 error schema to match actual shape, or confirm with the product team which is intended — `{errors:{message}, no_toast, success}` vs the declared `{success, error:{code, message, details}}`.
3. Consider seeding the id pool with a valid shared-step/shared-field folder id, distinct from the test-case folder namespace, for future writes in this family.
