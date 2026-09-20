# A declared input crashes the server — three capabilities, one shape

- **Product:** tm
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Status:** for the product team. Nothing here is fixable from the index.

## The shape

In each case the contract declares an input, a caller supplies exactly that input, and the
server answers **500**. Not a malformed payload, not an undocumented parameter — the
declared vocabulary, used as declared.

That is what separates these from the ordinary preprod flake recorded at the bottom of this
file: each was **reproduced on retry**, and in each case a neighbouring value of the same
parameter returns 200, which rules out an environment outage.

| capability | the declared input | result | control that works |
| --- | --- | --- | --- |
| `get_test_run_v2` | `minify=true` | 500, **null body** | default query → 200 |
| `list_tags_v3` | `entity_type=test_recording` | 500 `{type:server_error}` | other 4 enum values → 200 |
| `list_test_case_tags_v1` | `q=<term>` | 500 Internal Server Error | same call paged without `q` → 200 |

## 1. `get_test_run_v2` — `minify=true`

`GET /api/v2/projects/{project_id}/test-runs/{test_run_id}?minify=true`

Two identical attempts, both **500 with a literally null body** — no envelope at all, which
does not match the capability's own declared 500 schema of
`{success:false, error:{code,message,details}}`. The probe's note is explicit: *"reproduced
on retry — this is a real server error, not the preprod status-0 flake."*

Dropping `minify` and reissuing the unqualified request returned 200, and the rest of the
probe ran on the default query. So the response *shape* was verified; it is the declared
option that crashes.

**Two defects here, not one.** The crash, and the fact that the 500 does not carry the error
envelope the contract promises — a caller with error handling built against the declared
schema gets `null` and fails a second time trying to read `error.code`.

## 2. `list_tags_v3` — `entity_type=test_recording`

`GET /api/v1/projects/{project_id}/tags/v3?entity_type=test_recording`

`test_recording` is **one of the five `entity_type` enum values the contract declares valid**.
It returns `500 {"type":"server_error","message":"Internal Server Error"}`.

Reproduced on retry with the **identical error-body ETag both times** — a deterministic
crash, not intermittency. The other four enum values (`test_case`, `test_run`, `test_plan`,
`shared_step`) all return 200 against the same project in the same window.

An enum value that is published as valid and cannot be sent is worse than an undocumented
one: the contract actively directs a caller into it.

## 3. `list_test_case_tags_v1` — the `q` filter

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

Three separate crashes, likely three separate causes. The `minify` and `entity_type` ones
should be cheap to locate — both are a single branch on a declared parameter. Worth checking
whether any spec covers those branches, since the pattern established elsewhere in this
campaign is that **the crashing path is stubbed in the spec**, which is why CI stays green.
