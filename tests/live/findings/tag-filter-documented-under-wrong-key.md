# Tag filtering works — the index documented the wrong parameter

- **Product:** tm · **Capability:** `search_project_entities`
- **Environment:** **production**, 2026-09-23
- **Status:** **index defect, fixed in v1.36.** No product change needed for tags.

## What was reported

> "Filter on listTestCases — couldn't filter using tags/status while listing the test cases."

## What is true

Both filters work. The report is the predictable consequence of two separate things:

1. **The plain listings have no filters at all.** `list_test_cases` and
   `list_folder_test_cases` declare no tag, status or any other filter parameter. Filtering
   lives on `search_project_entities` / `search_project_entities_by_filter`. A caller reaching for
   "list test cases" lands on a capability that genuinely cannot filter.
2. **The search capability documented the wrong key for tags**, and the wrong key fails
   *silently*.

## The measurement

Ground truth, by scanning all 280 cases in the project: **12 carry `2FA`**, 10 carry `delivery`,
22 carry one or the other.

| parameter | result | filtered? |
| --- | --- | --- |
| **`q[tags][]=2FA`** | 200, **12 rows**, `info.count` 12, every row carries the tag | ✅ exact |
| **`q[tags][]=2FA&q[tags][]=delivery`** | 200, **22 rows**, every row carries one of them | ✅ exact, OR semantics |
| `q[test_case_tags]=["2FA"]` *(what the index said)* | 200, **100 rows, count 280** — byte-identical to unfiltered | ❌ **silently ignored** |
| `q[tags]=["2FA"]` (unbracketed, JSON string) | 200, 0 rows | ❌ matches nothing |
| `q[tags]` with other shapes | **500** | ❌ |

The index went further than being wrong — it stated *"`q[tags]` is not a recognised key here and
is dropped"*, steering callers away from the family that actually works.

## Why the silent version is the damaging one

`q[test_case_tags]` returns `200` with a full, healthy-looking page. Nothing signals that the
filter was discarded. A caller sees results, sees they are not filtered, and concludes tag
filtering is unsupported — which is exactly the report. An unrecognised-parameter error, or even
the 500 the unbracketed form gives, would have been more useful than success.

## Status filtering was never broken

`q[status]` works, by **id**: `q[status]=40339182` → 64 of 280, `40339183` → 31. Sending the
display name returns 0 rows silently, which is the same trap as
`findings/status-by-name-silently-nulls.md` — resolve ids with `get_system_field_values`
first, where the id is in `value` and custom options are the ones with no `colour`.

## `search_project_entities_by_filter` was already correct

Its `tags` and `status` body fields carry `json_path: /q/tags` and `/q/status`, which is exactly
the shape the server wants. Verified through `bind`: `tags: ["2FA"]` binds to
`{"q":{"tags":"2FA"}}` and returns precisely the 12 tagged cases. **Anyone using the v2 search
through the capability framework already had working tag filtering.**

## Fixed

`q[test_case_tags]` replaced with `q[tags][]` on `search_project_entities`, documented as a
repeated bracketed parameter with the OR semantics and an explicit warning about the old key,
plus a leading guidance line on both search capabilities. Index v1.36.
