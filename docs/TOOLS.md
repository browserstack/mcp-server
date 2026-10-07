# BrowserStack MCP Server — Tool Reference

Every tool the BrowserStack MCP Server exposes, organised by product the same way as the [BrowserStack MCP docs](https://www.browserstack.com/docs/browserstack-mcp-server/tools). Expand a product to see its full list.

Two kinds of tool appear side by side. Tools with camelCase names, such as `createTestCase`, are registered directly in your client and are called by name. Tools with snake_case names, such as `create_shared_step`, live in the catalog and are reached through the five **core tools**: `listProducts`, `describeEntity`, `searchCapability`, `describeCapability` and `invokeCapability`. The flow is always the same: find it, read its contract, then call it.

```text
searchCapability  →  describeCapability  →  invokeCapability
```

`searchCapability` needs a product, so your assistant calls `listProducts` first if the task does not name one, and `describeEntity` when an id or field value has to be resolved. Anything that changes data asks for your confirmation before it runs; deletes are not exposed. See [Core tools](https://www.browserstack.com/docs/browserstack-mcp-server/tools/core-tools) for parameters and how changes to data are approved.

> **Remote MCP note:** Tools marked _(not available in Remote MCP)_ rely on local file/process state and are disabled in the multi-tenant [Remote MCP Server](../README.md#-remote-mcp-server). They are available in the local (npx) setup.

> **File & app uploads:** tools that upload a local file/app (`uploadProductRequirementFile`, `takeAppScreenshot`, `runAppTestsOnBrowserStack`, `runAppLiveSession`) require the `MCP_UPLOAD_BASE_DIR` env var set to a directory containing those files; uploads are restricted to it.

---

## 🧰 Tools

<details>
<summary><b>🧾 Test Management</b></summary>

| Tool | What it does |
|---|---|
| `createProjectOrFolder` | Create a Test Management project and/or folders to organize test cases. Returns with Folder ID, Project ID and Test Management Link to access the TM Project Dashboard. |
| `createTestCase` | Add a manual test case under a specific project/folder (uses project identifier like PR-xxxxx and a folder ID). |
| `updateTestCase` | Update an existing test case. Any subset of fields may be changed (name, priority, status, steps, tags, etc.); only supplied fields are modified. |
| `listTestCases` | List test cases for a project, optionally scoped to a folder (supports filters like case_type, priority, and pagination). |
| `listFolders` | List folders in a Test Management project (returns each folder's id, name, case counts, and sub-folder counts). Pass a parent_id to list sub-folders. |
| `listTestCaseTemplates` | List test-case templates with their numeric template_id, for use with `createTestCase` to apply a custom template. |
| `createTestRun` | Create a test run (suite) for selected test cases in a project. |
| `listTestRuns` | List test runs for a project (filter by dates, assignee, state). |
| `updateTestRun` | Update a test run's name/state and/or add test cases to it. |
| `addTestResult` | Add a manual execution result (passed/failed/blocked/skipped) for a test case within a run. |
| `createTestCasesFromFile` | Generate test cases in bulk from an uploaded file using the Test Case Generator AI Agent. _(not available in Remote MCP)_ |
| `listTestPlans` | List test plans (TP-*) in a project, with name, status, dates, and active/closed run counts. Supports pagination. |
| `getTestPlan` | Fetch a test plan by identifier (TP-*) with its metadata, linked test runs, total test-case count, and status summary. |
| `listSubTestPlans` | List sub-test-plans (STP-*) under a parent test plan (TP-*). Supports pagination. |
| `getSubTestPlan` | Fetch a sub-test-plan (STP-*) under a parent plan, with its metadata and linked test runs. |
| `assign_test_run_owner` | Assign a owner to the test run |
| `assign_test_run_test_cases` | Hand specific test cases inside a run to the people who should execute them (or clear their assignee) |
| `bulk_archive_test_cases_by_project` | Bulk Archive Test Cases |
| `bulk_archive_test_plans` | Archive test plans in bulk — the reversible way to get plans out of the active listing; use this instead of delete whenever the user might want them back |
| `bulk_copy_test_cases` | Copy test cases into another folder or another project — by listing their ids, or by copying everything a filter matches — and clone cases in place. |
| `bulk_edit_test_cases` | Bulk edit test cases with per-field add / remove / replace operations (PREFERRED bulk write). |
| `bulk_edit_test_cases_in_test_run` | Mark many of a test run's cases at once — set their result status, assign them, add a comment, link defects or set result custom fields. |
| `bulk_move_test_cases` | Move test cases into another folder, or into another project, by id or by filter. |
| `bulk_replace_test_case_fields` | Set the same field values — owner, priority, status, case type, tags, custom fields, review state — on many test cases at once from the project-wide search/filter view. |
| `bulk_restore_archived_test_plans` | Restore archived test plans in bulk — puts them back into the normal plan listing; this is the undo for a bulk archive |
| `bulk_set_test_case_assignee_in_run` | Set the assignee on many test cases inside a test run in one call — pick the rows explicitly, or select every row matching the current filter and deselect a few |
| `bulk_set_test_result_status` | Move many test cases in a test run to one status in a single call — the bulk 'mark these passed' or 'reset the run to untested' action, which replaces each case's current outcome instead of adding a new one |
| `bulk_update_test_run_test_cases` | Change which test cases a run covers — bulk-add cases to it, or bulk-remove them, optionally per configuration |
| `clone_exploratory_session` | Copy an existing exploratory session — its description, timebox, configurations and custom fields, plus its log entries, and optionally its tags, linked issues and owner — to re-run the same exploration |
| `clone_test_plan` | Copy a test plan into a brand-new plan, bringing its test runs (and optionally its sub-plans) with it — the copy is built in the background, so this hands back a job id rather than the new plan |
| `clone_test_run` | Copy an existing run into a brand-new run — the usual way to re-execute just the failed or blocked cases from the last cycle |
| `clone_test_run_by_integer_id` | Copy an existing test run into a new one — optionally carrying over its cases, their assignees, tags and linked defects — to re-execute the same scope without rebuilding the selection |
| `close_exploratory_session` | Mark an exploratory testing session finished so it leaves the active listing and is archived as completed work |
| `close_test_run` | Close a test run — freeze its results, mark the cycle finished and drop it out of the default run listing |
| `copy_folder` | Duplicate a folder — its whole subtree of subfolders and every test case in them — into another folder, or to the root of any project you can reach; always runs as a background job |
| `count_binned_test_cases` | Return just the number of test cases currently in a project's recycle bin — the cheap way to answer 'how many binned/deleted cases are there?' without pulling any rows into context (use list_binned_test_cases when you need the cases themselves) |
| `count_run_selection` | Ask how many test cases a folder/case selection will actually resolve to — including the multiplication by configurations — before committing it to a run create or edit |
| `create_bulk_test_cases` | Create several test cases in one folder in a single call (up to 10) — the call to use whenever you have more than one case to add. |
| `create_configuration` | Create a named configuration — an OS / browser / device combination that test runs track their per-case results against |
| `create_custom_field` | Define a new test-case custom field — choose its type, name it, say whether filling it is mandatory, and optionally give a dropdown its choices and link it to the projects that should offer it |
| `create_custom_field_dataset` | Attach another option set and project scope to an existing custom field — the way to give one field different dropdown values in different projects |
| `create_custom_field_dataset_option` | Add one more choice to a dropdown-style custom field — a new value in an existing dataset, for every project that dataset covers |
| `create_custom_field_definition` | Define a new custom field for the workspace — pick its data type, whether it is mandatory, and (via datasets) which projects get it and what option values it offers |
| `create_dataset` | Create a dataset — a named table of columns (variables) and rows that drives data-driven execution, so one test case runs once per row with the row's values substituted in |
| `create_exploratory_session` | Start a new exploratory testing session in a project — give it a charter, a timebox, an owner, tags, configurations and a folder — so that observations can be logged against it |
| `create_exploratory_session_log` | Record one observation during an exploratory session — a note about what was tried and what happened, its pass/fail/bug outcome, the time it took and any defects it raised |
| `create_filter` | Save a reusable named filter view on a project — the condition set behind a test case, test run, test plan or exploratory-session list — so the same selection can be reapplied later or shared with everyone on the project |
| `create_folder` | Create a folder, or a sub folder under a parent. |
| `create_project` | Create a new project — the top-level container every folder, test case, run, plan and report lives under; returns both the integer id the v1 routes take and the PR-NNN identifier the v2 routes take |
| `create_report` | Set up a new report over a project's test data — either a one-off you will download, or a recurring daily/weekly/monthly schedule that emails chosen people; this saves the report's definition (type, window, scope, recipients) and hands back its SC-NNN identifier, it does not produce any figures |
| `create_report_by_integer_id` | Save a report definition over a project's runs, plans, cases, sessions or requirements — scheduled to email on a cadence, or unscheduled and read on demand |
| `create_root_folder` | Create a top-level folder in a project — the first thing you need before test cases can be filed anywhere |
| `create_shared_component` | Create a reusable shared field - a step sequence, a Gherkin background block, or a precondition - that many test cases can then reference. |
| `create_shared_step` | Create a reusable shared step block in a project — a titled set of step/result rows that many test cases can then embed by reference instead of copying |
| `create_step_result` | Log the outcome of ONE step inside a test case's execution in a run — the per-step pass/fail you record while working through a manual test case, as opposed to the case's overall result |
| `create_sub_folder` | Create a folder inside an existing folder — use this to build out a nested test-case tree one level at a time |
| `create_sub_test_plan` | Break a test plan into a child plan — use this when a release plan needs per-team, per-phase or per-platform slices that each hold their own runs |
| `create_template` | Create a new test-case template — define which description and property fields a test case gets and, optionally, which projects it applies to. |
| `create_test_case` | Create a test case in a folder. |
| `create_test_case_by_integer_id` | Create one test case at the project level — the call to use to seed the FIRST case in a project that has no folders yet, via create_at_root. |
| `create_test_case_comment` | Post a comment on a test case. |
| `create_test_cases` | Create one test case in a folder — the normal single-case create. For more than one case, use the bulk create instead. |
| `create_test_plan` | Create a test plan to group the test runs for a release, sprint or milestone — the TP-NNN it returns is what runs and sub-plans then hang off |
| `create_test_plan_by_integer_id` | Create a test plan to group test runs for a release or milestone — or create a SUB-plan under an existing plan by setting parent_plan_id |
| `create_test_result_for_test_case` | Create a new test result for a test case in a test run |
| `create_test_results_for_test_run` | Record the outcome of running test cases in a test run — pass/fail/blocked with notes, per-step results, linked defects and attachments — for one case or for many in a single call |
| `create_test_run` | Create a test run in a project and load it with the test cases to be executed — the starting point for recording results, and what you make before assigning testers or linking the run to a plan |
| `create_test_run_by_integer_id` | Create a test run for a project |
| `create_test_run_test_case_comment` | Post a comment on a test case within a test run — use this to leave review feedback on an execution, ask the run owner a question, record why a result was marked as it was, or @mention a colleague |
| `download_report` | Kick off an async export of a report to CSV, PDF or XLSX — returns a job channel, not the file |
| `edit_project` | Rename a project, or change its description or visibility. |
| `edit_test_case` | Edit one test case through the full edit form — rename it, rewrite its steps, preconditions and expected result, retag it, or send it for review. |
| `edit_test_case_partial` | Change just the fields you name on one test case, leaving everything you omit untouched — the safe path for an inline single-field edit. |
| `edit_test_run` | Rewrite a test run through the full edit form — rename it, move its state on, change owner, tags, configurations or linked plan. NOT the way to add cases: the case selection you send becomes the run's entire membership, so add cases with bulk_update_test_run_test_cases (add_test_cases) instead |
| `export_dashboard_analytics` | Queue a CSV export of the whole project dashboard (active + closed runs, issue counts, case-type split, automation stats) and get back an export id — the file itself is delivered out of band |
| `get_active_test_runs_info` | Chart the result-status breakdown across the project's currently active test runs — how many results are passed / failed / blocked / untested right now |
| `get_archived_test_plan_count` | How many test plans in this project are archived — the badge number for the archived view; use the archived-plans listing when you need the plans themselves |
| `get_automation_stats` | Get the project's automation coverage — what percentage of its test cases are automated, with the automated / manual / total counts behind it |
| `get_closed_test_runs_info` | Chart how many test runs were closed per month over the selected window — the project's throughput trend |
| `get_closed_test_runs_split` | Chart closed test runs per month split by result status — a stacked view of how each month's closed runs finished |
| `get_custom_field` | Read one custom field by its numeric id — confirm its name, type, placeholder, default and whether it is mandatory, and pick up the ids of the datasets that hold its option values |
| `get_custom_field_dataset` | Read one dataset of a custom field — which projects it covers and, on request, the option values it holds |
| `get_custom_field_definition` | Read one custom field's stored definition together with its datasets and the projects each dataset is linked to — the call to make before any edit, since edits here are full replaces |
| `get_custom_field_values` | List the values one custom field offers inside a given project — the dropdown choices, or the users for a user field — so you can pick a valid value before writing it onto a test case or result |
| `get_dataset` | Read one dataset in full — its columns, every row of data, tags and metadata — by dataset uuid |
| `get_dataset_variables` | List every dataset column defined anywhere in the project, each with the dataset it belongs to — use this to find which dataset holds a variable name you saw in a test case |
| `get_dedupe_status` | Check whether duplicate detection has ever run for a project and where the latest scan got to — the only way to tell 'dedupe is off or has never run' from 'it ran and found nothing' |
| `get_duplicate` | Read one suggested duplicate pair — the two test cases side by side with their titles, descriptions, folders and owners, plus the confidence score and the model's reason — so a human can decide how to resolve it |
| `get_exploratory_session` | Read one exploratory session in full — its charter, state, timings, assignee, tags, configurations, linked test plan, linked issues, custom fields and how many logs it holds — before reading its logs or changing it |
| `get_exploratory_session_summary` | Get exploratory-session testing figures for a project directly — sessions, outcomes and top testers over a date range or a chosen set of sessions, with no saved report needed |
| `get_folder_remove_summary` | Dry-run a folder deletion — count the test cases, subfolders and cross-product recordings that would be destroyed — before committing to it |
| `get_folder_tree` | Fetch a project's entire folder tree in one call — every root folder with its children nested under `contents` — to resolve a folder name to the integer id every other folder and test-case call needs |
| `get_issues_count_info` | Chart how many defects/issues were linked from this project per period — the defect-discovery trend |
| `get_lcnc_user_test_config` | Get the caller's saved low-code test setup for a project. |
| `get_linked_test_case_selection` | Preview the test cases a tracker ticket would link. |
| `get_project_by_integer_id` | Get a project by INTEGER id (v1) — full detail + its PR-NNN identifier |
| `get_project_form_fields` | Get the test-case form for one project — the custom fields it shows, the built-in system fields, and the pick lists behind the standard priority / state / type / automation-status dropdowns |
| `get_project_settings` | Read a project's configuration flags — review/approval gating, the custom test-case id prefix, time-tracking, Part 11 re-auth, Jira/Azure linking — and optionally the caller's own pending-review counts |
| `get_projects_basic` | Look up projects by name or by PR-NNN identifier, or page through them cheaply — the lean listing, and the only one with an identifier search; note the rows it returns do NOT include the identifier itself |
| `get_projects_minify` | Page through every project in the group as a flat dropdown list, 300 at a time — the fastest way to enumerate all projects, but it cannot search and it returns no pagination metadata |
| `get_report` | Read one report's setup by its SC-NNN identifier — what it covers (type, time window, the runs/plans/sessions it is scoped to), whether it is on a schedule and when it next runs, who receives it, and whether a generated file exists; configuration only, no figures |
| `get_report_detail` | Read one saved report — its definition, resolved filters, and computed figures — the general-purpose report read |
| `get_report_section` | Fetch one report widget on its own — a single chart, table or drill-down slice from a saved report, without the report definition |
| `get_report_summary_by_type` | Render a saved report through one of four fixed renderers — run summary, run detail table, test plan detail table, or requirement traceability |
| `get_selected_report_testcases` | Read a report's saved test-case selection in the folder-keyed shape the editor uses — the value to round-trip back when editing the report |
| `get_shared_step` | Read one shared step with its full ordered step/result rows — the block that every referencing test case renders, and the row ids those references point at |
| `get_shared_steps` | List a project's shared steps with how many steps each holds and how many test cases embed it — use this to find a shared_step_id and to size the blast radius before editing or deleting a block |
| `get_system_field_values` | List the option ids and display names a project defines for one system field (priority, status, case type, automation state) — resolve these before writing any of them. |
| `get_test_case` | Get one test case in full by its TC-NNN identifier. |
| `get_test_case_by_integer_id` | Read one test case by its INTEGER id inside a folder — the v1 lookup, and the way to translate an integer id into the TC-NNN identifier the v2 surface needs. |
| `get_test_case_count_trend` | Chart how the project's test case count grew month by month, broken down by case type — use this for 'how fast is the suite growing' |
| `get_test_case_detail` | Read one test case with its full slide-over detail — steps, custom fields, template, attachments and its linked runs, results and defects. |
| `get_test_case_histories` | See what changed on a test case, when, and who changed it — the revision trail, newest first, naming the fields touched in each edit; the read to answer 'what did this case look like before that edit?' or 'which revision should we roll back to?' |
| `get_test_case_history` | Read one revision of a test case in full — the per-field before/after for that single change and who made it; the follow-up read after finding a revision in the trail |
| `get_test_case_history_diff` | Compare two revisions of a test case field by field — what the name, description, preconditions, steps, status, priority, owner, tags, defects, attachments, reviewers and custom fields looked like in each |
| `get_test_case_tags` | List the tag names currently on one test case — to see what it is labelled with before filtering, grouping or re-tagging |
| `get_test_case_type_split` | Chart how the project's test cases divide across case types (functional, regression, smoke, custom types…) — the current composition of the suite |
| `get_test_plan` | Read one test plan or sub-plan — dates, status, owner-facing description, tags, linked issues, how many runs and sub-plans it holds, and a first glimpse of the runs inside it |
| `get_test_plan_by_integer_id` | Read one test plan or sub-plan in full by its integer id — name, dates, status, owner, tags, custom fields, reviewers, progress rollup, and its TP-NNN / STP-NNN identifier |
| `get_test_plan_execution_trend` | Execution-trend chart series (results over time) for exactly ONE test plan or ONE test run — the Insights trend graph; scope it with test_plan_id or test_run_id, never both |
| `get_test_plan_linked_sessions_chart_data` | Chart data for the exploratory sessions linked to one test plan — the plan's sessions insight tile |
| `get_test_results_custom_fields` | List the custom fields a project shows on a test RESULT — the extra fields a tester fills when recording a pass or fail, with the ids and types needed to send values |
| `get_test_run` | Look up one test run — its state, owner, tags, configurations, linked plan and per-status progress counts |
| `get_test_run_by_integer_id` | Get a test run by INTEGER id (v1) — full detail + its TR-NNN identifier |
| `get_test_run_detail` | Open a test run's detail view — its header, progress counts, linked defects and the dynamic-filter rule behind it. This does NOT return the run's test cases; list those separately |
| `get_test_run_progress` | Get pass/fail/untested progress of a test run broken down by result status — per configuration (browser/device) across the whole run, or for one configuration — to answer 'how far along is this run on each configuration?' |
| `get_test_runs_form_fields` | Discover the fields available when recording a test RESULT in this project — the built-in status options and, on request, the project's custom result fields — so a result can be submitted with valid values |
| `link_entities_to_jira_issue` | Link test cases or runs to a tracker ticket. |
| `list_archived_test_cases` | List the test cases that have been archived in a project — the source of the ids the bulk-retrieve (un-archive) call needs. |
| `list_archived_test_plans` | Page through the test plans that have been ARCHIVED in a project — the place to find a plan to restore; archived plans do not appear in the normal plan listing at all |
| `list_binned_test_cases` | List the test cases sitting in a project's recycle bin (moved to bin / soft-deleted, awaiting purge) with who binned them and when — use this to find a case to restore or inspect; for just 'how many are in the bin' use count_binned_test_cases instead |
| `list_closed_test_runs` | List a project's finished (closed) test runs — the ones the default run listing leaves out — to report on completed cycles |
| `list_configuration_groups` | List the account's configuration groups and their ids. |
| `list_configurations` | List the configurations a project's test runs can execute against — search by name or fetch specific ids, to resolve the configuration_id a run needs |
| `list_custom_field_dataset_options` | List the option values a dataset offers, with the numeric option id each one carries — the ids you need to rename, re-default or delete an option |
| `list_custom_fields` | Discover the test-case custom fields defined in this workspace — list each field with its name, type, required flag and linked-project count, and pick up the numeric field id needed before reading, editing or filling in a field |
| `list_dataset_linked_test_cases` | List the test cases bound to a dataset — check what a dataset drives before you edit or delete it |
| `list_datasets` | Find datasets in a project — browse them or look one up by name or uuid to get the uuid the other dataset calls need |
| `list_duplicates` | List the AI-suggested duplicate test-case pairs awaiting review in a project, highest-confidence first — optionally only those involving one test case, or only the caller's own |
| `list_entity_attachments` | List the files attached to one test case, test result or test plan - use this to see what screenshots, logs or evidence are on the item and to get the URL for reading each file |
| `list_entity_filter_details` | Resolve a set of filter IDs you already hold into their display objects — turn priority/status/case-type/custom-field ids, folder ids and user ids into names, colours and folder paths so a saved filter can be rendered; it does NOT list the filter options available in a project |
| `list_exploratory_session_defects` | List the defects and issues raised during an exploratory session — the external tracker tickets linked to the session and to its individual log entries — to review what the exploration found |
| `list_exploratory_session_form_fields` | List the form fields for authoring an exploratory session. |
| `list_exploratory_session_logs` | Read the observations recorded during an exploratory session — the timestamped notes, their pass/fail/bug status, elapsed time, linked defects and embedded screenshots — optionally narrowed to particular statuses |
| `list_exploratory_sessions` | Find exploratory testing sessions in a project — filter by state, assignee, creator, tags, configurations, linked test plan, date range or free text — to pick the session whose logs or defects you want to read next |
| `list_filters` | List the saved filter views available in a project — yours and the project-wide ones — to find the filter_id to read, apply, update or delete |
| `list_folder_attachments` | List the files attached to a folder itself. |
| `list_folder_contents` | Open one folder — its immediate subfolders, the folder's own record, and optionally its ancestor breadcrumb — to walk the tree a level at a time or work out where a folder sits |
| `list_folder_test_cases` | List the test cases in one folder — the repository browser read, with optional extra columns and custom fields. |
| `list_group_users` | List or look up the people in this workspace — search by name, resolve an exact email, or read your own identity — to get the user id that owner and assignee fields take |
| `list_project_users` | Find the users in this group — by name fragment, by exact email, or by id — and get the caller's own identity back alongside them; use this to resolve a person's name or email to the numeric user id that owner/assignee/reviewer filters and writes require |
| `list_projects` | List the group's projects with their PR-NNN identifiers, case/run counts and duplicate badge — the listing to use when you need each project's identifier; for a plain name lookup or a count, get_projects_basic is leaner |
| `list_reports` | Find a project's reports — search saved and scheduled reports by title or type, see which ones run on a recurring schedule and when each next fires, or pick up the SC-NNN identifier of a report you then want to read or download |
| `list_root_folders` | List a project's root folders, or search folders anywhere in the project by name — the paginated way in when the full tree is too big to pull at once |
| `list_schedules` | List a project's reports — scheduled and unscheduled alike, with type, window, cadence and owner — the way to find a report_id |
| `list_shared_components` | List or search a project's shared fields. |
| `list_templates` | List the workspace's test-case templates — start here to find a template's id before creating a test case from it or before editing the template itself. |
| `list_test_case_comments` | Read the comments on a test case. |
| `list_test_case_histories` | List a test case's revision trail — who changed it, when, which fields moved, and the ids you need to view, diff or restore an earlier version |
| `list_test_case_tags` | List a project's test-case tag vocabulary with usage counts — the set of tag names to pick from when tagging a case or filtering a list by tag |
| `list_test_case_templates` | List the workspace's test-case (or test-result) templates with their ids — the lookup to run before creating a case from a template or editing a template's field layout |
| `list_test_cases` | List a project's test cases across every folder — the project-wide repository read. Requires all_folders=true. |
| `list_test_plan_test_runs` | List the test runs that belong to a test plan, with each run's state, assignee and pass/fail progress — the read behind 'how is this release going?' and 'which runs are in this plan?' |
| `list_test_plan_test_runs_by_integer_id` | List the test runs linked to a test plan, with each run's state and progress — optionally including the runs that belong to its sub-plans |
| `list_test_plans` | List the test plans in a project — the read that turns a plan name the user said into the TP-NNN id every other plan call needs, and answers 'what plans do we have?' |
| `list_test_plans_by_integer_id` | Page through a project's test plans — filter by status, search and sort, and optionally include sub-plans; this is how you resolve a plan name a user mentioned to the integer id every other v1 plan route needs |
| `list_test_results_for_test_case` | Read what was recorded for one test case in one test run — every execution logged against it, with status, notes, linked defects, custom fields and configuration |
| `list_test_results_for_test_case_by_integer_id` | Read the result history for one test case inside one test run — every attempt logged against that case with its status, author, note, attachments, linked defects and custom fields; the read for 'what happened when we executed this case?' |
| `list_test_run_test_case_comments` | List the comments left on a test case inside a specific test run — use this to read the discussion or review feedback on that execution, find who said what and when, or discover a comment's id |
| `list_test_run_test_cases` | List the test cases inside a run with their latest result, assignee and configuration — the read to answer "what is still untested / failing in this run?" |
| `list_test_runs` | Find test runs in a project — filter by owner, lifecycle state, linked plan or date to locate a run, count how many there are, or collect the run ids you need before linking runs to a test plan |
| `list_test_runs_by_integer_id` | List a project's active test runs with their progress counts, owner and linked plan — the starting point for finding a run to read, execute or report on |
| `list_test_runs_selection` | Resolve a folder/case selection into the actual list of test cases it covers — use it to preview or page through what a run create or edit would pull in before committing it |
| `list_users` | List the account's active users, for assigning a case or run. |
| `list_workspace_fields` | Browse or search every field configured for the workspace — built-in system fields and user-defined custom fields together — to find a field's numeric id, type and how many projects it reaches |
| `move_folder` | Move a folder and its contents under a different parent. |
| `move_folder_by_integer_id` | Move a folder — with everything under it — to a different parent, to the project root, or into another project; same-project moves complete immediately, cross-project ones run in the background |
| `move_test_case` | File one test case in a different folder — use this to reorganise the tree, move a case out of an inbox/triage folder, or put a case where a run or plan expects to find it |
| `rename_folder` | Rename a folder or change its description. |
| `rename_folder_by_integer_id` | Rename a folder or rewrite its notes — despite the name this is the general folder-edit call, and it changes whichever of the two fields you send |
| `reorder_folders` | Change the display order of sibling folders by dropping one or more of them between two named neighbours — ordering only, it never changes nesting |
| `reorder_test_cases_by_folder` | Change the manual order of test cases within a folder by dropping a block of them between two neighbours. |
| `replace_test_run` | Rewrite a test run from a complete payload — every metadata field you leave out is reset, so the run ends up as whatever this one body says. Use the partial update instead when you only mean to change some fields. |
| `restore_history` | Roll a test case back to an earlier revision — reapplies that snapshot's name, description, preconditions, steps, status, priority, owner, tags, defects, custom fields, attachments and reviewers to the live case |
| `search_all_projects` | Search every entity type across the account at once. |
| `search_duplicates` | Search the AI-suggested duplicate pairs with the full test-case filter grammar — narrow the review queue by folder, owner, tags, priority, status, custom fields or free text |
| `search_group_tags` | Search the workspace-wide tag vocabulary for one entity type and get each tag's id — the only tag read here that returns ids, so it is where you resolve the source_id and target_id a tag merge needs |
| `search_project_entities` | Search and filter a project's test cases, test runs, or the test cases inside one run — the general-purpose finder: free text plus status / priority / type / owner / folder / tag / date filters, with an id-only count mode |
| `search_project_entities_by_filter` | Search for entities within a project (v2 - POST with body) |
| `search_project_users` | Find people by name and read their role, permissions and product access — the search behind owner and assignee pickers; note it searches the whole workspace, not just this project's members |
| `search_test_case_tags` | Check whether a test-case tag name exists in a project, or complete a partial one, before tagging a case or building a tag filter |
| `search_test_results` | Find test results anywhere in the account without knowing the project, run or case — above all, list every result linked to a tracker issue (a Jira/ADO ticket key) to answer 'what testing covers this bug?', optionally narrowed by case priority |
| `send_report_email_now` | Email an existing report to specific people right now, as a PDF/CSV/XLSX attachment, without changing its schedule |
| `unlink_test_case` | Unlink a test case from a tracker ticket. |
| `unlink_test_run` | Unlink a test run from a tracker ticket. |
| `update_custom_field` | Change an existing test-case custom field — rename it, make it mandatory or optional, adjust its placeholder or default value, replace a dropdown's choices, or change which projects offer it |
| `update_custom_field_dataset_option` | Rename one dropdown choice, or make it the default — the option id stays the same, so cases already holding this value follow the new label |
| `update_custom_field_dataset_project_mapping` | Change which projects a custom field's dataset applies to — link projects so they see the field, or unlink them, which deletes the values those projects already stored |
| `update_custom_field_definition` | Rename a custom field, or change whether it is mandatory, its placeholder or its boolean default — a full replace of the field's attributes, not a partial edit |
| `update_dataset` | Replace a dataset's contents — rename it, or write a new set of columns and rows over the existing table |
| `update_exploratory_session` | Change fields on an existing exploratory session — retitle it, revise the charter, record the time spent, reassign it, move it to another folder, or replace its tags, configurations, attachments and linked issues |
| `update_exploratory_session_log` | Revise an observation already recorded in an exploratory session — correct the note, change its pass/fail/bug outcome, adjust the time spent or restate which defects it raised |
| `update_filter` | Rename a saved filter view, replace its conditions, or switch it between private and project-wide — resending name and entity on every call |
| `update_project_settings` | Turn a project's configuration flags on or off — review/approval gating, the custom test-case id prefix, test-case sharing, the manual-execution timer, Part 11 re-authentication, Jira/Azure linking and test-plan review |
| `update_report` | Rewrite a saved report — its type, window, filters, schedule or recipients — replacing the whole definition in one call |
| `update_shared_component` | Change an existing shared field - its title, rows, tags or collection - with the edit propagating to every test case that references it. |
| `update_shared_step` | Replace a shared step's title, folder and its whole ordered step list — the edit lands at once in every test case that embeds the block |
| `update_tag` | Rename a label across a project. |
| `update_template` | Rename a template, enable or disable it, make it the workspace default, or replace its description and property field layout. |
| `update_test_case` | Change one existing test case — rename it, rewrite its steps, preconditions or description, set priority/status/type/owner, retag it, relink issues or put it into review — sending only the fields you want changed |
| `update_test_plan` | Change an existing test plan or sub-plan — rename it, move its dates, retag it, relink issues, or start/complete it; note that attaching or detaching a test run is NOT done from the plan on v2, it is set on the run |
| `update_test_plan_by_integer_id` | Edit a test plan or sub-plan — rename it, change its dates, owner, tags, custom fields or reviewers, move its status forward, or replace the set of test runs it groups |
| `update_test_run` | Change just the fields you name on a test run — rename it, move its state on, link or unlink a test plan, attach configurations or a dynamic filter — leaving everything you omit untouched |

</details>

<details>
<summary><b>🧪 Automate</b></summary>

| Tool | What it does |
|---|---|
| `setupBrowserStackAutomateTests` | Integrate BrowserStack SDK and run web tests on BrowserStack. For visual testing/Percy, use the dedicated Percy tools. |
| `fetchAutomationScreenshots` | Fetch screenshots captured during a given Automate/App Automate session. |
| `listSessions` | List the sessions in an Automate/App Automate build. Each record carries `sessionId`, `name`, `status`, `os`, `osVersion`, `browser`, `device`, `browserUrl` (dashboard link), and `videoUrl`, with optional `limit` / `offset` paging and a client-side `status` filter. Takes either the **hashed** build ID from the dashboard URL or the observability build id returned by `getBuildId` / `listBuildId` — an observability id is resolved to the hashed id automatically via the build's sessions. Returned `sessionId` values work with `getFailureLogs`, `fetchAutomationScreenshots`, and `fetchSelfHealedSelectors`. |

</details>

<details>
<summary><b>📲 App Automate</b></summary>

| Tool | What it does |
|---|---|
| `takeAppScreenshot` | Launch the app on a specified device and capture a quick verification screenshot to confirm your app has launched. |
| `runAppTestsOnBrowserStack` | Run pre-built native mobile test suites (Espresso/XCUITest) by direct upload of compiled .apk/.ipa test files. |
| `setupBrowserStackAppAutomateTests` | Set up BrowserStack App Automate SDK integration for Appium-based mobile app testing. |

</details>

<details>
<summary><b>💻 Live</b></summary>

| Tool | What it does |
|---|---|
| `runBrowserLiveSession` | Start a Live session for website testing on desktop or mobile browsers. |

</details>

<details>
<summary><b>📱 App Live</b></summary>

| Tool | What it does |
|---|---|
| `runAppLiveSession` | Start a manual app testing session on a real device in the cloud. |

</details>

<details>
<summary><b>♿ Accessibility</b></summary>

| Tool | What it does |
|---|---|
| `accessibilityExpert` | Ask the A11y Expert (WCAG 2.0/2.1/2.2, mobile/web usability, best practices). |
| `startAccessibilityScan` | Start a web accessibility scan and retrieve a local CSV report path. |
| `createAccessibilityAuthConfig` | Create an authentication configuration (form-based or basic) for accessibility scans behind a login. |
| `getAccessibilityAuthConfig` | Retrieve an existing accessibility authentication configuration by ID. |
| `fetchAccessibilityIssues` | Fetch accessibility issues from a completed scan, with pagination support. |

</details>

<details>
<summary><b>🎨 Percy Visual Testing</b></summary>

| Tool | What it does |
|---|---|
| `percyVisualTestIntegrationAgent` | Integrate Percy visual testing into a new project and demonstrate visual change detection with a step-by-step simulation. |
| `expandPercyVisualTesting` | Set up or expand Percy visual testing coverage for existing projects (Percy Web Standalone and Percy Automate). |
| `addPercySnapshotCommands` | Add Percy snapshot commands to the specified test files. _(not available in Remote MCP)_ |
| `listTestFiles` | List all test files for a given set of directories. _(not available in Remote MCP)_ |
| `runPercyScan` | Run a Percy visual test scan. _(not available in Remote MCP)_ |
| `fetchPercyChanges` | Retrieve and summarize visual changes detected by Percy AI between the latest and previous builds. |
| `managePercyBuildApproval` | Approve or reject a Percy build. |

</details>

<details>
<summary><b>📊 Test Reporting & Analytics</b></summary>

| Tool | What it does |
|---|---|
| `getFailureLogs` | Retrieve error logs for Automate/App Automate sessions. App Automate log endpoints are build-scoped, so a hashed build ID is required there — pass one if you have it, otherwise it is resolved from the session automatically. |
| `fetchBuildInsights` | Fetch insights about a BrowserStack build by combining build details and quality-gate results. Includes `hashed_id` (the hashed build id `listSessions` takes) and `session_type`, resolved through the build's sessions when the build ran on Automate / App Automate. |

</details>

<details>
<summary><b>🤖 BrowserStack AI Agents</b></summary>

| Tool | What it does |
|---|---|
| `uploadProductRequirementFile` | Upload a PRD/screenshot/PDF and get a file mapping ID (used with `createTestCasesFromFile`). _(not available in Remote MCP)_ |
| `createLCASteps` | Generate Low Code Automation (LCA) steps from a manual test case in Test Management. |
| `fetchSelfHealedSelectors` | Retrieve AI self-healed selectors (plus test source) to fix flaky tests caused by DOM changes. |
| `prepareSelfHealingPlan` | Build a self-healing edit plan that bundles locator pairs with test source for your LLM to apply. Does NOT modify files itself. |
| `fetchRCA` | Fetch AI Root Cause Analysis for your failed Automate/App-Automate tests (by numeric test ID). Suggests fixes only; never auto-applies. |
| `getBuildId` | Get the BrowserStack build ID for a given project and build name, scoped to your builds. |
| `listBuildId` | Get the latest build ID for a project and build name, across all users (no user filter). |
| `listTestIds` | List the tests in a BrowserStack build (Automate or App Automate) with each test's `status` and `session_id`, optionally filtered by status (passed/failed/pending/skipped). The `session_id` feeds `getFailureLogs` and `fetchAutomationScreenshots` directly. |
| `askBrowserStackAI` | *(Alpha, limited availability)* Hand a multi-step task to BrowserStack's agent in plain language; it decides which calls to make and returns the answer plus the steps it took. Covers Test Management and Test Reporting & Analytics. Anything that would change data pauses for your confirmation in your own client; deletes are refused outright. Requires the account to be enrolled — otherwise it returns an entitlement error and nothing runs. |

</details>
