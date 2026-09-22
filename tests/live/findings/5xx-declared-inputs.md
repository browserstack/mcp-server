# A declared input crashes the server — two capabilities, one shape

- **Product:** tm
- **Environment:** originally preprod only; `list_tags_v3` is now confirmed in **production** too (see escalation)
- **Status:** for the product team. Nothing here is fixable from the index.

## The shape

In each case the contract declares an input, a caller supplies exactly that input, and the
server answers **500**. Not a malformed payload, not an undocumented parameter — the
declared vocabulary, used as declared.

> **One entry was removed on 2026-09-22.** `get_test_run_v2` / `minify=true` was listed here as a
> third crash. It should not have been: the underlying finding was **retracted on 2026-09-18**
> (see `findings/get_test_run_v2.md`, Finding 7) as a preprod flakiness burst, and this file was
> never updated to match. A production retest on 2026-09-22 confirms it: **5/5 calls returned
> 200**, `minify=true` included. Nothing to route.

That is what separates these from the ordinary preprod flake recorded at the bottom of this
file: each was **reproduced on retry**. The original test also required a neighbouring value of
the same parameter to return 200, ruling out an environment outage — that control still holds
for `list_test_case_tags_v1`, but `list_tags_v3` has since lost it by failing on every value.

| capability | the declared input | result | control that works |
| --- | --- | --- | --- |
| `list_tags_v3` | **every** `entity_type` value | 500 | **no control left — see escalation below** |
| `list_test_case_tags_v1` | `q=<term>` | 500 Internal Server Error | same call paged without `q` → 200 |

## ESCALATION 2026-09-22 — `list_tags_v3` now fails on every declared input

When this was first recorded, one of five enum values crashed and the other four returned 200;
that contrast was the evidence it was a branch bug rather than an outage.

**That is no longer true.** Re-tested 2026-09-22 across the full enum, with and without paging,
in **both** environments:

| `entity_type` | preprod | production |
| --- | --- | --- |
| `test_case` | 500 | 500 |
| `test_run` | 500 | 500 |
| `test_plan` | 500 | 500 |
| `shared_step` | 500 | 500 |
| `test_recording` | 500 | 500 |

**10 of 10 calls return 500.** The capability is completely unreachable, in production as well
as preprod, and there is no longer a working value to contrast against. Whatever regressed took
the four healthy branches with it.

This raises the priority: it is no longer one bad enum branch on an otherwise working read, it
is a published capability that cannot be called at all. The original single-branch detail is
kept below as the record of what it looked like before.

## 1. `list_tags_v3` — originally only `entity_type=test_recording`

`GET /api/v1/projects/{project_id}/tags/v3?entity_type=test_recording`

`test_recording` is **one of the five `entity_type` enum values the contract declares valid**.
It returns `500 {"type":"server_error","message":"Internal Server Error"}`.

Reproduced on retry with the **identical error-body ETag both times** — a deterministic
crash, not intermittency. The other four enum values (`test_case`, `test_run`, `test_plan`,
`shared_step`) all return 200 against the same project in the same window.

An enum value that is published as valid and cannot be sent is worse than an undocumented
one: the contract actively directs a caller into it.

## 2. `list_test_case_tags_v1` — the `q` filter

`GET /api/v1/projects/{project_id}/test-case/tags-v2?q=<term>`

Returns 500 Internal Server Error consistently with `q`. The same endpoint paged without `q`
(`?p=1`) returns 200 and the expected tag.

**Provenance, stated plainly:** this was found incidentally in `update_tag_v1`'s setup, while
re-checking a discrepancy between two tag listings. This capability is phase 1 and has never
been probed on its own — its `status` column is deliberately left blank. The 500 is directly
evidenced; a full probe of the capability is not claimed.

## What is NOT in this file

Two capabilities recorded 5xx that are **environment intermittency, not defects**, and should
not be routed:

- **`get_test_run_progress_v1`** — null-body 500s on attempts 2-3. An unrelated capability
  (`get_test_runs_v1`) hit the identical null-body 500 in the same window and recovered on its
  own retry; every subsequent call to the progress route returned 200 consistently. Its
  UNVERIFIED verdict is for the ordinary reason (nothing to compare), not the 500.
- **`assign_test_run_test_cases_v2`** — three 500s, all in `setup[0-2]`. Two of those were
  *deliberate control calls on other capabilities* made to establish that the burst was
  preprod-wide. `setup[3]` retried unchanged and returned 200. The probe did the right thing
  and the record proves it.

Both rows carry a `do not route` note in the plan CSV so a later scan for "5xx" does not
re-raise them.

## Why the distinction was worth the effort

A blanket "any 5xx is a product bug" rule would have filed both of those, and the second one
especially — where the evidence of innocence is *in the run record itself*, because the
prober went and proved it. Routing that to the product team would spend their attention on an
outage that had already resolved, and would make the next real finding easier to dismiss.

The test applied here: **reproduced on retry, and a neighbouring input succeeds.**

## Suggested next step for the product team

Two separate crashes, likely two separate causes. The `entity_type` one should be cheap to
locate — a single branch on a declared enum value. Worth checking
whether any spec covers those branches, since the pattern established elsewhere in this
campaign is that **the crashing path is stubbed in the spec**, which is why CI stays green.
