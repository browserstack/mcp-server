# Test Management: workflow to capability reference

Source: the BrowserStack docs page [Test Management with the MCP server](https://www.browserstack.com/docs/browserstack-mcp-server/tools/test-management). One row per product workflow. "Named tool" is a tool the server registers directly; everything else is a capability reached through `searchCapability` → `describeCapability` → `invokeCapability` with `product: "tm"`. When a row lists several capabilities, the first is the usual choice; the rest are variants (by integer id, by filter, lite/full).


## Projects

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Create a project | Creates a project, the top-level container for every folder, test case, run, plan, and report. | `createProjectOrFolder` | `create_project` |
| Get your low-code test setup | Returns your saved Low-Code Automation setup for a project. |  | `get_lcnc_user_test_config` |
| List projects | Returns every project you can access, with its ID and name. |  | `get_projects_basic`, `get_projects_minify`, `list_projects` |
| List users | Returns the users in the project, with their identifiers and roles, so you can assign a run or test case to one of them by name. |  | `list_project_users`, `list_group_users`, `list_users`, `search_project_users` |
| Update a project | Renames a project and changes its description and other attributes. |  | `edit_project` |

## Platform

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Search across the workspace | Searches every entity type at once. Use it when you don’t know which entity holds what you’re looking for. |  | `search_all_projects`, `search_project_entities`, `search_project_entities_by_filter` |

## Test cases

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Add a comment | Adds a comment to a test case or to a test case in a test run, with rich text, threads, and @mentions. |  | `create_test_case_comment`, `create_test_run_test_case_comment` |
| Bind a dataset to a test case | Binds a dataset to a test case and pulls its variables into the step text, so the test case runs once for each row of the dataset. |  | `list_dataset_linked_test_cases`, `get_dataset_variables`, `create_dataset`, `edit_test_case_partial` |
| Bulk archive test cases | Archives many test cases in one call. Archived test cases leave the active repository, and you can restore them later. |  | `bulk_archive_test_cases_by_project` |
| Bulk clone test cases | Duplicates many test cases in one call, selected by a list of IDs or by a filter. |  | `bulk_copy_test_cases` |
| Bulk copy test cases | Copies many test cases into another folder or project in one call. |  | `bulk_copy_test_cases` |
| Bulk edit test cases | Edits many test cases in one call. Add, remove, or replace values field by field, for example, to add a tag to every test case in a folder. |  | `bulk_edit_test_cases` |
| Bulk move test cases | Moves many test cases into another folder or project, selected by a list of IDs or by a filter. |  | `bulk_move_test_cases` |
| Bulk update test case fields | Sets the same owner, priority, status, type, tags, custom fields, or review state on many test cases at once. |  | `bulk_replace_test_case_fields` |
| Check a deduplication job | Returns the status of a deduplication job, and its result after it finishes. |  | `get_dedupe_status` |
| Clone a test case | Duplicates a test case within the repository. |  | `bulk_copy_test_cases` |
| Copy a folder | Copies a folder and everything inside it to another location. |  | `copy_folder` |
| Copy a test case | Copies a test case into another folder or project and leaves the original in place. |  | `bulk_copy_test_cases` |
| Create a folder | Creates a folder in the test case tree, with a name, description, and attachments, under the parent folder you choose. | `createProjectOrFolder` | `list_root_folders`, `create_folder`, `create_root_folder`, `create_sub_folder` |
| Create a saved view | Saves a combination of filters as a named view, so you can recall the same selection later. |  | `create_filter` |
| Create a test case | Creates a test case with a title, folder, template, steps, expected results, priority, type, tags, datasets, and custom fields. | `createTestCase` | `list_templates`, `list_root_folders`, `get_system_field_values`, `create_test_case_by_integer_id`, `create_test_case`, `create_test_cases` |
| Create a test case template | Creates a test case template, which sets the fields that test cases created from it carry. |  | `create_template` |
| Find duplicate test cases | Returns the test cases that Test Management identifies as duplicates of each other, so you can deduplicate the repository. |  | `list_duplicates`, `search_duplicates`, `get_duplicate` |
| Find test cases | Returns the test cases that match a query. Filter by folder, state, priority, automation status, type, tags, and owner. | `listTestCases` | `list_entity_filter_details`, `search_project_entities`, `list_folder_contents`, `list_archived_test_cases`, `list_test_cases`, `list_folder_test_cases`, `search_project_entities_by_filter` |
| Generate test cases and Low-Code Automation steps from a product requirements document | Uploads a product requirements document (PRD), creates test cases from it in a project, then generates Low-Code Automation (LCA) steps for them. | `uploadProductRequirementFile` and `createTestCasesFromFile` (local server only), `createProjectOrFolder`, `createTestCase`, `createLCASteps` |  |
| Generate test cases from a requirements document | Generates draft test cases from an uploaded requirements document. The server saves nothing until you accept the drafts into a folder. | `createTestCasesFromFile` (local server only) | `create_bulk_test_cases` |
| Get a test case | Returns one test case in full: every field, every step with its additional data and expected result, and its tags, datasets, attachments, and links. |  | `get_test_case_by_integer_id`, `get_test_case_detail`, `get_test_case` |
| List attachments | Returns the files attached to an asset, with their name, size, and a download reference. |  | `list_folder_attachments`, `list_entity_attachments` |
| List comments | Returns the comment thread on an asset, in order, with the author and timestamp of each comment. |  | `list_test_case_comments`, `list_test_run_test_case_comments` |
| List folders | Returns the project’s folder tree, with each folder’s ID, name, and parent. |  | `get_folder_tree`, `list_root_folders`, `list_folder_contents` |
| List saved views | Returns the available saved views and the filter each one holds, so a request can reuse an existing view instead of restating its filters. |  | `list_filters` |
| List test case templates | Returns the test case templates in a project, with the fields each one defines. |  | `list_templates`, `list_test_case_templates` |
| List test case versions | Returns the version history of a test case, with what changed between versions and who changed it. |  | `list_test_case_histories`, `get_test_case_histories`, `get_test_case_history_diff`, `get_test_case_history` |
| Move a folder | Moves a folder and everything inside it under a different parent folder. |  | `move_folder_by_integer_id`, `move_folder` |
| Move a test case | Moves a test case into a different folder. |  | `move_test_case` |
| Preview a folder deletion | Shows what deleting a folder would remove: the test cases, subfolders, and recordings inside it. Nothing is deleted. |  | `get_folder_remove_summary` |
| Read test results | Returns the recorded results of a test, across all runs or within one run. |  | `list_test_results_for_test_case_by_integer_id`, `list_test_results_for_test_case`, `search_test_results` |
| Restore a test case version | Rolls a test case back to an earlier version, which becomes the current version. |  | `restore_history` |
| Set folder display order | Sets a custom display order for folders in the tree, instead of alphabetical order. |  | `reorder_folders`, `reorder_test_cases_by_folder` |
| Update a folder | Renames a folder, changes its description, or manages its attachments. |  | `rename_folder_by_integer_id`, `rename_folder` |
| Update a saved view | Changes the filter or name of a saved view. |  | `update_filter` |
| Update a test case | Changes any part of a test case, including steps, expected results, priority, state, tags, and custom fields. |  | `edit_test_case`, `update_test_case` |
| Update a test case template | Changes the name of a test case template and the fields it defines. |  | `update_template` |

## Shared fields

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Create a shared field | Creates a reusable block that test cases share: a shared step sequence, a Gherkin background, or a precondition. |  | `create_shared_step`, `create_shared_component` |
| Find shared fields | Returns the shared fields that match a query, filtered by type: shared step, Gherkin background, or precondition. |  | `list_shared_components`, `get_shared_steps`, `get_shared_step` |
| Update a shared field | Changes a shared field. The change applies to every test case that uses it. |  | `update_shared_step`, `update_shared_component` |

## Datasets

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Create a dataset | Creates a dataset of variable columns and value rows that test cases can bind to for data-driven execution. |  | `create_dataset` |
| Find datasets | Returns the datasets that match a query, with the number of test cases bound to each one. |  | `get_dataset`, `list_dataset_linked_test_cases`, `list_datasets` |
| Update a dataset | Changes the variables and rows of a dataset, which changes the combinations every bound test case runs. |  | `update_dataset` |

## Requirements

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Link a requirement | Links a test case, run, or session to a requirement in your connected issue tracker, for traceability and coverage reporting. |  | `get_linked_test_case_selection`, `link_entities_to_jira_issue` |
| Unlink a requirement | Removes the link between a requirement and a test case or run. Coverage reporting updates to match. |  | `unlink_test_case`, `unlink_test_run` |

## Test runs

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Add test cases to a run | Adds test cases to an existing test run. |  | `bulk_set_test_case_assignee_in_run`, `bulk_update_test_run_test_cases` |
| Assign a run | Assigns an owner to a run and to the test cases in the run. |  | `assign_test_run_owner`, `assign_test_run_test_cases` |
| Bulk log test results | Sets the same result status on many test cases in a run in one call. |  | `bulk_set_test_result_status` |
| Clone a test run | Duplicates a test run, including its test cases and configurations. |  | `clone_test_run_by_integer_id`, `clone_test_run` |
| Close a test run | Closes a test run, freezes its results, and removes it from the default run listing. |  | `close_test_run` |
| Create a test run | Creates a test run with a name, test cases, configurations, test plan, assignee, tags, and requirements. | `createTestRun` | `list_configurations`, `count_run_selection`, `get_test_runs_form_fields`, `create_test_run_by_integer_id`, `create_test_run` |
| Find test runs | Returns the test runs that match a query, filtered by state, assignee, run group, plan, and date. | `listTestRuns` | `list_entity_filter_details`, `list_closed_test_runs`, `list_test_runs_selection`, `list_test_runs_by_integer_id`, `list_test_runs` |
| Find test cases in a run | Returns the test cases in the run, filtered by status, assignee, or configuration. |  | `bulk_edit_test_cases_in_test_run`, `get_test_run_detail`, `list_test_run_test_cases` |
| Get a test run | Returns one test run in full: its attributes, creation details, configurations, assignee, and the test cases in the run. |  | `get_test_run_by_integer_id`, `get_test_run_detail`, `get_test_run_progress`, `get_test_run` |
| Link a run to a saved filter | Makes the test cases in a run follow a saved filter instead of a fixed list. |  | `list_filters`, `update_test_run` |
| Link a run to a test plan | Links a run to a plan, so the run counts toward that plan’s reporting. |  | `list_test_plan_test_runs_by_integer_id`, `update_test_plan`, `list_test_runs` |
| Log a test result | Records a test result with a status, notes, attachments, linked defects, and result custom fields. | `addTestResult` | `create_step_result`, `create_test_result_for_test_case`, `create_test_results_for_test_run` |
| Set run configurations | Sets the browser, device, and operating system combinations a run executes against, for the whole run or for individual test cases in it. |  | `bulk_update_test_run_test_cases`, `update_test_run` |
| Update a test run | Changes any attribute of an existing run, including its state, assignee, tags, and description. | `updateTestRun` | `edit_test_run`, `replace_test_run`, `update_test_run` |

## Test plans

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Bulk archive test plans | Archives many test plans in one call and removes them from the active listing. You can restore archived test plans later. |  | `bulk_archive_test_plans` |
| Clone a test plan | Duplicates a test plan, including its structure. |  | `clone_test_plan` |
| Create a test plan | Creates a test plan with a title, dates, owner, tags, linked requirements, and the runs it covers. |  | `create_test_plan_by_integer_id`, `create_test_plan`, `create_sub_test_plan` |
| Find test plans | Returns the test plans that match a query, filtered by state, owner, and date. |  | `list_entity_filter_details`, `get_archived_test_plan_count`, `list_archived_test_plans`, `list_test_plans_by_integer_id`, `list_test_plans` |
| Get a sub-test plan | Returns one sub-test plan under a test plan, with its details and linked test runs. | `getSubTestPlan` |  |
| Get a test plan | Returns one test plan in full: dates, owner, linked runs, requirements, and overall progress. |  | `get_test_plan_execution_trend`, `get_test_plan_by_integer_id`, `get_test_plan_linked_sessions_chart_data`, `list_test_plan_test_runs_by_integer_id`, `list_test_plan_test_runs`, `get_test_plan` |
| List sub-test plans | Returns the sub-test plans under a test plan, with their name, status, and dates. | `listSubTestPlans` |  |
| Restore archived test plans | Restores many archived test plans in one call, which undoes a bulk archive. |  | `bulk_restore_archived_test_plans` |
| Update a test plan | Changes any attribute of an existing plan, including its state, for example from Unscheduled to In progress. |  | `update_test_plan_by_integer_id`, `update_test_plan` |

## Exploratory sessions

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Add a session log | Adds a log entry to an exploratory session. The log types are Pass, Fail, Note, Blocked, Retest, Bug, and Skipped. |  | `create_exploratory_session_log` |
| Create an exploratory session | Creates an exploratory session with a title, timebox in minutes, charter, configuration, assignee, tags, attachments, linked requirements, and test plan. |  | `list_exploratory_session_form_fields`, `clone_exploratory_session`, `create_exploratory_session` |
| Find exploratory sessions | Returns the exploratory sessions that match a query, filtered by owner, state, and date. |  | `list_exploratory_sessions` |
| Get an exploratory session | Returns one exploratory session in full: its charter, duration, participants, logs, and linked defects. |  | `get_exploratory_session`, `list_exploratory_session_defects`, `list_exploratory_session_logs` |
| List session logs | Returns the log entries recorded in a session, in order, with their type and attachments. |  | `list_exploratory_session_logs` |
| Update a session log | Changes a log entry in a session, including its type, for example from a note to a bug. |  | `update_exploratory_session_log` |
| Update an exploratory session | Changes the charter, state, or timer of an exploratory session. |  | `close_exploratory_session`, `update_exploratory_session` |

## Reports

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Create a report | Generates a report of a chosen type over a chosen scope. Nine report types are available. |  | `create_report_by_integer_id`, `create_report`, `get_selected_report_testcases` |
| Download a report | Downloads a generated report as a file. |  | `download_report` |
| Find reports | Returns the reports that match a query, including scheduled reports. |  | `list_reports`, `list_schedules` |
| Get a report | Returns a generated report, either its data or a download reference for the exported file. |  | `get_exploratory_session_summary`, `get_report_detail`, `get_report_section`, `get_report_summary_by_type`, `get_report` |
| Schedule a report | Schedules a report to run daily, weekly, or monthly at a set UTC time, and emails it to a list of recipients. |  | `create_report_by_integer_id`, `send_report_email_now` |
| Update a report | Changes the title, date range, and filters of an existing report, and regenerates it. |  | `update_report` |

## Dashboards

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Read dashboard data | Returns the data behind a dashboard, with its filters, such as time window and project scope, applied. |  | `get_active_test_runs_info`, `get_automation_stats`, `get_closed_test_runs_info`, `get_closed_test_runs_split`, `get_issues_count_info`, `get_test_case_count_trend`, `get_test_case_type_split`, `export_dashboard_analytics` |
| Read widget data | Returns the numbers behind a single dashboard widget. |  | `get_active_test_runs_info`, `get_automation_stats`, `get_issues_count_info`, `get_test_case_count_trend` |

## Project insights

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Read project insights | Returns the project insights view: Overview, Automation Health, and Unique Errors. |  | `get_active_test_runs_info`, `get_automation_stats`, `get_closed_test_runs_info`, `get_issues_count_info`, `get_test_case_count_trend` |

## Settings

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Configure review and approval | Turns on test case review and sets its reviewers, statuses, and compliance rules. |  | `update_project_settings` |
| Create a configuration | Creates a named OS, browser, or device configuration that test runs record results against for each test case. |  | `create_configuration` |
| Create a custom field | Creates a custom field on test cases, results, or another entity, with its type and options. |  | `create_custom_field_dataset_option`, `create_custom_field_dataset`, `create_custom_field_definition`, `create_custom_field` |
| Get a custom field | Returns one custom field by ID, with its name, type, placeholder, default value, and whether it’s mandatory. |  | `get_custom_field` |
| List configurations | Returns the browser, device, and operating system configurations available to a run, including custom configuration groups. |  | `list_configurations`, `list_configuration_groups` |
| List custom fields | Returns the custom fields in a project, with their type, options, and the entity each one applies to. |  | `get_custom_field_dataset`, `get_custom_field_definition`, `get_custom_field_values`, `get_project_form_fields`, `get_test_results_custom_fields`, `list_custom_field_dataset_options`, `list_custom_fields`, `list_workspace_fields`, `get_system_field_values` |
| List items in the bin | Returns what’s currently in the bin: what each item was, who deleted it, and when, so you can find and reverse a deletion. |  | `count_binned_test_cases`, `list_binned_test_cases` |
| List tags | Returns the tags defined in the project and how many assets carry each one. |  | `get_test_case_tags`, `list_test_case_tags`, `search_group_tags`, `search_test_case_tags` |
| Read project settings | Returns the current project settings, so your AI assistant changes settings based on the current configuration. |  | `get_project_settings` |
| Rename a tag | Renames a tag in the project. |  | `update_tag` |
| Set project visibility | Sets who can see a project, which controls whether its test cases are reachable from other projects. |  | `get_project_by_integer_id`, `edit_project` |
| Update a custom field | Changes an existing custom field: its name, mandatory flag, placeholder, default value, dropdown options, and the projects it applies to. |  | `update_custom_field`, `update_custom_field_definition`, `update_custom_field_dataset_option`, `update_custom_field_dataset_project_mapping` |
| Update a project setting | Changes a project-level setting, such as run auto-close, the test case ID prefix, or cross-project test case sharing. |  | `get_project_settings`, `update_project_settings` |
