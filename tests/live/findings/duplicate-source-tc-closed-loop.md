# `get_duplicate_source_test_case_v1` — two reads disagree about whether the same duplicate exists

- **Product:** tm · **Capability:** `get_duplicate_source_test_case_v1`
- **Route:** `GET /api/v1/projects/{project_id}/ai-duplicates/{duplicate_id}/source_tc`
- **Environment:** **production**, `Demo Project 1` (332537), 2026-09-22
- **Status:** for the product team. Two separate issues, one cheap and one structural.

## The observation

Production has 10 real duplicate groups from a dedupe scan on 2026-04-02. Taking the first
group's id and calling two sibling reads within the same minute:

| call | result |
| --- | --- |
| `GET /ai-duplicates` | returns the group — `id 1060805`, `ai_score 84.78`, `duplicate_type "semantic"` |
| `GET /ai-duplicates/1060805` | **200** — the full group, `success: true` |
| `GET /ai-duplicates/1060805/source_tc` | **404 `{"success": false, "error": "Duplicate not found."}`** |

## Issue 1 — the message is false, and cheap to fix

The duplicate *is* found. The listing returns it and the single-duplicate read resolves it to a
200 for the same id. "Duplicate not found" sends a caller to check the id, which is the one thing
that is definitely correct. Whatever this route is actually missing, it is not the duplicate.

## Issue 2 — the capability is unreachable by construction

The route resolves only pairs in **merged** state. `list_duplicates_v1` only ever surfaces pairs
in the **unmerged/suggested** state. The two sets are disjoint, so **no sequence of reads in this
index produces an id this route accepts**.

That is why it is now filed BLOCKED rather than UNVERIFIED. UNVERIFIED means "prerequisites
unavailable" and implies a better fixture would close it. A better fixture would not: the only
listing that exists cannot emit a merged pair. Getting one would require merging real duplicates
first — a destructive act the surface refuses — so an agent cannot reach this capability at all.

## Why it was not visible before

The whole duplicate family sat UNVERIFIED because **preprod's dedupe pipeline has never run**
(`get_dedupe_status_v1` → `{status: "NOT_ENABLED", message: "No dedupe job found for this
project"}`, zero pairs in any state). With no pairs, every member of the family failed for the
same uninformative reason and the disjoint-state problem was an inference, not a measurement.
Production has data, and the inference turned out to be right — but only production could show it.

## Suggested next step

Two questions. Whether the listing should expose merged pairs (a `status` filter would do it),
or whether `source_tc` should accept an unmerged id and answer with the suggested base case —
`suggested_base_id` is already on every row the listing returns. And separately, the 404 message
should say what was actually not found.

## Related

- `findings/dedupe-status-disagreement.md` territory: `list_duplicates_v1` reports
  `last_scan_time 2026-04-02` with 10 groups for the same project where `get_dedupe_status_v1`
  simultaneously returns `NOT_ENABLED`. A third disagreement inside the same family.
