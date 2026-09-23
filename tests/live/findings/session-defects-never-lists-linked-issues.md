# `list_exploratory_session_defects` never lists SESSION-level issue links — only log-level ones

- **Product:** tm · **Capability:** `list_exploratory_session_defects`
- **Environment:** preprod, then confirmed and narrowed on **production**, 2026-09-23
- **Status:** for the product team. Reclassified from "prerequisite unobtainable" — the
  prerequisite now exists and the endpoint still returns empty.

## Why this was not findable before

The capability sat UNVERIFIED for the whole campaign for an honest reason: no project anyone had
access to contained an exploratory session with a defect on it, so the empty response proved
nothing. The verdict was "prerequisite unobtainable", which was correct at the time.

**The prerequisite is now obtainable.** `create_exploratory_session` accepts an `issues` array,
so a session with a linked issue can be created directly.

## The measurement

Created a session with one linked issue:

```
POST /exploratory-sessions   {"exploratory_session": {"title": "…",
      "issues": [{"issue_id": "PROBE-1", "issue_type": "jira", "metadata": {…}}]}}
→ 201, and the create echoes the issue back
```

**The link persists.** Reading the session back, minutes later, still shows it — with a real
stored id, so this is a row in the database and not an echo of the request:

```
GET /exploratory-sessions/839
→ issues: [{"id": 854319, "issue_id": "PROBE-1", "issue_type": "jira",
            "created_at": "2026-09-23T06:41:01.000Z"}]
```

The defects listing for that same session returns nothing:

```
GET /exploratory-sessions/839/defects?p=1   →  200 {"defects": [], …}
```

Polled **ten times over ~76 seconds**, well past any reasonable async window — the capability's
own guidance warns that defect links are applied asynchronously and says to retry rather than
conclude failure, which is exactly what was done. Still zero.

A sweep of **all 30 sessions** in the project found **no session with a single defect row**,
including the one whose linked issue is visible in its own detail read.

## What the contract claims

> "This is the session-wide view: rows carry entity_type and entity_id, so the list can include
> both links made on the session itself and links made on individual log entries."

Links made on the session itself are the case tested here, and they do not appear.

## The other route could not be tested

Linking a defect through a session **log** is the other path the guidance describes. It could not
be exercised: `create_exploratory_session_log` returns **500** on this fixture, which is a
separate known failure already on record. So the log-linked branch remains genuinely unverified —
this finding is scoped to session-level links only, and says nothing about log-level ones.

## Also worth knowing: there is no project-wide defect view

`list_exploratory_session_defects` is the **only** defect-listing capability in the index, and it
requires a `session_id`. Answering "what defects exist in this project" means listing sessions and
fanning out one request per session — an N+1 walk with no filters, since the endpoint supports no
status, tracker or date narrowing and ignores `per_page` (fixed at 30). `get_issues_count_info_v1`
returns dashboard counts but no rows.

## Suggested next step

Two questions: whether session-level `issues` are meant to surface in the `/defects` listing at
all, and if not, which capability is supposed to return them. Today they are readable only by
reading the session itself, which contradicts the guidance and leaves the listing with no
demonstrable purpose.

## CORRECTION 2026-09-23 — the capability works; the defect is narrower than first written

The section above was written from preprod, where only the session-level link could be tested
because `create_exploratory_session_log` returns 500 there. It concluded the listing "returns
nothing". **That overstated it.**

On production, both links were seeded on a single session and read back immediately:

| link made on | id | appears in `/defects`? |
| --- | --- | --- |
| the **session** (`issues` on create) | 58151011 | **no** — never, at any point |
| a session **log** (`defects` on the log) | 58151012 | **yes** — on the first read, no async wait |

So the capability is not broken. It lists log-level defects correctly and promptly. What it does
not do — and what its own guidance claims it does — is include links made on the session itself:

> "the list can include both links made on the session itself and links made on individual log
> entries"

That sentence is wrong. Session-level issues persist, are readable from the session's own detail
with a real stored id, and never reach this endpoint.

## A second defect found in the same test: the row is a quarter of what was promised

The contract described a full issue-link record and enumerated thirteen fields. The actual row
has **four**:

```json
{"issue_id": "PROBE-2", "issue_type": "jira", "jira_id": "PROBE-2",
 "created_at": "2026-09-23T06:49:54.000Z"}
```

Missing: `id`, `entity_type`, `entity_id`, `entity_uuid`, `issue_status`, `priority`,
`record_status`, `project_id`, `metadata`, `updated_at`. Undeclared and present: `jira_id`.

`entity_type` and `entity_id` are the notable losses — the old guidance told callers to read them
to tell a session link from a log link. They are not returned, so that distinction cannot be made
from this response at all, which is consistent with only one of the two kinds ever appearing.

**Index corrected in v1.37**: the row is declared as its real four fields, `returns` trimmed from
sixteen entries to seven, and the guidance now leads with the session-vs-log limitation. Re-probed
after the fix: 4/4, declared and actual agree exactly.

## What the product team should decide

Whether session-level `issues` are meant to appear here. If yes, this is a missing join. If no,
the guidance sentence should go and the capability should be named for what it does — list a
session's *log* defects.
