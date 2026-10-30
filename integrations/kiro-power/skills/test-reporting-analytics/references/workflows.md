# Test Reporting & Analytics: workflow to capability reference

Source: the BrowserStack docs page [Test Reporting & Analytics with the MCP server](https://www.browserstack.com/docs/browserstack-mcp-server/tools/test-reporting-analytics). One row per product workflow. "Named tool" is a tool the server registers directly; everything else is a capability reached through `searchCapability` → `describeCapability` → `invokeCapability` with `product: "tra"`. When a row lists several capabilities, the first is the usual choice; the rest are variants (by integer id, by filter, lite/full).


## Projects

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Get a project | Returns one project with its settings and summary. |  | `get_project_by_id_or_name` |
| List projects | Returns the projects in your account with their names and identifiers. Every other workflow is scoped to a project, so this is usually the first call. |  | `get_default_project`, `list_projects_full`, `list_projects` |
| Update a project | Changes the name or other details of a project. |  | `rename_project` |

## Build runs

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Compare two build runs | Shows what changed between two runs: which tests newly failed, which were fixed, and which stayed the same. |  | `get_build_comparison_aggregation`, `get_build_comparison_meta`, `list_build_comparison_bucket_tests` |
| Create a build group | Bundles related build runs into one group. |  | `create_build_group` |
| Get a build run | Returns one build run with its status, duration, platforms, and test counts. | `fetchBuildInsights` | `get_build_details`, `get_build_non_sdk_test_counts`, `get_build_summary_stats`, `list_split_build_legs`, `get_build_summary`, `get_build_insights`, `get_build_notification_summary`, `get_test_run_build_insights` |
| List build groups | Returns the groups that bundle related build runs together. |  | `list_project_builds_by_group`, `list_build_groups` |
| List build runs | Returns the build runs in a project, newest first, so you can pick a run by name, number, or tag. | `getBuildId`, `listBuildId` | `list_home_unique_builds`, `get_latest_build`, `list_project_builds_by_name`, `list_project_builds_by_project_id`, `list_recent_runs` |
| Read build run history | Returns earlier runs of the same build, so you can compare a result with what came before. |  | `get_build_history`, `list_build_history_with_defect_counts` |
| Read build run statistics | Returns the numbers behind a build run: stability, flaky tests, new failures, always-failing tests, muted tests, defects, re-runs, timeline, and failures by module. |  | `get_build_always_failing_stats`, `get_build_attempt_run_stats`, `get_build_failure_category_stats`, `get_build_failures_by_module`, `get_build_flaky_stats`, `get_build_muted_stats`, `get_build_new_failure_stats`, `get_build_rerun_stats`, `get_build_stability_tile`, `get_build_timeline_stats`, `get_split_build_rerun_stats`, `get_build_name_status_aggregation`, `get_daily_summary_report`, `list_latest_build_summaries` |

## Tests

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Get session details | Returns the browser or device session that a test ran on, with its capabilities and profiling data. |  | `get_session_app_profiling`, `get_session_capabilities`, `get_session_details` |
| Get test details | Returns one test in full: its steps, code, platform, tags, attachments, hooks, and how it behaved in earlier runs. |  | `get_session_test_code`, `get_test_runs_history_details`, `get_test_run_baseline`, `get_test_run_details`, `get_test_run_behaviour`, `get_test_run_hooks`, `get_test_run_media_logs`, `get_test_run_meta`, `get_test_run_overview`, `get_test_run_test_code`, `list_test_run_detail_tabs`, `list_test_run_execution_history`, `list_test_run_linked_test_cases` |
| List tests in a build run | Returns the tests in a run, flat or grouped by file and suite, with their status and duration. | `listTestIds` | `list_build_test_folders`, `list_build_bstack_error_sessions`, `list_build_test_run_counts`, `list_build_test_runs`, `list_build_test_runs_flat`, `list_build_test_runs_hierarchy`, `list_build_test_runs_hierarchy_without_public_link`, `list_build_test_runs_with_attachments` |
| Read comments on a test | Returns the comments that people left on a test or a build run. |  | `list_build_comment_threads`, `list_comments`, `list_test_run_comments` |
| Read test logs | Returns the logs that a failing test left behind: console, network, application, and retry logs. | `getFailureLogs` | `get_test_run_retry_logs`, `list_build_test_run_sdk_logs`, `get_session_network_log_url`, `get_test_run_app_logs`, `get_test_run_app_logs_raw`, `get_test_run_log_bundle`, `get_test_run_merged_logs`, `get_test_run_network_log_url`, `get_test_run_network_logs` |
| Set the failure reason on a test | Assigns a failure category to a failed test. Failure analysis reports use these categories. |  | `assign_issue_types_to_test_runs`, `assign_test_run_failure_categories` |

## Unique errors

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Find similar errors | Returns errors that look like the one you’re investigating, so one fix can cover all of them. |  | `list_similar_test_runs`, `list_test_runs_sharing_error` |
| Get unique error details | Returns one error in full: the tests it broke, the builds and platforms it appeared on, and its trend over time. |  | `get_unique_error_build_trend`, `get_unique_error_impacted_tests`, `get_unique_error_occurrence_count`, `get_unique_error_platform_breakdown`, `get_unique_error_summary`, `list_unique_error_builds` |
| List unique errors | Returns the distinct errors across a project, each with the number of tests and runs it affected. |  | `search_unique_errors`, `get_build_top_error_stats`, `get_unique_error_timeline_charts`, `list_unique_errors` |

## AI and root cause analysis

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Add or update a code fix preference | Sets a rule that your assistant follows when it suggests code, such as a style to use or a file to avoid. |  | `update_code_fix_preference` |
| Get the AI summary of a build | Returns a short written summary of what went wrong in a run. |  | `get_build_ai_failure_summary` |
| Get the failure analysis for a build | Returns the automatic grouping of a run’s failures into themes and likely causes. |  | `get_build_ai_failures`, `list_ai_failure_theme_test_runs` |
| Get the root cause of a test failure | Returns why one test failed and what to change. | `fetchRCA` | `get_test_rca_data`, `get_test_rca` |
| Run failure analysis on a build | Starts the automatic analysis of a run’s failures. |  | `trigger_build_ai_failure_analysis`, `trigger_bulk_test_rca` |
| Run root cause analysis on a test | Starts the analysis of one failing test and returns a job that you can follow. |  | `retrigger_rca_analysis`, `improve_test_rca`, `trigger_test_rca` |

## Self-healing

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Get the self-healing report | Returns the broken locators that were repaired automatically in a run. |  | `get_build_self_heal_summary` |
| Raise a pull request for healed locators | Opens a pull request in the connected repository with the accepted locator repairs. |  | `get_self_healing_pr_status`, `create_self_healing_pr` |
| Review a healed locator | Returns the proposed locator repairs and records whether you accept each one. |  | `list_self_healing_verdicts`, `submit_self_healing_verdict` |

## Quality gates

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| List quality gate profiles | Returns the quality gate profiles on a project and the thresholds that each one sets. |  | `get_project_quality_gate_settings`, `get_quality_profile` |
| Read the quality gate result | Returns whether a run passed its quality gate and which rule failed. |  | `get_build_quality_gate_result`, `get_build_quality_gate_summary`, `get_build_quality_profile_result`, `list_build_quality_profile_results` |
| Recalculate the quality gate | Runs the quality gate again on a build, for example, after you mute or re-run tests. |  | `recalculate_build_quality_gate` |

## Test health

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Get test health details | Returns the history of one test: how often it failed, on which builds and platforms, and how that changed over time. |  | `get_suite_health_stats`, `get_suite_health_test_info`, `get_suite_health_test_platform_breakdown`, `get_suite_health_trend`, `get_test_base_info`, `get_test_environment_breakdown`, `get_test_health_stats`, `get_test_health_trend`, `list_suite_health_test_runs` |
| List test health | Returns every unique test with its failure count, failure rate, and average duration over a period that you choose. |  | `get_test_metrics_chart`, `list_suite_health_tests`, `list_test_health_tests` |

## Testing trends

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Read testing trends | Returns the trend charts for a project: stability, flakiness, new failures, always-failing tests, duration, test growth, run frequency, failure categories, and platform coverage. |  | `get_always_failing_tests_trend`, `get_build_frequency`, `get_build_performance_chart`, `get_build_stability_chart`, `get_cross_browser_coverage`, `get_failure_categories_trend`, `get_flakiness_trend`, `get_new_failures_trend`, `get_project_performance_chart`, `get_project_stability_chart`, `get_test_executions_trend`, `get_test_growth_trend`, `list_performance_leaderboard`, `list_stability_leaderboard` |
| Read the overview summary | Returns the headline numbers on the overview page, such as time saved, stability, and flaky test counts. |  | `get_home_takeaways`, `get_home_takeaways_with_noise_breakdown`, `get_project_automation_coverage`, `list_home_recent_views` |

## Accessibility

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Read accessibility results | Returns the accessibility findings recorded against a build run and its tests. |  | `get_build_accessibility_meta`, `get_test_run_accessibility_meta`, `list_build_accessibility_test_runs` |

## SDK

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Read SDK adoption | Returns how many builds still run without the BrowserStack SDK. Builds that run without the SDK have limited reporting. |  | `get_project_non_sdk_build_count`, `get_project_non_sdk_summary` |

## Dashboards

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Clone a dashboard | Copies a dashboard with its widgets, so you can change it without changing the original. |  | `clone_dashboard`, `clone_dashboard_view` |
| Create a dashboard | Creates a dashboard to hold widgets. |  | `create_dashboard`, `create_dashboard_view` |
| Get a dashboard | Returns one dashboard with its widgets. |  | `get_dashboard`, `list_dashboard_view_widget_types`, `get_dashboard_view` |
| List dashboards | Returns the available dashboards and the owner of each one. |  | `list_dashboards`, `list_dashboard_views` |
| Read widget data | Returns the numbers behind one widget, and the details behind a number when you drill into it. |  | `get_dashboard_view_widget_data`, `get_org_dashboard_widget_data`, `get_widget_drilldown_records` |
| Update a dashboard | Changes the name, layout, or widgets of a dashboard. |  | `update_dashboard`, `update_dashboard_view` |

## Reports

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Clone a report | Copies a report, so you can change its scope without changing the original. |  | `clone_report` |
| Create a report | Builds a report of a type that you choose, over the projects and dates that you choose. |  | `create_report` |
| Get a report | Returns one report with the data behind it. |  | `get_report`, `get_report_dataset_rows`, `get_report_stat_tiles`, `generate_build_report`, `get_report_test_stats`, `get_report_test_trend`, `list_report_test_runs`, `get_tabular_test_runs_report_tiles`, `run_tabular_test_runs_report` |
| List reports | Returns the reports saved in your account, with their type and who can see them. |  | `list_reports`, `list_report_custom_fields`, `list_report_static_builds`, `list_saved_reports` |
| Update a report | Changes the title, scope, or filters of a report. |  | `update_report` |

## Views and filters

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Create a saved view | Saves the current filters under a name, so you can apply the same selection again later. |  | `create_view` |
| List saved views | Returns the saved filter combinations available for a page. |  | `list_views` |
| Update a saved view | Changes the name of a saved view or the filters behind it. |  | `update_view`, `replace_view` |

## Search

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Search across the product | Finds builds, tests, and projects by name from one query. |  | `search_entities` |

## Public sharing

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Read public sharing settings | Returns whether a project or dashboard is shared publicly. |  | `get_dashboard_public_link_setting`, `get_project_public_link_setting` |

## Integrations

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Link a defect to a test | Raises or attaches an issue tracker ticket against a failing test. |  | `link_bug_to_test_run` |
| Manage pull request checks | Posts the run result back to a pull request as a check, and manages those checks. |  | `list_check_configurations`, `create_check_configurations`, `create_checks_mapping`, `toggle_check_configuration`, `update_check_configuration`, `get_checks_mapping` |
| Read defects linked to a test | Returns the issue tracker tickets raised against a failing test. |  | `get_test_run_bug_report_draft` |

## Usage

| Workflow | What it does | Named tool | Capabilities |
| --- | --- | --- | --- |
| Read parallel session usage | Returns which users and teams are using parallel sessions, and which sessions are queued. |  | `get_parallel_queue_usage_summary`, `list_parallel_queue_team_usage`, `list_user_running_builds`, `list_queued_sessions` |
| Read usage | Returns how many test executions and parallel sessions your plan has used. |  | `get_device_tier_usage`, `get_group_plan_usage_details`, `get_test_execution_usage_count`, `list_running_builds_on_device` |
