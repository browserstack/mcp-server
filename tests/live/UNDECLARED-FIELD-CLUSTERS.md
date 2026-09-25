# Undeclared fields — the clusters, and what fixing them found

**73 capabilities returning fields the index never declares · 562 field entries.**

Generated from the `contract.undeclared_returned` block of the live run records across both
environments — not from prose.

## The finding

These are not 562 independent omissions. A small set of fields recurs across many capabilities
with near-identical membership each time, which means **a handful of shared serializers are
emitting fields the contract never mentions**. Declaring each descriptor once clears the
majority.

> **Caveat, and it is teststack-e6's point, not a hedge.** `returns` is a curated summary, not
> an exhaustive schema. A field the API returns that the index does not advertise may be a
> deliberate omission. These are candidates for review, not 562 confirmed bugs. The harder and
> more misleading half of the drift is the *declared-and-never-returned* set — see
> `DRIFT-FIELD-DIFFS.md`.

## Cluster 1. The wide v1 test-case row

**13 fields across 13 capabilities** — roughly 84+ of the total entries.

Fields:

- `test_run_results_count` — 8 capabilities
- `test_run_results_issues_count` — 11 capabilities
- `is_shared` — 10 capabilities
- `template_id` — 8 capabilities
- `template_name` — 9 capabilities
- `template_step_type` — 9 capabilities
- `test_case_dataset` — 8 capabilities
- `automation_state` — 8 capabilities
- `estimated_duration_seconds` — 8 capabilities
- `step_count` — 6 capabilities
- `review_status` — 6 capabilities
- `reviewers` — 6 capabilities
- `value_category` — 7 capabilities

Emitted by:

- `bulk_replace_test_case_fields`
- `create_bulk_test_cases`
- `create_test_case_by_integer_id`
- `create_test_cases`
- `edit_test_case`
- `get_test_case_by_integer_id`
- `get_test_case_detail`
- `list_test_run_test_cases_by_integer_id`
- `list_test_cases`
- `list_test_runs_selection`
- `list_folder_test_cases`
- `search_project_entities`
- `search_project_entities_by_filter`

### Resolved — measured, then fixed, 2026-09-22 (index v1.32)

Two estimates preceded the fix and **both were wrong**.

- *Mine:* "one serializer, therefore close to one edit."
- *teststack-e6's:* "the index describes it **five times** — four row schemas across nine
  groupings, so it is a careful merge, not an edit."

Resolving each capability's 2xx through to the node the row actually sits on shows the second
count conflated **response envelopes** with **row schemas**. `TestCaseConsolidatedListResponse`,
`TestCaseListResponse` and `V1TestCaseDetailResponse` are envelopes; all three already reached
the same `TestCase` row. There were never four row descriptions of this serializer.

What was actually there:

| | |
| --- | --- |
| capabilities resolving to the one shared `TestCase` row | **11 of 13** |
| rogue stub | `V1TestCaseDetail` — 3 properties, one of them (`title`) **returned by no route** |
| no row schema at all | `search_project_entities_by_filter` |

So the merge risk teststack warned about — five drifted copies needing adjudication — did not
exist here. But the warning was still the right instinct, because chasing it down turned up
**two genuinely different serializers that were wrongly pointed at `TestCase`**, which is the
more damaging error and neither estimate had it:

- **`list_test_runs_selection`** returns the **raw case record**: `automation_status` is a plain
  string rather than the `{name, value}` object, the folder key is `folder_id` rather than
  `test_case_folder_id`, case type arrives as the bare string `type`, and `priority`, `status`,
  `case_type`, `tags`, `issues`, `custom_fields` and `steps` are **not returned at all**. Its
  `returns` list promised ten fields the route never sends; `TestCase` had been backing them
  falsely, so nothing caught it.
- **`list_test_run_test_cases_by_integer_id`** and **`bulk_set_test_case_assignee_in_run`** return a
  case-x-configuration **mapping row** — the shared record plus 18 execution fields
  (`mapping_id`, `test_run_id`, `latest_status`, `result_status`, `configuration`, `defects` …).

### What was changed

