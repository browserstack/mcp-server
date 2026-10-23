# BrowserStack MCP Server — Tool Reference

Every tool the BrowserStack MCP Server exposes, organised by product the same way as the [BrowserStack MCP docs](https://www.browserstack.com/docs/browserstack-mcp-server/tools). Expand a product to see its full list. A tool appears under every product whose docs page lists it, so some tools appear more than once.

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
<summary><b>💬 Ask AI</b></summary>

| Tool | What it does |
|---|---|
| `askBrowserStackAI` | *(Alpha, limited availability)* Hand a multi-step task to BrowserStack's agent in plain language; it decides which calls to make and returns the answer plus the steps it took. Covers Test Management and Test Reporting & Analytics. Anything that would change data pauses for your confirmation in your own client; deletes are refused outright. Requires the account to be enrolled — otherwise it returns an entitlement error and nothing runs. |

</details>

<details>
<summary><b>🤖 AI Agents</b></summary>

| Tool | What it does |
|---|---|
| `fetchSelfHealedSelectors` | Retrieve AI self-healed selectors (plus test source) to fix flaky tests caused by DOM changes. |
| `createLCASteps` | Generate Low Code Automation (LCA) steps from a manual test case in Test Management. |
| `createTestCasesFromFile` | Generate test cases in bulk from an uploaded file using the Test Case Generator AI Agent. _(not available in Remote MCP)_ |
| `uploadProductRequirementFile` | Upload a PRD/screenshot/PDF and get a file mapping ID (used with `createTestCasesFromFile`). _(not available in Remote MCP)_ |
| `percyVisualTestIntegrationAgent` | Integrate Percy visual testing into a new project and demonstrate visual change detection with a step-by-step simulation. |
| `fetchPercyChanges` | Retrieve and summarize visual changes detected by Percy AI between the latest and previous builds. |
| `prepareSelfHealingPlan` | Build a self-healing edit plan that bundles locator pairs with test source for your LLM to apply. Does NOT modify files itself. |

</details>

<details>
<summary><b>🧾 Test Management</b></summary>

| Tool | What it does |
|---|---|
| `createProjectOrFolder` | Create a Test Management project and/or folders to organize test cases. Returns with Folder ID, Project ID and Test Management Link to access the TM Project Dashboard. |
| `createTestCase` | Add a manual test case under a specific project/folder (uses project identifier like PR-xxxxx and a folder ID). |
| `listTestCases` | List test cases for a project, optionally scoped to a folder (supports filters like case_type, priority, and pagination). |
| `uploadProductRequirementFile` | Upload a PRD/screenshot/PDF and get a file mapping ID (used with `createTestCasesFromFile`). _(not available in Remote MCP)_ |
| `createTestCasesFromFile` | Generate test cases in bulk from an uploaded file using the Test Case Generator AI Agent. _(not available in Remote MCP)_ |
| `createLCASteps` | Generate Low Code Automation (LCA) steps from a manual test case in Test Management. |
| `createTestRun` | Create a test run (suite) for selected test cases in a project. |
| `listTestRuns` | List test runs for a project (filter by dates, assignee, state). |
| `addTestResult` | Add a manual execution result (passed/failed/blocked/skipped) for a test case within a run. |
| `updateTestRun` | Update a test run's name/state and/or add test cases to it. |
| `getSubTestPlan` | Fetch a sub-test-plan (STP-*) under a parent plan, with its metadata and linked test runs. |
| `listSubTestPlans` | List sub-test-plans (STP-*) under a parent test plan (TP-*). Supports pagination. |
| `updateTestCase` | Update an existing test case. Any subset of fields may be changed (name, priority, status, steps, tags, etc.); only supplied fields are modified. |
| `listFolders` | List folders in a Test Management project (returns each folder's id, name, case counts, and sub-folder counts). Pass a parent_id to list sub-folders. |
| `listTestCaseTemplates` | List test-case templates with their numeric template_id, for use with `createTestCase` to apply a custom template. |
| `listTestPlans` | List test plans (TP-*) in a project, with name, status, dates, and active/closed run counts. Supports pagination. |
| `getTestPlan` | Fetch a test plan by identifier (TP-*) with its metadata, linked test runs, total test-case count, and status summary. |
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
<summary><b>⚡ Load Testing</b></summary>

| Tool | What it does |
|---|---|
| `compareLoadTestRuns` | Compare two executions (runs) of the SAME load test and surface the deltas — the regression check ('did the latest run regress vs the previous one?'). Not for comparing different tests: runs of different tests are rejected (DIFFERENT_TESTS). For a trend across more than two runs use getLoadTestHistoricalTrends. |
| `createLoadTest` | Create a new load test in a project — use this to define a test before running it. JSON body only (no multipart). |
| `estimateLoadTestRunCost` | Estimate the VU-hour cost of running a test before starting it — use this to answer 'how much will this run cost / will it fit in my quota?' |
| `getLoadTest` | Get the full configuration of a single load test — use this to inspect a test's settings, script reference, SLA thresholds and children. |
| `getLoadTestHistoricalTrends` | Show how one test's metrics trend across its recent runs — use this for 'is this test getting slower over time?' |
| `getLoadTestInsightSummary` | Get the AI insight (summary, root cause, recommendations) for a completed run — use this for 'why did this run regress or fail?' |
| `getLoadTestMetricsManifest` | Discover which metrics, @ aliases and groupBy options a test supports — call this before requesting a report, trend or comparison so metric names are valid. |
| `getLoadTestPlatformStatus` | Check whether the Load Testing service is operational — use this if calls are failing or to confirm availability before starting work. |
| `getLoadTestProjectTrends` | Show how a project's load-test metrics trend across recent runs — use this for 'is performance getting better or worse across this project?' |
| `getLoadTestQuota` | Check the account's remaining VU-hours and concurrency headroom — use this before starting runs to confirm capacity. |
| `getLoadTestRunReport` | Get the full metrics report for a completed run — KPIs, SLA verdicts, per-transaction and error breakdowns. Use this to answer 'how did this run perform?' |
| `getLoadTestRunStatus` | Poll the live status and progress of a run — use this to wait for a run to finish or check elapsed/remaining time. |
| `listActiveLoadTestRuns` | List load-test runs currently executing — use this for 'what's running right now?' or to find a runId to stop or monitor. |
| `listLoadTestProjects` | List the caller's load-testing projects, most recently active first — use this to find a projectId or answer 'what projects do I have?' |
| `listLoadTestRuns` | List the execution history of a test — use this to find past runs of a specific test or to get a runId. |
| `listLoadTests` | List the load tests in a project — use this to find a testId or browse tests, optionally filtered by type, framework, tag or recent activity. |
| `listProjectLoadTestRuns` | List the execution history across every load test in a project — newest first, paginated. Use for 'what ran last week in this project?'. |
| `searchLoadTests` | Find a load test by name across ALL of the caller's projects — use this to resolve a named test to a testId without knowing which project it is in. |
| `startLoadTestRun` | Start a run of an existing load test — use this to execute a test, optionally overriding VUs, duration or locations. |
| `stopLoadTestRun` | Stop a running load test — use this to abort an execution that is running or queued. |
| `updateLoadTest` | Update an existing load test's name or configuration — use this to change tags, SLA thresholds, script or settings; also tags a specific run when runId is set. |

</details>

<details>
<summary><b>📱 App Live</b></summary>

| Tool | What it does |
|---|---|
| `runAppLiveSession` | Start a manual app testing session on a real device in the cloud. |

</details>

<details>
<summary><b>💻 Live</b></summary>

| Tool | What it does |
|---|---|
| `runBrowserLiveSession` | Start a Live session for website testing on desktop or mobile browsers. |

</details>

<details>
<summary><b>📲 App Automate</b></summary>

| Tool | What it does |
|---|---|
| `takeAppScreenshot` | Launch the app on a specified device and capture a quick verification screenshot to confirm your app has launched. |
| `listTestIds` | List the tests in a BrowserStack build (Automate or App Automate) with each test's `status` and `session_id`, optionally filtered by status (passed/failed/pending/skipped). The `session_id` feeds `getFailureLogs` and `fetchAutomationScreenshots` directly. |
| `setupBrowserStackAppAutomateTests` | Set up BrowserStack App Automate SDK integration for Appium-based mobile app testing. With `accessibility: true`, the run also performs App Accessibility (WCAG) checks on the screens the tests interact with, and the output says what makes a scan happen and how to read the issues. |
| `runAppTestsOnBrowserStack` | Run pre-built native mobile test suites (Espresso/XCUITest) by direct upload of compiled .apk/.ipa test files. With `accessibility: true`, the build also performs App Accessibility (WCAG) checks, and the answer says how to read the issues once it finishes. The checks need a suite built with BrowserStack's instrumentation: for Espresso the Gradle plugin and Java SDK, for XCUITest the Swift SDK, embedded and initialized. |

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
<summary><b>♿ Accessibility</b></summary>

| Tool | What it does |
|---|---|
| `startAccessibilityScan` | Start a web accessibility scan of a page URL and retrieve a local CSV report path. Mobile apps are scanned through an App Automate run instead (`setupBrowserStackAppAutomateTests` with `accessibility: true`). |
| `accessibilityExpert` | Ask the A11y Expert (WCAG 2.0/2.1/2.2, mobile/web usability, best practices). |
| `createAccessibilityAuthConfig` | Create an authentication configuration (form-based or basic) for accessibility scans behind a login. |
| `getAccessibilityAuthConfig` | Retrieve an existing accessibility authentication configuration by ID. |
| `fetchAccessibilityIssues` | Fetch accessibility issues, with pagination, from a Website Scanner run, an Automated Tests build (web) or App Accessibility build (mobile app, by the build id the SDK prints), a Workflow Analyzer report, an App Accessibility manual report (`appReportId`), or a report's dashboard link. Once the tests or scan have finished, waits while the report is still processing; a run still in progress is read as it is, with a note. For an app build with no scans, lists the likely causes. |
| `listAppAccessibilityReports` | List App Accessibility (mobile app) work newest first, with the ids `fetchAccessibilityIssues` reads: a project's builds (`kind: automated`; without `projectName`, the projects), or the manual Workflow Analyzer reports (`kind: manual`). |

</details>

<details>
<summary><b>📊 Test Reporting & Analytics</b></summary>

| Tool | What it does |
|---|---|
| `getFailureLogs` | Retrieve error logs for Automate/App Automate sessions. App Automate log endpoints are build-scoped, so a hashed build ID is required there — pass one if you have it, otherwise it is resolved from the session automatically. |
| `getBuildId` | Get the BrowserStack build ID for a given project and build name, scoped to your builds. |
| `fetchBuildInsights` | Fetch insights about a BrowserStack build by combining build details and quality-gate results. Includes `hashed_id` (the hashed build id `listSessions` takes) and `session_type`, resolved through the build's sessions when the build ran on Automate / App Automate. |
| `fetchRCA` | Fetch AI Root Cause Analysis for your failed Automate/App-Automate tests (by numeric test ID). Suggests fixes only; never auto-applies. |
| `listTestIds` | List the tests in a BrowserStack build (Automate or App Automate) with each test's `status` and `session_id`, optionally filtered by status (passed/failed/pending/skipped). The `session_id` feeds `getFailureLogs` and `fetchAutomationScreenshots` directly. |
| `listBuildId` | Get the latest build ID for a project and build name, across all users (no user filter). |
| `assign_issue_types_to_test_runs` | Bulk-assign a failure category / issue type to a list of test runs (the 'mark failure reason' action on the failure-analysis screens) and get back how many rows were updated. |
| `assign_test_run_failure_categories` | Bulk-assign failure categories (issue types / sub-types) to a set of test runs — the 'categorise these failures' action on the test listing; returns the resulting issue types. |
| `check_build_comparison_available` | Pre-flight check of whether two builds can actually be compared (and why not), so the UI can show a 'comparison unavailable' state before firing the expensive aggregation. |
| `check_dashboard_widget_ignored_filters` | Validate a widget's saved test-case filter values against the current project and report which are no longer valid — so stale filter chips (a deleted tag, priority, status, type or linked requirement) can be flagged or dropped. |
| `clone_dashboard` | Copy an existing dashboard (its persisted widgets) into a new dashboard via the public API — typically to fork a template dashboard under a new name/level. |
| `clone_dashboard_view` | Duplicate an existing dashboard — copy its filters, widgets, source and type into a new dashboard owned by the caller, under a new name. |
| `clone_report` | Duplicate an existing report under a new name — 'Make a copy' in the Reports UI — copying the source report's saved filters and widgets. |
| `create_build_group` | Create a new run group (build group) in a project so builds can be grouped for a release or test cycle. |
| `create_check_configurations` | Register up to 10 check-run configurations on a repository so BrowserStack posts a named check (quality-gate or build status) back to the VCS for commits/PRs, bound to a given project, build name and branch. |
| `create_checks_mapping` | Register a pull request's VCS checks (e.g. GitHub check runs) against existing BrowserStack check configurations, so the PR-checks / quality-gate pipeline can evaluate them and call back with results. |
| `create_dashboard` | Create a new custom dashboard with its widget layout via the public API, so a client (or the AI dashboard builder) can provision a dashboard programmatically instead of building it in the UI. |
| `create_dashboard_view` | Create a new custom dashboard view — its name, visibility level, global filters and widget layout — for the Test Observability (TO) or Test Management (TCM) dashboard page. |
| `create_report` | Create a new saved report — its name, visibility level, global filters and the list of report widgets — and get back the persisted record. |
| `create_self_healing_pr` | Open a GitHub pull request that rewrites broken selectors to their AI-healed values — pick the healed locators you accept from a build's healing report and ask BrowserStack to raise the PR in the customer's repo. |
| `create_view` | External/public API to save a filter query as a named view (private or shared with the org) for a screen. |
| `generate_build_report` | Ask for a build's summary report in the requested formats — the CI-plugin endpoint. It is a polling protocol: the first request usually returns IN_PROGRESS with the retry count and interval to use, and later poll requests return the finished report once the build's data has settled. |
| `get_always_failing_tests_trend` | Get the always-failing card for a project - the percentage and count of consistently broken (permanently red) tests over the window plus the sparkline series, to see whether they are growing. |
| `get_build_accessibility_meta` | Get the build-level accessibility summary header — whether auto-scan was enabled, the severity breakdown (critical/serious/moderate/minor) and the total issue count — for the strip above a build's per-test accessibility listing. |
| `get_build_ai_failure_summary` | Get the AI-generated narrative of why a build failed — a summary paragraph plus the top failure themes (name, description, affected test count, failure %) and the top affected workflows. |
| `get_build_ai_failures` | Public API: get a build's AI failure analysis (clustered failure themes and their workflows, sorted by failure share), the summary a build-RCA agent uses to explain a build failure. |
| `get_build_always_failing_stats` | Get the 'always failing' tile for a build — how many of the build's tests have been failing consistently (out of the total), plus the tile's comment count — for the build insights page. |
| `get_build_attempt_run_stats` | Break a build's test results down per re-run attempt — pass/fail/skipped/unknown and workflow-status counts for attempt 1, 2, 3… (including manual runs) — so you can see how results changed across retries. |
| `get_build_comparison_aggregation` | Get the headline counts for a base-vs-target build comparison — additional, dropped, no-change, newly failed, started passing, and failed-with-a-different-reason — the summary strip at the top of the Build Comparison page. |
| `get_build_comparison_meta` | Get the two build summary headers shown side by side on the Build Comparison page — name, status, timings, framework and status counts for both the base and the target build. |
| `get_build_coordinates_from_uuid` | The inverse of the coordinate lookup: given a build UUID, get the URL-safe coordinates for it (project & build normalised names, serial id, project id/name, finished/created timestamps) so a caller holding only a UUID can construct the build's dashboard URL. |
| `get_build_details` | Get the main build-detail payload for one build — status, run counts, framework/CI metadata, cross-product and test-plan info — plus the per-build UI gates (whether to show the Self-Healing tab, the Authoring Agent tab, and whether App Accessibility is enabled). |
| `get_build_failure_category_stats` | Get the failure-category (defect) breakdown for a build — how many failures fall into each issue type/category, how many have AI RCA available, and the comment count — for the 'Failure Categories' panel. |
| `get_build_failures_by_module` | Get a build's failures grouped by test module / file path, so you can see which modules or suites contribute most of the failures. |
| `get_build_filter_values` | Get the distinct filter values available for one build's test listing (browsers, OSes, tags, issue types, statuses, plus static history/flaky options) so the UI can render the filter dropdowns. |
| `get_build_flaky_stats` | Get the flaky-tests tile for a build — how many of the build's tests were detected as flaky (with a 'out of total' meta) plus the tile's comment count. |
| `get_build_frequency` | Get how often builds ran over a period - run counts per build name (or for one build name) - so a team can see CI cadence and gaps. |
| `get_build_history` | Get the trend of the recent builds of the same build name leading up to this one (per-build pass/fail counts, keys, lock state) so the build page can show how this build compares with previous runs. |
| `get_build_id_from_build_coordinates` | Resolve a human-readable build coordinate (project name + build name + build serial number, i.e. what appears in a build URL) into the internal build id/UUID, so deep links and CI references can be turned into an API-usable handle. |
| `get_build_insights` | One-call failure summary for a build, built for agents and CI bots — status metrics (test vs hook counts), failure categorisation (new failures / always-failing / flaky), defect stats and a top-errors analysis for the run. |
| `get_build_list_filters` | Populate the build-listing filter bar for a project in one call — the static catalogue of selectable build filters (statuses, frameworks, build types, product sources, creation types) plus the caller's currently applied filter echoed back resolved. |
| `get_build_muted_stats` | Get the muted-tests tile for a build — how many of the build's tests are muted (with a 'out of total' meta) plus the tile's comment count. |
| `get_build_name_status_aggregation` | For one project and time window, return a per-build-name breakdown of run counts by display status ('for each distinct build name, how many runs passed/failed') - used to pick the noteworthy builds for the summary. |
| `get_build_new_failure_stats` | Get the new-failures tile for a build — how many tests failed in this build that were not failing before — plus the tile's comment count. |
| `get_build_non_sdk_test_counts` | Get data-hygiene counters for a build (including its split child builds) — how many test runs are untitled, how many are unmarked, and how many have no failure reason — used to nudge non-SDK / untitled instrumentation setup. |
| `get_build_notification_summary` | Get the compact build summary used to render the build-summary email / notification card — name, project, run-by, status/issue-type/history aggregates, muted and total counts, build alerts and quality-gate status. |
| `get_build_performance_chart` | Get the duration-over-time series for one specific build, addressed by its identifier in the path - what the UI calls when a performance leaderboard row is expanded. |
| `get_build_quality_gate_result` | The CI-facing quality gate check: given a build UUID, return whether the build passed or failed its quality gate (or that it is still running), so a pipeline can decide to proceed or fail. |
| `get_build_quality_gate_summary` | The readiness-aware quality-gate summary for a build: return the per-profile results, or instead a status message when the build is still pending, the auto-analyser is running, or an evaluation state is cached. This is the endpoint to poll after triggering a recalculation. |
| `get_build_quality_profile_result` | Drill into a single quality profile's result for a build: the individual rules, their thresholds and rendered conditions, and each rule's pass/fail outcome — for the quality-gate detail drawer. |
| `get_build_rerun_stats` | Get the flat re-run summary for a build — a list of re-run legs with per-leg pass/fail/skipped/unknown counts and totals — for the re-run section of the build page. |
| `get_build_self_heal_summary` | Get a build's self-healing headline numbers for the build-insights page — how many tests and locators were healed, with counts and percentages. |
| `get_build_sidebar_filters` | Hydrate the build-listing sidebar filter panel across a set of projects — the caller's applied selection resolved into display objects (user/team ids to names, date range, tags, branches, statuses, build names) alongside the static option catalogue. |
| `get_build_stability_chart` | Get the stability-over-time series for one specific build, addressed by its identifier in the path - what the UI calls when a stability leaderboard row is expanded. |
| `get_build_stability_tile` | Get the stability tile for a build — the share of tests that ran cleanly versus flaky / always-failing / new-failure noise, with a percentile insight versus recent builds — for the build insights page. |
| `get_build_summary` | Get one build's public record by uuid — identity and naming, status and per-status test counts, plus the pro-plan smart tags and unique errors. Narrower than get_build_details, which is the same build seen from inside the product. |
| `get_build_summary_stats` | Get the headline test-count strip for a build under the currently applied filters — total / passed / failed / skipped / pending roll-ups plus AI-RCA and session counts — the summary strip at the top of the build insights page. |
| `get_build_test_filters` | Get the filter panel for a build's TEST listing — the currently applied test filters resolved with labels, the static catalogue of every selectable test filter, hooks visibility, and which filters are pro-only for this workspace. |
| `get_build_timeline_stats` | Get the build's execution timeline — per-status series (passed / failed / pending=running) over the build's lifetime — for the timeline visualisation on the build page. |
| `get_build_top_error_stats` | Get the 'Top unique errors' insight panel for a build — the most frequent error clusters with their test-run counts, respecting the active listing filters. |
| `get_checks_mapping` | Fetch a single previously-registered PR-check mapping (a vcs_ingestion row plus its joined check configuration) to see its current evaluation state, retry count, PR metadata and callback URL. |
| `get_cross_browser_coverage` | Get the cross-browser-testing coverage breakdown for a project - the window's executions aggregated by browser, OS and device and grouped into primary/secondary platform buckets with counts and percentages. |
| `get_daily_summary_report` | Build the one-shot payload for the daily/periodic summary email: for a set of projects and a time window, per-project build counts, top failed builds, failed-test summary and failure-category breakdown, with the top failed build best-effort enriched with AI RCA, self-healing and test-authoring summaries. |
| `get_dashboard` | Fetch one dashboard's full definition (name, type, level and the widget list with each widget's config) via the public API, so a client can render or edit it. |
| `get_dashboard_public_link_setting` | Check whether public 'anyone with the link' sharing is currently turned on for a custom dashboard. |
| `get_dashboard_view` | Load one dashboard view for rendering — its name, global filters and full widget configuration, with filter values injected for the built-in dashboards. |
| `get_dashboard_view_widget_data` | Compute the data for one widget on a project-scoped dashboard view — applying the caller's global filters and time window — to render that widget (charts, stat cards, trends, etc.). |
| `get_default_project` | Resolve which project the UI should land on: the named project if normalisedName is given and exists, otherwise the group's most recently updated project — for app load and deep links where the named project may no longer exist. |
| `get_device_tier_usage` | Get the group's mobile device-tier entitlement picture for a product - per tier, the devices in it, the device/parallel limits and how much of each is in use - for the device-tier/queue capacity view. |
| `get_failure_categories_trend` | Break a project's failures down by failure category over time, so a team can see which classes of failure (defect types) are trending up and their share of the total. |
| `get_flakiness_trend` | Get the flakiness card for a project's Testing Trends page - the percentage and count of flaky tests over the window plus the sparkline series, to track whether suite flakiness is improving. |
| `get_group_plan_usage_details` | Load the plan/usage panel: the group's plan info and plan details plus non-BrowserStack test-execution consumption - used vs total executions for the team and the whole group, usage percentages, BrowserStack-run count, and the billing reset date. |
| `get_home_takeaways` | Get the Home page 'key takeaways' cards with the aggregate time-saved metric - stability, pass-rate, always-failing/flaky/new-failure counts and a single time-savings percentage, versus the previous 7-day window. |
| `get_home_takeaways_with_noise_breakdown` | Get the Home page 'key takeaways' cards with the failure-noise breakdown - the same stability/pass-rate story plus per-category (flaky, always-failing, auto-analyzed, unique-error) failure counts and their percentage reductions. |
| `get_latest_build` | Find the most recent build in a project matching optional filters (build name, triggering user, build tags, framework) and get its full build-details payload — the entry point for 'the latest run of X' when you don't know the build uuid. |
| `get_new_failures_trend` | Get the new-failures card for a project - the percentage and count of tests failing for the first time in the window plus the series, the 'what did we just break' regression signal. |
| `get_org_dashboard_widget_data` | Compute the data for one widget on a multi-project (org-level) dashboard, from the widget definition plus the global filters and time window supplied in the body. |
| `get_parallel_queue_usage_summary` | Get the top-level parallel-queue summary for the signed-in user's group: plan test-execution usage plus current parallels-in-use and queued sessions for the requested product. |
| `get_project_automation_coverage` | Get one project's automation-coverage figures - total test cases, automated count and coverage percent over all time - to chart automation progress from outside the UI. |
| `get_project_by_id_or_name` | Fetch one project's full resource representation by either numeric id or normalised name — the project header/settings context (id, name, entry type, configuration, permissions). |
| `get_project_non_sdk_build_count` | Get just the count of non-SDK builds in a project — a cheap, all-time yes/no signal for whether to show SDK-onboarding prompts. |
| `get_project_non_sdk_summary` | Get, over a date range, how many of a project's builds were ingested WITHOUT the BrowserStack SDK plus the resulting data-quality gaps (untitled tests, unmarked tests, tests with no failure reason) — the numbers behind the 'switch to the SDK' nudge. |
| `get_project_performance_chart` | Get the project-wide duration-over-time series for the Testing Trends performance chart - across all builds, or for one build selected by build name. |
| `get_project_public_link_setting` | Check whether public link sharing is on for a project's report pages such as build insights. |
| `get_project_quality_gate_settings` | Return a project's quality-gate configuration over the public (access-key) API: whether gates are enabled, whether the gate overrides build status, and the profiles attached to the project. Use this from CI/integrations authenticated with a username+access-key. |
| `get_project_stability_chart` | Get the project-wide stability-over-time series for the Testing Trends stability chart - across all builds, or for one build selected by build name. |
| `get_quality_profile` | Fetch one quality-gate profile in full — rules, thresholds and build filters — over the public (access-key) API, with failure-category operands resolved to the project's display names. |
| `get_report` | Load one saved report's full definition — name, level, filters and widget/report configuration — to render or edit it. |
| `get_report_dataset_rows` | Run a report widget's query and get its paginated result rows — the actual table data behind a tabular test-runs report tile. |
| `get_report_stat_tiles` | Get the summary stat tiles (aggregate KPI numbers) for a report widget — the headline figures shown above the report table. |
| `get_report_test_stats` | Get the headline stats for one test case in the tabular test-runs report - its reliability (failure ratio), average duration, and failed/total occurrence counts over the filtered window - for the detail drawer. |
| `get_report_test_trend` | Get the per-run trend series for one test case in the tabular test-runs report - duration per execution plus each point's workflow status and colour, keyed by build - to draw the test's history chart. |
| `get_self_healing_pr_status` | Poll a self-healing PR job started by create_self_healing_pr — get its in-progress/terminal state and, once ready, the created pull request URL. |
| `get_session_app_profiling` | Get app-profiling data (CPU/memory/etc. captured during an App Automate session) for the Test Details app-performance tab. |
| `get_session_capabilities` | Get the raw desired/actual capabilities a session was started with (Automate or App Automate), so a user can see exactly how the run was configured. |
| `get_session_details` | Get the header/metadata block for a session on the Test Details page: video/audio log handles, session URL, platform/device, framework and timings the tabs are built from. |
| `get_session_network_log_url` | Get the URL of a session's HAR network log for the Test Details network tab — returns a link to the HAR file plus its fetch status, not the parsed entries. |
| `get_session_test_code` | Public API: get the test source code captured for an Automate session, one entry per test executed in that session, so external tooling (e.g. AI agents) can read the code behind a session. |
| `get_split_build_rerun_stats` | Get the split-build-aware re-run summary for a build — re-run legs grouped (with per-split breakdowns) plus an overall aggregate summary — resolved against the whole build and the Observability project id so split/parent-child builds are handled correctly. |
| `get_suite_health_stats` | Get the aggregate stat tiles for one test on the Suite Health detail page — reliability (failure %), average duration and failed/total run counts over the selected window. |
| `get_suite_health_test_info` | Get the header metadata for one test's Suite Health detail page — the test's display name plus the list of OS / browser / device combinations it has executed on — used to populate the platform filter. |
| `get_suite_health_test_platform_breakdown` | Break one test's stability and performance down per OS / browser / device combination, so you can see which platform is driving its flakiness or slowness. |
| `get_suite_health_trend` | Get the per-execution time series for one test on the Suite Health detail page — each run's status, workflow status, duration, build context and smart-tag flags (flaky / newly failed / always failing / performance anomaly) — for the trend chart. |
| `get_tabular_test_runs_report_tiles` | Get the summary stat tiles that sit above a report's table (totals and aggregates for the same report definition) so the header cards can load independently of the paginated rows. |
| `get_test_base_info` | Get the identifying header info for one test in the Test Health detail view — its name and the environment (OS/browser/device) combinations it ran on — for the selected window. |
| `get_test_environment_breakdown` | Break one test's results down by environment (OS / browser / device) over the window, so you can see whether its instability is platform-specific. |
| `get_test_execution_usage_count` | Count test executions reported to Observability in a time window for a user or group, split into total tests and tests that ran on BrowserStack infrastructure - the raw numbers behind usage/consumption reporting. |
| `get_test_executions_trend` | Get the test-execution volume card for a project - how many tests ran over the window, bucketed over time, to correlate suite growth or CI changes with other trends. |
| `get_test_filter_options` | Get the whole filter sidebar for the Suite Health test list: the currently applied filters resolved into display fields, the available static filter options (failure categories, OS/browser/device, sources, run-level options, etc.), and the project's default hooks visibility. |
| `get_test_growth_trend` | Get the test-suite growth card for a project - how the number of unique test cases changed over the window, with the timeline series, i.e. whether the suite is actually growing. |
| `get_test_health_stats` | Get the aggregate stat tiles for one test on the legacy Test Health detail view — reliability (failure %), average duration and failed/total run counts — optionally narrowed to one browser/OS/device. |
| `get_test_health_trend` | Get the per-execution trend line for one test on the legacy Test Health detail view — each run's status colour, duration and build context over the window — to plot stability and duration over time. |
| `get_test_metrics_chart` | Get the Suite Health page chart data in one call: time-bucketed failures-over-executions, average duration, and average failure-rate series for the project's tests over a window, filtered by the full Suite Health filter set. |
| `get_test_rca` | Public-API fetch of a failed test run's AI root-cause analysis; by default get-or-create (queues a generation and returns the pending state if none exists), or a strict read with peek=true. |
| `get_test_rca_data` | Read an already-generated AI RCA for a test run with NO side effects — the safe counterpart to get_test_rca that never creates a record or queues a generation. |
| `get_test_run_accessibility_meta` | Accessibility detail for a single test on the Test Details page — that test's a11y score, total issues and severity breakdown, and its report URL. |
| `get_test_run_app_logs` | Get a test run's application (app-under-test / SDK) log lines, parsed and flattened for display — use this for the app-logs tab when you want normalised rows rather than raw Loki JSON. |
| `get_test_run_app_logs_raw` | Get a test run's application logs as Loki's raw, unparsed JSON response — use this only when you need the native Loki shape; for displayable rows use the parsed app-logs capability instead. |
| `get_test_run_baseline` | Find a failing run's baseline — the most recent passing run of the same test in the last 30 days — returned with full test detail, so you can diff a failure against the last known-good execution. |
| `get_test_run_behaviour` | Get the BDD/behaviour payload stored on a test run (the Gherkin feature/scenario structure in the run's meta) that backs the Behaviour tab for Cucumber-style frameworks. |
| `get_test_run_bug_report_draft` | Build the pre-filled bug-report draft for a failed test — test name/status/duration, platform/browser, failure category, CI and host info, build name, retries, screenshot/log attachments and the AI RCA snippet — i.e. everything the 'Report a bug to Jira/Azure' modal needs to compose a ticket. |
| `get_test_run_build_insights` | Get the build-level insights that surround a failing run — the parent build's failure/flakiness summary, failure categorisation and top-errors analysis, plus this run's own file/module failure context — so a failure can be reasoned about in context. |
| `get_test_run_details` | Get the full detail of one test run — its metadata plus the captured test code and the code of the before/after hooks that ran around it, i.e. everything needed to understand what the test did. |
| `get_test_run_hooks` | Public API: list the before/after setup and teardown hook executions relevant to a test run, so a failure can be attributed to a hook rather than the test body. |
| `get_test_run_log_bundle` | Public API: get the full log bundle for a test run — BrowserStack session logs (console/network/selenium/appium/video), SDK logs, hook-run logs, failure and step logs — as URLs plus the test start/finish timestamps and framework. |
| `get_test_run_media_logs` | Get the media/session block for a test run's detail page — the session video (with playback offsets), audio log, the BrowserStack session and Percy build URLs, framework, whether the run is SDK-based, plus custom metadata. |
| `get_test_run_merged_logs` | Get a single merged, time-ordered log stream for a test run — BrowserStack session logs, SDK logs, hook-run logs, failure and step logs combined into one list, with content merged server-side — for the Logs tab. |
| `get_test_run_meta` | Get the primary metadata blob for a single test run — identity (name, file/test-case identifier), status, flakiness/mute flags, issue type and RCA data, retries, build context and, unless excluded, its recent execution history — feeding the header of the test-detail drawer. |
| `get_test_run_network_log_url` | Get the pointer to a test run's network (HAR) log rather than its content — the S3/BrowserStack URL plus status code and message, so the client fetches (or skips) the file itself. |
| `get_test_run_network_logs` | Get a test run's network (HAR) entries parsed server-side — obs-api downloads the HAR, filters it to the test window and returns the request entries so the Network tab renders without the browser downloading the raw file. |
| `get_test_run_overview` | Get the Overview-tab payload for a single test run — framework/SDK and platform context (browser, OS, device), the BrowserStack session id, user and BrowserStack tags, and the run's start time. |
| `get_test_run_retry_logs` | Get the screenshot/log attachment structure captured for a single retry attempt of a test, so the retries tab can render that attempt's evidence. |
| `get_test_run_test_code` | Get the source location of the test that produced a run — the file name and a deep link into the connected VCS (GitHub/GitLab/etc.) built from the build's VCS info — for the Test code tab. |
| `get_test_runs_history_details` | For a batch of test runs (or hook runs), get each one's execution history across previous builds together with its logs and failure/issue-type info — the data behind the test details 'history' panel, used to judge flakiness and whether a failure is new. |
| `get_unique_error_build_trend` | Get the occurrence trend of one unique error across builds over time — matching runs (timestamp, status, duration) grouped by status series and enriched with build info — to plot when and in which builds the error appeared. |
| `get_unique_error_filters` | Build the whole filter sidebar for a project's Unique Errors page in one call — the currently applied selections echoed back as display fields, the static dropdown option sets (failure categories, statuses, platforms, users, teams, sources, folders...), and the project's default hooks visibility. |
| `get_unique_error_impacted_tests` | Expand one unique-error cluster into the individual tests that hit it — each with the browsers/devices/platforms it failed on and an occurrence series — the timeline/detail view behind a row in the unique-errors list. |
| `get_unique_error_occurrence_count` | Get the total number of times one unique error occurred in the window, plus a per-day count series — the headline count and sparkline for the error detail panel. |
| `get_unique_error_platform_breakdown` | Break one unique error down by environment — which OS / browser / device combinations it occurred on and how often — so a team can tell whether the error is platform-specific. |
| `get_unique_error_summary` | Get the header/summary block for one unique error — its test name, the sample error text (split into lines), and the OS/browser/device combinations it was seen on — to describe what the error actually is on the detail page. |
| `get_unique_error_timeline_charts` | Get the Suite Health unique-errors timeline in one call — three day-bucketed time series over the window (unique errors, unique impacted tests, total impacted executions), each with its headline total — for the project's failed tests. |
| `get_widget_drilldown_records` | Return the underlying row-level records behind a widget data point - the 'click a bar to see the builds/tests it represents' drill-down for a dashboard widget. |
| `improve_test_rca` | Re-run ('improve') a test's RCA with an extra instruction and optional attachments, on behalf of an agent acting for the customer — returns the new conversation message id to poll. |
| `link_bug_to_test_run` | After a bug has been created in a PM tool (Jira, Azure Boards, …), link that external issue to the test run — recording it in the run's integration tables and marking the test as bug-reported so the UI shows the issue key/link. |
| `list_ai_failure_theme_test_runs` | Drill into one AI failure theme or workflow of a build and list the flat, paginated test runs behind it. Takes a theme or workflow id only — to fetch an explicit set of test-run ids instead, use list_build_ai_failure_cluster_test_runs, which accepts testRunIds. |
| `list_build_accessibility_test_runs` | List the accessibility-scanned tests of one build for the build's Accessibility tab — per test: name, file, status, OS/browser, a11y score, page/component counts and a critical/serious/moderate/minor issue breakdown, with paging. |
| `list_build_ai_failure_cluster_test_runs` | List a build's AI-failure test runs as a flat, cursor-paginated list with full details — fetch an explicit set of test-run ids, drill into one failure theme or workflow cluster, or omit both to span the whole build. |
| `list_build_branch_filter_options` | Type-ahead options for the 'Branch' filter on a project's build listing — git branch names seen in the project's builds, as {id, value, label} option objects. |
| `list_build_bstack_error_sessions` | List the sessions in a build that failed because of BrowserStack-side infrastructure errors, so the test listing can separate platform problems from genuine test failures. |
| `list_build_comment_threads` | Power the build-level comments side panel — list the comment threads across a build and all its re-runs, grouped by thread and ordered by most recent activity, with each thread's page type and test-run uuid for deep-linking. |
| `list_build_comparison_bucket_tests` | List the actual tests inside one bucket of a build comparison (e.g. newly-failed, started-passing, dropped, additional), grouped for display — the drill-down when a user clicks an aggregation tile. |
| `list_build_groups` | List a project's run groups (build groups) with paging and name search — the source of run-group ids for linking, closing, editing or deleting; can also fetch a specific set by ids. |
| `list_build_history_with_defect_counts` | Get the trend context for a build for an automated failure agent — this build plus up to N earlier runs of the same build name, newest first, each with number, status, timings and a pass/fail/skip plus defect-type count summary. |
| `list_build_names` | List the distinct build names seen in a project within the plan's retention window - the source of the build-name values every other Testing Trends card filters by. |
| `list_build_quality_profile_results` | Return the per-quality-profile results for a build as a flat list: each profile with its name, uuid and per-status rule counts — the quality gate breakdown on the build page. |
| `list_build_summaries_by_ids` | Return full build summaries for an explicitly supplied list of build ids within one project - the follow-up call once you know which builds you want. |
| `list_build_tag_filter_options` | Type-ahead options for the 'Build tag' filter on a project's build listing — matching build-tag values as {id, value, label} option objects. |
| `list_build_team_filter_options` | Type-ahead options for the 'Team' filter on a project's build listing — BrowserStack teams that have builds in the project, as {id, value, label} option objects. |
| `list_build_test_folders` | Browse the folder-tree view of a build's test listing: with no folder_path, list the paginated root folders (with pass/fail roll-ups); with a folder_path, get that folder's details and its sub-folders. All the build's test-listing filters apply. |
| `list_build_test_run_counts` | For every unique test in a build (keyed by test hash), get how many times it ran across the build and its re-runs, and whether those runs spanned different platforms — what the UI uses for rerun/retry badges. |
| `list_build_test_run_sdk_logs` | Page through the test runs in a build that have SDK-captured logs/attachments, with the per-build attachment total — backs the build's log/attachment viewer. |
| `list_build_test_runs` | List a build's test runs as the UI suite/folder tree, with the full filter set (status, flaky, muted, re-runs, tags, failure category, device/os/browser, folders, performance anomaly, new/always-failing), sorted and cursor-paginated, with deep-link URLs back to the BrowserStack UI. |
| `list_build_test_runs_flat` | List a build's test runs as a flat, filterable list (rather than the nested suite/folder hierarchy) — the data source for the flat test-listing view of a build. |
| `list_build_test_runs_flat_filtered` | List a build's tests as a flat, filterable, sortable, cursor-paged list (no suite/file nesting) — the build's test-listing table, with the full V2 filter surface and public-link sharing support. |
| `list_build_test_runs_hierarchy` | List a build's tests as the hierarchical suite/file/test tree the build detail page renders, with full filtering, sorting and cursor paging; this is the variant that honours public-link sharing and forwards custom filter params. |
| `list_build_test_runs_hierarchy_without_public_link` | List a build's tests as the same hierarchical suite/file/test tree, for session-authenticated callers that do not need public-link sharing or custom-param pass-through. |
| `list_build_test_runs_with_attachments` | List only the test runs in a build that actually have attachments or screenshots, with per-run counts — the discovery step before downloading artefacts run by run. |
| `list_build_user_filter_options` | Type-ahead options for the 'User' (build owner) filter on a project's build listing — matching users as {id, value, label} option objects. |
| `list_check_configurations` | List the SCM check-run configurations set up for a repository — the rules deciding which BrowserStack build/project a commit or PR check reports on, and whether it posts quality-gate or build status. |
| `list_comments` | Fetch the comments to render inline on a build-insights or test listing page — comments for a build (and a window of preceding build numbers), optionally narrowed to one test, to your own comments/mentions, and optionally excluding re-runs. |
| `list_dashboard_view_custom_field_filters` | List the project's custom (user-defined) test-case fields that can be used as filters when configuring a test-case dashboard widget. |
| `list_dashboard_view_widget_types` | List the catalogue of widget types that can be added to a dashboard view (the 'add widget' palette) with their display names. |
| `list_dashboard_views` | List the dashboard views the current user can see (their own private ones plus group/shared ones) with name, visibility level, widget count and owner — the dashboard picker / dashboard list. |
| `list_dashboard_widget_filter_values` | Fetch the selectable values for one filter inside a dashboard widget's filter editor (the type-ahead / value picker) — e.g. the build names, tags, users, teams or test-case field values available for a project, given the currently applied filters. |
| `list_dashboards` | Public-API listing of the custom dashboards visible to the caller's group (used by the Atlas AI dashboard builder and API clients) to discover dashboard ids/names/widgets before reading or cloning one. |
| `list_group_webhook_filter_options` | List type-ahead/facet values for the group-level webhook rule builder across selected projects (build names, tags, and the other supported condition fields), with search and cursor paging. |
| `list_group_webhook_projects` | List the group's TCM/TO projects for the webhook editor's project picker — a paginated, searchable, sortable list that marks the projects already linked to a given webhook. |
| `list_home_filter_options` | List the selectable values for one dropdown of the Observability home/overview page's personal filters (build status, product source, framework, build tag, unique build name, or folder). |
| `list_home_recent_views` | Get the user's last few visited items (dashboards, builds, views) for the Home page 'Recently viewed' strip. |
| `list_home_unique_builds` | List the Home page's latest builds across the caller's visible projects - one row per build with its status and counts - optionally narrowed to 'my builds' and quick filters. |
| `list_latest_build_summaries` | Return full build summaries (status, run counts, duration, CI/host info, user, failure stats) for up to the 5 latest builds of one project in a time window - the per-project body of the daily summary email. |
| `list_parallel_queue_team_usage` | Break the group's parallel-session usage down by team and member - parallels used vs allowed, queued vs queue limit, with per-pool breakdowns - so an admin can see who is consuming the plan's concurrency. |
| `list_performance_leaderboard` | Get the performance leaderboard for a project's Testing Trends page - per-build execution-duration metrics over the window, to find which suites are slowing down. |
| `list_project_build_names` | List the distinct build names seen in a project — the values that populate the build-name filter dropdown on the build listing. |
| `list_project_builds_by_group` | List a project's builds rolled up by build group (consolidated re-runs/shards shown as one row), with the full v2 build-listing filter set. |
| `list_project_builds_by_name` | The main build-listing endpoint: a filtered, sorted, cursor-paginated page of a project's builds with their status and run counts, for the builds table. |
| `list_project_builds_by_project_id` | List a project's builds over the public REST API with status, counts and a deep link back to the TRA UI — filterable like the UI build listing (names, users, teams, tags, branches, frameworks, statuses, date range) and cursor-paginated. |
| `list_project_webhook_filter_options` | List type-ahead/facet values for a project's webhook rule builder (build names, tags, test names, folders, and other trigger-condition fields), with search and cursor paging - the values behind 'fire only when <field> is ...'. |
| `list_projects` | List the calling account's Test Observability projects (public REST API) - the entry point for scripted/CI consumers that then drill into a project's builds. |
| `list_projects_for_sidebar` | Populate the build-list sidebar project picker: a page of lightweight project records for the group ordered by most recent build activity, with optional name search and the ability to exclude the already-selected project ids from the page. |
| `list_projects_full` | List the caller's group's projects as full records with complete metadata (attributes, issue types, alerts) — the heavyweight variant to use when you need full project detail rather than a picker payload. |
| `list_projects_lite_paginated` | Get a paginated, optionally name-searched list of the group's projects in lightweight form (id, name, normalised name, TestHub id) for pickers and listing pages that do not need per-project metrics. |
| `list_projects_with_build_aggregates_paginated` | Back the Projects landing page: the same paginated project list as the lite paginated variant but enriched with per-project build aggregates (build counts/status roll-ups, stability) from Elasticsearch, so each project card can show its health at a glance. |
| `list_quality_profile_filter_values` | Typeahead/value source for the filter builder inside a quality profile: return matching build names, build tags, test tags, folder paths, failure categories or alerts so a caller can pick which builds a gate applies to. |
| `list_queued_sessions` | List the automation sessions currently queued for a user and product, each with session/build/project name, resolved capabilities, why it is queued and how long it has waited. |
| `list_recent_runs` | List a project's most recent builds - one entry per build with its summary (name, number, status, counts) - the run picker / recent-runs list on the Testing Trends page. |
| `list_report_custom_fields` | List the custom-field / column definitions usable as report columns and filters, optionally narrowed to given projects — feeds the report builder's column picker and resolves stored field ids back to display names. |
| `list_report_static_builds` | List a project's builds that match a report's build-level filter set — used to populate the build picker / static build scope when building a report against a fixed set of builds. |
| `list_report_test_runs` | List the individual test runs behind one row of the tabular test-runs report - every execution of that test case in the window, with status, duration, build and settings-version detail - for the drill-down view. |
| `list_reports` | Power the Reports listing page: a paginated, searchable, sortable list of saved dashboards/reports across Test Observability and Test Management, each with owner, linked projects, type and schedule frequency, plus 'my reports' and total counts. |
| `list_running_builds_on_device` | Show which of the group's builds are currently queued/running on a specific device+OS combination, with the number of parallel sessions each consumes — used to explain why a device tier is saturated. |
| `list_saved_reports` | List the reports visible to you — your own plus group-level public ones — for the Reports landing page, with each report's name, level, type, filters and widget config. |
| `list_self_healing_verdicts` | List the human-in-the-loop verdicts (accurate/inaccurate) already recorded against a build's AI-healed locators, to show which healed selectors have been reviewed. |
| `list_sidebar_branch_filter_options` | Type-ahead options for the 'Branch' facet of the build-list sidebar — git branch names present in the builds matching the rest of the currently applied filter, optionally narrowed by a search string. |
| `list_sidebar_build_name_filter_options` | Type-ahead options for the 'Build name' facet of the build-list sidebar — the distinct build names present under the current filter/projects, optionally matched against a search string. |
| `list_sidebar_build_runs` | List a page of unique build runs for the build sidebar/list rail, matching a large filter body, with bidirectional cursor paging and optional centring on a deep-linked build. |
| `list_sidebar_run_group_filter_options` | Type-ahead options for the 'Run group' (build group) facet of the build-list sidebar — the first 100 run groups of the selected projects, name-searchable. |
| `list_sidebar_tag_filter_options` | List build-tag options for the build-list sidebar's Tags facet - the top tags on builds under the current filter, or the tags matching a search string. |
| `list_sidebar_team_filter_options` | List the team options for the build-list sidebar's Teams facet - the BrowserStack teams whose sub-groups own builds under the current filter, returned as {id, name} and optionally filtered by name. |
| `list_sidebar_test_case_status_filter_options` | List the manual test-case status options (Test Management's TestResult custom-field values) configured for the selected projects, to offer manual test-case statuses as a build-list sidebar filter. |
| `list_sidebar_user_filter_options` | List the users to offer in the build-list sidebar's Users facet - the people who actually triggered builds under the current filter, returned as {id, name} and searchable by name. |
| `list_similar_test_runs` | For the auto-analyser / unique-errors view: given a failed test run (or a set of error-cluster ids) in a build, list the other test runs with a similar failure so you can judge blast radius and treat the cluster as one issue. |
| `list_split_build_legs` | List the individual legs (child builds) of a split / parallel build with their ids and uuids, so you can offer a leg switcher or aggregate stats across the whole split run. |
| `list_stability_leaderboard` | Get the stability leaderboard for a project's Testing Trends page - pass-rate / stability scoring per build name over the window, to rank the least reliable suites. |
| `list_suite_health_test_runs` | List the individual executions of one test across builds — per-run status, duration, smart tags (flaky / newly failed / always failing / performance anomaly) and build context — for the run-history table on the Suite Health detail page. |
| `list_suite_health_tests` | List a project's tests on the current Suite Health surface — one row per unique test (stability hash) over a required date range, with reliability (failure %), average duration, execution counts, flakiness and platform signals — to find flaky, always-failing or slow tests. |
| `list_test_health_tests` | List a project's tests on the legacy Test Health surface — one row per unique test (stability hash) over a date range, with its reliability (failure %), average duration, execution counts, flakiness and platform signals — to find the least reliable tests. |
| `list_test_run_comments` | Public API: fetch the discussion thread on a test run — the comments testers left against that failure, with author info. |
| `list_test_run_detail_tabs` | List which tabs the test-detail page should render for a run — Overview, Behaviour, Logs, Network, Test code, Test cases and so on — computed from the run's data, the build's framework and whether it is a BDD build. |
| `list_test_run_execution_history` | List the recent execution history of the same test across previous builds (the history strip on the test-detail page) so you can tell whether a failure is new, flaky or long-standing. |
| `list_test_run_linked_test_cases` | List the Test Management test cases linked to a test run (its BTCer test cases), paginated, for the Test cases tab of the test-detail page. |
| `list_test_runs_sharing_error` | List the other test runs that failed with the same unique-error cluster as this run — the 'tests affected by this error' list, each returned with full test detail. |
| `list_unique_error_builds` | List the builds in which one unique error occurred, cursor-paginated, so a user can jump from an error cluster to the actual runs and builds where it appeared. |
| `list_unique_errors` | List the Suite Health unique errors for a project — test failures clustered by error signature over a date window, each cluster with its occurrence count, impacted-test count and a sample of the error text — so a team can attack the few root errors behind many failing tests. |
| `list_user_running_builds` | Show which builds a given user currently has running for Automate or App Automate, with their projects and how long the oldest has been going - the drill-down from the parallel-queue view to who is holding the parallels. |
| `list_views` | External/public API (used by the Atlas agent) to list the caller's saved views for a screen, so an integration can pick a saved view instead of rebuilding a filter query. |
| `list_widget_custom_field_filters` | List the Test Management custom fields usable as extra filters on a test-case widget, so the widget-config panel can offer them. |
| `list_widget_filter_values` | Look up the available values for a single widget filter key (build status, users, teams, frameworks, build tags, build name, branches, ...) as a flat list for a widget configuration dropdown. |
| `recalculate_build_quality_gate` | Re-run the quality-gate evaluation for a build (e.g. after profile rules or a status override changed) — use after quality-gate inputs change to refresh the build's gate result. |
| `rename_project` | Rename a project — use this to change a project's display name (and, as a side effect, its URL slug). |
| `replace_view` | Rename a saved view or replace its stored filter query and visibility level. Name, query and level are all REQUIRED here — this replaces the view rather than patching it, so send the whole object; update_view is the partial-update route. |
| `resolve_build_comparison_parent_uuids` | Normalise two build UUIDs (which may be re-run/child builds) to their top-level parent build UUIDs — call this first so a rerun UUID pasted into the comparison picker is compared at the parent level. |
| `resolve_build_uuid_from_identifiers` | Resolve a build UUID from human/CI-facing identifiers — project name (or TestHub project id) + build name + serial id for automation builds, or a TCM test-run id for manual/TCM runs — so a caller can deep-link to a build without already knowing its uuid. |
| `resolve_dashboard_filter_names` | Batch-resolve project ids and user ids to their display names, so a saved dashboard's stored filter ids can be rendered as readable chips. |
| `retrigger_rca_analysis` | 'Improve analysis' — re-run the agentic AI RCA for a failed test with a user instruction and up to 3 previously presigned attachments, creating a new conversation turn. Returns the new message id (and trial quota used) so you can poll for the refreshed analysis. |
| `run_tabular_test_runs_report` | Run a configured report and return its paginated table - post the full report definition (datasets, segments, global filters) and get back the tabular test-runs result set. |
| `search_entities` | Global search across the product: given a free-text query and an entity type, return matching entities (builds, tests, projects) for the search bar or quick overlay, paginated and enriched with user names. |
| `search_test_filter_branches` | Type-ahead the branch filter on the Suite Health test list: get git branch names seen in the project within the date window that match a substring. |
| `search_test_filter_build_names` | Type-ahead the build-name filter on the Suite Health test list: get unique build names for the project in the date window that match a substring. |
| `search_test_filter_build_tags` | Type-ahead the build-tag filter on the Suite Health test list: get build tags used in the project within the date window that match a substring. |
| `search_test_filter_host_names` | Type-ahead the host-name (machine/agent) filter on the Suite Health test list: get host names seen in the project within the date window that match a substring. |
| `search_test_filter_test_tags` | Type-ahead the test-tag filter on the Suite Health test list: get test tags seen in the project within the date window that match a substring. |
| `search_unique_error_filter_branches` | Typeahead for the branch filter on the Unique Errors page — return git branch names in the project matching a substring within the date window. |
| `search_unique_error_filter_build_names` | Typeahead for the build-name filter on the Unique Errors page — return unique build names in the project matching a substring within the date window. |
| `search_unique_error_filter_build_tags` | Typeahead for the build-tag filter on the Unique Errors page — return build tags used in the project matching a substring within the date window. |
| `search_unique_error_filter_host_names` | Typeahead for the host-name (CI machine / runner) filter on the Unique Errors page — return matching host names within the date window. |
| `search_unique_error_filter_test_tags` | Typeahead for the test-tag filter on the Unique Errors page — return tags attached to tests in the project matching a substring within the date window. |
| `search_unique_errors` | Autocomplete over unique error signatures — given a partial error string, return the top matching unique errors so a user can pick one while configuring an error-focused dashboard widget. |
| `search_widget_filter_values` | Fetch matching values for a widget filter, split into suggested and others with search and paging - the lookup that powers the dependent dropdowns in a widget's configuration panel. |
| `submit_self_healing_verdict` | Record a reviewer's verdict on one AI-healed locator ('accurate' or 'inaccurate', with optional feedback) to feed the human-in-the-loop healing loop. |
| `toggle_check_configuration` | Enable or disable a single check-run configuration without editing the rest of it — the quick on/off switch in the repo's checks settings. |
| `trigger_build_ai_failure_analysis` | Public API: start build-level AI failure clustering for a build (get-or-trigger). Returns existing analysis if ready, otherwise enqueues it and flags that it was triggered. |
| `trigger_bulk_test_rca` | Kick off AI root-cause analysis for all failed tests of a build in one go (the 'Analyse all failures' action) — optionally narrowed by the test-listing filters and capped by a limit. |
| `trigger_test_rca` | Public-API trigger for a test run's AI RCA with a fire-and-forget callback: same get-or-queue behaviour as the GET, plus an https webhook the pipeline notifies when the analysis is ready. |
| `update_check_configuration` | Edit an existing check-run configuration — its name, check type, tool, target project/build name, branch, tags, commit-check or enabled flag. |
| `update_code_fix_preference` | Edit an existing AI code-fix preference for a project/build — change the instruction text and/or replace (or remove) its attached context file. |
| `update_dashboard` | Update an existing dashboard's name/type/level and replace its widget set via the public API. |
| `update_dashboard_view` | Save changes to an existing dashboard view — rename it, change its visibility level, change its global filters, or persist an edited widget layout. |
| `update_report` | Update an existing saved report in place — rename, change visibility level, change global filters, or replace its widget set. |
| `update_view` | Rename a saved view, replace its stored filter query, or change its private/public visibility. |

</details>

<details>
<summary><b>🎨 Percy</b></summary>

| Tool | What it does |
|---|---|
| `addPercySnapshotCommands` | Add Percy snapshot commands to the specified test files. _(not available in Remote MCP)_ |
| `expandPercyVisualTesting` | Set up or expand Percy visual testing coverage for existing projects (Percy Web Standalone and Percy Automate). |
| `runPercyScan` | Run a Percy visual test scan. _(not available in Remote MCP)_ |
| `fetchPercyChanges` | Retrieve and summarize visual changes detected by Percy AI between the latest and previous builds. |
| `listTestFiles` | List all test files for a given set of directories. _(not available in Remote MCP)_ |
| `managePercyBuildApproval` | Approve or reject a Percy build. |
| `percyVisualTestIntegrationAgent` | Integrate Percy visual testing into a new project and demonstrate visual change detection with a step-by-step simulation. |

</details>
