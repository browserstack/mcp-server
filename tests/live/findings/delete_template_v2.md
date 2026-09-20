# delete_template_v2 — BLOCKED (on product)

- **Product / entity:** tm / `template` (destructive)
- **Path:** `DELETE /api/v2/templates/{id}`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Probed:** batch 4
- **Sibling:** `create_template_v2` — same entitlement gate on the write side

## Summary

On an unentitled plan the endpoint **answers `200` with `{success: false}` and a paid-feature message, and deletes nothing.**

Two separate things are wrong with that, and they matter to different audiences:

1. **For us:** the capability cannot be verified from this account. The code path that would prove the contract is behind an entitlement we do not hold. That alone is a REFUSED-class outcome, not a defect.
2. **For the product:** the status code is wrong, and that *is* a defect independent of our entitlement. It is why this is filed BLOCKED rather than left as unverifiable.

## The defect: a refusal wearing a success code

HTTP status is the one part of a response every client inspects, including clients that never parse the body. An entitlement refusal is a `402 Payment Required` or a `403 Forbidden`. This returns `200`.

The consequence is not cosmetic. A caller that does the normal thing —

```
if (response.ok)  // 200 → true
  → "template deleted"
```

— is told a destructive operation succeeded when nothing was touched. The refusal is visible **only** in `success: false` inside the body. There is no way to distinguish "deleted" from "silently refused" without reading and trusting that one field.

This is worse on a destructive capability than on a read. A caller who believes a delete succeeded does not retry, does not warn, and may go on to act on the assumption that the template is gone.

### It also collides with a contract weakness we already know about

If `success` is absent from the declared response — and the whole point of the contract gate (AIMCP-219) is that `returns` and the schema disagree about fields exactly like this one — then an agent reading the published contract has **no declared field to check** and no reason to look past the `200`. The undeclared field is the only thing carrying the truth.

This is the same shape as the `false.present?` trap recorded elsewhere in these findings: a boolean that means "no" being indistinguishable from a value that was never set. Here the failure is one level up — a whole response that means "no" being indistinguishable from one that means "yes".

## What was observed

| | |
| --- | --- |
| request | `DELETE /api/v2/templates/{id}` on an unentitled plan |
| status | `200` |
| body | `{success: false, …}` with a paid-feature message |
| effect | none — the template still exists |

## Why BLOCKED and not REFUSED

REFUSED would say *we* declined, or that our account simply cannot reach it — true, but it files the row under our limitation and drops the part that belongs to the product. The status code is wrong for **every** unentitled caller, not just this probe. Filing it BLOCKED puts it in the bucket that gets routed.

Note that the gate itself is correct behaviour: refusing an unentitled delete is right. Only the code is wrong.

## Suggested next step for the product team

Return `402` (or `403`) for the entitlement refusal instead of `200`. If the `200` is load-bearing for an existing client that would break on a 4xx, then `success` must be a **declared, documented, non-optional** field of the response so a caller has something contractual to check — but the status code is the correct fix.

## Index action

The capability's declared responses should carry the entitlement refusal explicitly, whatever code it ends up returning. Right now a contract reader has no indication this outcome exists at all.

## Evidence not gathered

No backend source consulted, so it is not established whether the `200` is deliberate or an artifact of the gate being applied after the controller committed to a success envelope. What is established is the observable: status `200`, `success: false`, nothing deleted.

## Verification status

**Unverifiable from this account.** Confirming the success path needs a run against an entitled plan. The status-code defect above does not depend on that and can be routed now.
