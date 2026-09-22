# `get_filter` silently destroys data — on a read

- **Product:** tm
- **Environment:** preprod (`test-management-preprod.bsstag.com`)
- **Status:** for the product team. This is the most serious behaviour found in the writes phase.

## What happens

`get_filter` is a **read**. Reading a saved filter that contains a condition on a
**custom field that no longer exists** causes the server to rewrite the stored filter,
dropping that condition permanently. The caller is not told.

Reproduced directly:

1. `update_filter` on filter 542 wrote `filters.customFields: {"999999": ["stale_value"]}`.
   It **persisted verbatim** — the write is not the problem.
2. A subsequent `get_filter` returned `customFields: {}`.
3. A second `get_filter` confirmed it stays gone, and `updated_at` had **bumped purely from
   the read's own write-back**.

That bumped `updated_at` is the proof this is a write, not a display-time filter. A read that
only *hid* the stale condition would leave the record alone.

## Why this is worse than an ordinary defect

**A read is the one operation a caller is entitled to treat as safe.** Every convention in
every client — retries, prefetching, speculative loads, "just refresh it and see" — assumes
reads are idempotent and non-destructive. An agent inspecting a filter before deciding whether
to touch it has, by inspecting it, already changed it.

It is also **irreversible through this contract**. There is no capability that restores a
pruned condition, and the caller has no way to learn what was removed: the value is gone from
the response it is looking at, and the previous value was never returned to it.

The blast radius scales with how stale a workspace is. A project that has deleted custom
fields over time may have many saved views carrying conditions on them, and a single pass of
anything that enumerates filters — a UI listing, a sync job, a migration audit — silently
prunes every one it touches.

## Related, same capability family

`update_filter` has a second defect found in the same probe: the **`entity` field is inert**.
Sending any `entity` value — including one inside the declared response enum — returns
`200 {success: true}` and changes nothing. `entity_type` stays as it was and `updated_at` does
not move, while another field changed in the *same request* persists normally. The capability's
own guidance says sending a different value "repoints the saved view at another list type."
That is empirically false.

These two share a shape worth naming: **the response says success and the data says otherwise.**
That is a different and quieter failure than the entitlement-gate pattern recorded elsewhere in
these findings, where at least `success: false` appears in the body.

## Suggested next step for the product team

Pruning stale conditions is defensible; doing it during a **GET**, without telling the caller,
is not. Either prune on write, or return the filter with the stale condition marked (a
`stale: true` flag, or a warnings array) and leave storage alone. If the prune-on-read is
load-bearing for the UI, it should at minimum be reported in the response so a caller can log
what it lost.

For `entity`: either honour it or reject it with a 4xx. Accepting a field and discarding it
under a success code is the worst of the three options, and the guidance should not describe
behaviour the endpoint does not have.

## Evidence

Filter 542, project 379335744 (PR-2005), 2026-09-21. Full request/response trace in
`tests/live/runs/tm/update_filter.json`. No backend source was consulted, so the mechanism
behind the prune is not established — only the observable: written, read, gone, `updated_at`
advanced by the read.
