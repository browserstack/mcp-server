# Six routes, four different answers to "one of my ids was bad"

- **Product:** tm
- **Environment:** preprod (`test-management-preprod.bsstag.com`)
- **Status:** for the product team. Each behaviour is defensible alone; together they are not.

## The finding

Every bulk capability accepts a list of ids. Each was given a list containing one valid id and
one nonexistent id. **Six routes produced four different behaviours, and every one of the
non-200 responses is undeclared.**

| capability | behaviour on one bad id | status | declared? |
| --- | --- | --- | --- |
| `create_bulk_test_cases` | **silent half-success** — bad `folder_id` discarded, row filed into the path folder instead, no signal | 200 | no |
| `bulk_copy_test_cases` | **silent half-success** — valid id copied, bad id vanishes, no `skipped_ids`, no message | 200 | no |
| `bulk_move_test_cases` | **whole call fails**, valid case untouched | 404, bare `{success:false}` | no |
| `bulk_replace_test_case_fields` | **whole call fails**, retry with the valid id alone succeeds | 404, bare `{success:false}` | no — 404 absent from its declared surface entirely |
| `bulk_set_test_case_assignee_in_run` | **whole call fails** | 502, `{success:false, message:"Failed to update assignee"}` | no — and its guidance promises a 200 no-op |

| `copy_folder` | **whole call fails** on a bad destination folder | 404, `{"error":"Source or destination folder not found"}` — **no `success` key at all** | matches its own guidance, but the envelope differs from every sibling |

The two bare-404s on a bad *case* id agree with each other. `copy_folder`'s 404 does not: it
carries an `error` string and omits `success` entirely, so even the two 404-returning families
disagree about the envelope.

On a bad **destination folder** specifically the split is different again: `bulk_move_test_cases`
and `bulk_copy_test_cases` both return a clean **400**, `copy_folder` returns the **404** above,
and `create_bulk_test_cases` returns **200** and files the row somewhere else.

A caller cannot write one error-handling path for these. Two routes succeed partially under a 200, two reject with a bare 404 `{success:false}`, one
returns a 404 `{error:...}` with no `success` key, and one returns a 502. The two that return 200 require
inspecting downstream state to discover anything was dropped — in the copy case, the only
external signal was the destination folder's `cases_count` moving by less than expected.

## Why the silent ones are the serious ones

`bulk_copy_test_cases` and `create_bulk_test_cases` report `success: true` while doing part
of what was asked. An agent has no declared field to check: there is no `skipped_ids`, no
partial-success envelope, no count of what was actually processed. The operation looks clean.

This matters more because the product **does** have the concept — `list_test_run_test_cases_by_integer_id`
returns a top-level `skipped_test_case_ids`. The vocabulary exists and these routes do not use it.

## The destination-folder case is a good illustration

Given a nonexistent `destination_folder_id`:

- `bulk_move_test_cases` → **400**, nothing moved. Correct.
- `bulk_copy_test_cases` → **400**, nothing created, checked before doing any work. Correct.
- `create_bulk_test_cases` → **200**, bad id silently discarded and the case **filed into a
  different folder than the caller named**.

Two of the three get it right, which is what makes the third a defect rather than a design
choice. A caller who names a folder and receives a success code is entitled to assume the row
landed there.

## Suggested next step

Pick one contract and apply it to all four. Either reject the whole call on any bad id, or
succeed partially and **return the skipped ids in a declared field** — `skipped_test_case_ids`
already exists elsewhere in this product and would be the natural choice. Whichever is chosen,
the status code and error envelope should be declared, since three of the four currently are not.

## Evidence

Project 379335744 (PR-2005), 2026-09-21/22. Full traces in
`tests/live/runs/tm/bulk_move_test_cases.json`, `bulk_copy_test_cases.json`,
`bulk_replace_test_case_fields.json`, `create_bulk_test_cases.json`,
`bulk_set_test_case_assignee_in_run.json`, `copy_folder.json`.
No backend source was consulted; these are observed behaviours only.
