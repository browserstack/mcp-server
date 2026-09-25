# `bulk_restore_archived_test_cases` — a bare 404 on a correctly shaped request

- **Product:** tm · **Capability:** `bulk_restore_archived_test_cases`
- **Route:** `POST /api/v1/projects/{project_id}/test-cases/bulk-retrieve`
- **Environment:** preprod, 2026-09-22
- **Status:** for the product team. Not fixable from the index.

## The evidence, in the order that makes it conclusive

| request body | response |
| --- | --- |
| `{"ids": [...]}` — flat, no wrapper | `400 {"error":"param is missing or the value is empty: test_case"}` |
| `{"test_case": {"ids": [...], "de_selected_ids": [], "select_all": false}}` | **`404 {"success":false}`** |

The 400 is what makes this worth routing. It proves three things at once: **the route exists**,
the server reached the handler, and `test_case` is the wrapper the handler wants — which is
exactly what the contract's `json_path` declares. So the second request is not a guess; it is
the shape the server itself just asked for.

Sent that shape, with **case ids read from this project's own listing seconds earlier**, the
answer is a bare `404` with no message and no error key. Nothing distinguishes "these ids are
not yours" from "this route is gone" from "the handler threw".

## Why it is not a stale-fixture problem

The ids were not replayed from an old record. They came from
`GET /api/v1/projects/379335744/test-cases?all_folders=true&per_page=4` in the same session:
`1986676, 1986675, 1986653, 1986654`. The earlier saved payload did hold stale ids and was
refreshed for exactly this reason; the 404 survived the refresh.

## What an agent experiences

A caller that follows the contract precisely gets a 404 that reads as "not found", and the
reasonable next step — re-reading the ids and trying again — produces the same 404. There is no
message to act on and no way to tell the failure apart from a genuinely empty result.

## Suggested next step

Two questions for whoever owns the route: does the handler expect something other than `ids`
inside the `test_case` wrapper, and should a rejected id set be a 404 at all rather than a 200
with an empty collection or a 4xx that says which id was rejected.