Verified field-by-field against live responses from **both** environments before writing
anything; no type was inferred from the old schema.

1. **`TestCase`** — the 13 cluster-1 fields declared once, each carrying the routes it is
   absent from. `step_count` is absent from the two detail routes; `attachments` is absent from
   `list_test_cases`, `list_folder_test_cases` and the mapping rows. Stating that in the
   field's own description keeps one shared schema instead of splitting it, which is what
   `index-loader.ts` explicitly warns against.
2. **`TestCaseFieldValue`** — new. `case_type`, `priority`, `status` and `automation_state` are
   one descriptor; the index described it three times and the copies disagreed. `status` was
   missing `name` and all three were missing `value_category`. Now one schema, four references.
3. **`V1TestCaseDetail`** — repointed at `TestCase`. The invented `title` is gone.
4. **`search_project_entities_by_filter`** — given the row schema it never had.
5. **`V1TestRunTestCaseRow`** — new, composed on `TestCase` via `allOf` (the pattern
   `TemplateWithFields` already uses), carrying the 18 mapping fields.
6. **`TestRunSelectionCaseRow`** — new, 32 fields, and `list_test_runs_selection`'s `returns`
   corrected: the ten fields it never returns removed, thirteen it does return added.

### The first attempt was wrong, and the re-probe caught it

Declaring the route-conditional fields on the one shared `TestCase` schema drove
`undeclared_returned` to **zero on every route** — and created `declared_missing` in its place,
which is the **worse** direction and the one this campaign has repeatedly said is worse. Six
routes went from "returns things it never declared" to "declares things it never returns". The
conditions were written into each field's description, but a schema property is authoritative
and a sentence inside it is not.

The re-probe after the `/mcp` reconnect is what surfaced it. The contract check could not: it
only walks `returns` -> schema, never schema -> reality.

The correct structure is **composition, not one wide schema and not duplication**:

```
TestCaseCore            42 fields returned by every test-case row anywhere
  TestCase              + estimated_duration_seconds, template_name, test_case_dataset
    V1TestCaseListRow       + step_count
      V1TestCaseFolderListRow + duplicates_tc_count
      V1TestCaseSearchRow     + attachments
    V1TestCaseRecordRow     + attachments, comments_count
      V1TestCaseDetailRow     + folder, testcase_template, using_fallback_template,
                                duplicates_tc_count, folder_path
  V1TestRunTestCaseRow   + 21 mapping fields (composes on Core, not TestCase)
```

Every field is still defined **exactly once**. No copy can drift from another, which was
teststack's objection to splitting, and no route declares a field it does not return. The same
treatment applied to `TestRun` (list vs detail) and `ExploratorySession`, whose list route turned
out to be a 16-field projection of a 28-field record.

### Result

| | before | after |
| --- | --- | --- |
| capabilities whose `returns` names an unbacked field | 65 | **51** |
| unbacked fields | 362 | **288** |
| newly broken | — | **0** |

**Live re-probe on production after an `/mcp` reconnect — 12 capabilities, all PASS**, declared
and actual agreeing exactly in both directions:

`get_test_case_detail` 52/52 · `get_test_case_by_integer_id` 47/47 · `list_test_cases` 46/46 ·
`list_folder_test_cases` 47/47 · `search_project_entities` 47/47 ·
`search_project_entities_by_filter` 47/47 · `list_test_runs_selection` 32/32 · `list_test_runs_by_integer_id` 32/32 ·
`get_test_run_by_integer_id` 32/32 · `get_exploratory_session` 28/28 ·
`list_exploratory_sessions` 16/16 · `list_root_folders` 9/9

One capability is recorded as **BLOCKED**. `list_test_run_test_cases_by_integer_id` cannot pass in
either environment, because **neither returns the full set**: production omits
`execution_eligible`, preprod omits `review_status` and `reviewers`. The schema declares the
union and names the split rather than being quietly right for one environment and wrong for the
other. It is filed as BLOCKED rather than DRIFT because nothing on the index side can resolve it
— the difference is in the environments, not the contract. It becomes PASS in whichever
environment converges first.

723 tests pass; lint and typecheck clean. `scripts/contract-baseline/tm.json` regenerated.

## Clusters 2 and 3 — status

**Cluster 2 (the test-run envelope) is fixed.** `TestRun` is genuinely one serializer behind the
v1 list, detail, search and write routes (the v2 routes use `TestRunSummaryV2` /
`TestRunTestCaseV2`, which is why the name looked overloaded at first). Eight fields declared:
`attachments`, `created_by`, `updated_by`, `closed_at`, `closed_by`, `build_meta`,
`observability_id`, `issues`.

Two fields went the other way. **`self_ui_link` and `type` were declared on `TestRun` and
returned by nothing** — absent from 120 rows across both environments, from the detail route,
from the search route, and named in no capability's `returns`. Removed.

A behavioural note came out of the same sampling and is now in the schema: **`closed_at` and
`closed_by` are null on every run, including 43 whose `run_state` was `done`.** Closure cannot
be inferred from either field; `run_state` is the only reliable signal.

**Cluster 3 splits into four families and is partly done.**

| family | status |
| --- | --- |
| folders | **already clean** — `Folder` matched live exactly, nothing to fix |
| exploratory sessions | **fixed** — 12 fields declared, `folder_id` removed (returned by neither the list nor the detail route, in either environment), and `returns` corrected to drop `name`, `summary`, `folder_id` and `test_plan` |
| filters | **not done** — needs a write to observe |
| custom fields (v2 admin) | **not done** — `403` on production; the credential is missing the `field-view` permission |

The exploratory-session work also turned up a routing trap now written into its guidance: **the
single-session read takes the integer `id`, and the `ES-NNN` identifier returns 404** — while
every other v1 route in this product accepts the prefixed form.

## Not a serializer — a shared convention

`folders` is the outlier. It appears across unrelated bulk writes *and* folder reads, so it is
not one serializer leaking — it is a breadcrumb map several endpoints attach independently.

**`folders`** — 8 capabilities:
- `bulk_copy_test_cases`
- `bulk_edit_test_cases`
- `bulk_move_test_cases`
- `list_entity_filter_details`
- `list_root_folders`
- `list_folder_test_cases`
- `search_project_entities`
- `search_project_entities_by_filter`

**`custom_fields`** — 5 capabilities:
- `bulk_edit_test_cases_in_test_run`
- `create_exploratory_session`
- `get_test_case_by_integer_id`
- `get_test_runs_form_fields`
- `update_exploratory_session`

**`tags`** — 4 capabilities:
- `bulk_edit_test_cases_in_test_run`
- `create_shared_step`
- `get_test_case_by_integer_id`
- `search_group_tags`

**`test_case_id`** — 4 capabilities:
- `bulk_edit_test_cases_in_test_run`
- `create_bulk_test_cases`
- `create_test_case_by_integer_id`
- `create_test_cases`

## Worst individual offenders

| capability | undeclared fields |
| --- | --- |
| `get_test_case_by_integer_id` | 46 |
| `get_test_case_detail` | 29 |
| `list_folder_test_cases` | 29 |
| `search_project_entities` | 24 |
| `list_test_cases` | 23 |
| `create_root_folder` | 22 |
| `list_test_runs_selection` | 20 |
| `search_project_entities_by_filter` | 19 |
| `list_test_run_test_cases_by_integer_id` | 15 |
| `list_projects` | 15 |
| `list_test_plan_test_runs_by_integer_id` | 14 |
| `bulk_edit_test_cases_in_test_run` | 12 |

## One field worth its own note

**`attachments` appears on 12 capabilities that do not declare it** — including
`search_project_entities_by_filter`, where a probe used that undocumented field to establish that
**156 of 203 sampled cases carry real attachments** (PDFs and PNGs with filenames, sizes and
checksums).

Meanwhile `list_test_case_attachments` — the capability whose entire job is attachments —
returns a bare `500` on a 1-attachment case, a 4-attachment case and an empty case alike.

So the data is reachable, abundant, and only available through capabilities that never admit to
returning it. The dedicated endpoint is the broken one.

## Full per-capability listing

See `UNDECLARED-FIELDS.md` for every field on every capability.
