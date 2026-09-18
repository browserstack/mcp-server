# Drift field lists, per response schema

For teststack-73. Every row is observed: the capability was invoked against preprod and the
response enumerated. `declared` is the index's `returns`; `observed` is what came back.
Source traces: tests/live/runs/tm/<capability>.json.

TestRunV2Response is omitted — already adjudicated (response right, spec stale, fixed in v1.15),
though see the note at the end: `urls` is still undeclared after that fix.

## READ THIS BEFORE COMPARING THE TWO LISTS

`declared` and `observed` below are NOT directly set-comparable, and I nearly drew a wrong
conclusion from them myself.

`returns` is a flat list of field names at ANY nesting depth. `observed` is the response's
TOP-LEVEL keys only. So a capability whose response is an envelope — `{success, folder:{…}}`
— shows every inner field as "declared but not observed" and the envelope keys as
"observed but not declared", when nothing is actually wrong.

`create_folder_v2` is the clearest trap: a naive set difference makes it look like eight
fields are missing and two are undeclared, when the real shape is simply
`{success, folder:{...}}` with `returns` describing the inner object.

The authoritative per-capability diff is the **declared, absent** and **returned, never
declared** lines, which the probes computed with the nesting in view. Use those. The two
raw lists are context, not arithmetic.

## ALREADY CORRECTED ON OUR SIDE — skip these five

We fixed these in mcp-server bbb6056 and mirrored them into the harness branch
`fix/capability-contract-drift` (overrides/tm.yaml). Their rows below now show `declared`
already matching `observed`; the "declared, absent" lines are the ORIGINAL probe evidence,
kept for provenance. Nothing is asked of you for these:

  edit_project_v1            dropped access_type, user_role, permissions
  get_custom_field_v2        added placeholder, system_name, is_bulk_editable,
                             is_filterable, group_id
  list_custom_fields_v2      added placeholder
  list_configuration_groups  dropped record_status, updated_at
  unlink_test_run_v1         guidance only — how to tell you need build_id

That leaves 29 capabilities across 19 schemas genuinely needing adjudication.

## (inline body)  (6 capabilities)

### assign_test_run_test_cases_v2  —  POST /api/v2/projects/{project_id}/test-runs/{test_run_id}/assign
- **declared** (`returns`): success
- **observed** (top-level keys): success

### bulk_update_test_run_test_cases_v2  —  PATCH /api/v2/projects/{project_id}/test-runs/{test_run_id}/test-cases
- **declared** (`returns`): success, async, unique_id
- **observed** (top-level keys): async, success, unique_id

### edit_project_v1  [ALREADY FIXED — no action]  —  POST /api/v1/projects/{project_id}/edit
- **declared** (`returns`): id, thProjectId, identifier, name, description, created_at, import_id, test_cases_count, test_runs_count, test_plans_count, links, normalisedName, starred, jira_mapped, projectVisibilityBanner
- **observed** (top-level keys): created_at, description, id, identifier, import_id, jira_mapped, links, name, normalisedName, projectVisibilityBanner, starred, test_cases_count, test_plans_count, test_runs_count, thProjectId
- **declared, absent from response**: access_type — listed in edit_project_v1's `returns` and in its own response schema properties, but absent from the actual 200 body on both the edit call and the plain get_project_by_integer_id_v1 read of the same project, user_role — listed in `returns` for edit_project_v1 but absent from the edit response (though present when reading the project via get_project_by_integer_id_v1), permissions — same: listed in `returns` for edit_project_v1 but absent from the edit response (present on a plain read)

### unlink_test_run_v1  [ALREADY FIXED — no action]  —  POST /api/v1/integrations/{issue_type}/unlink-test-run
- **declared** (`returns`): success, test_runs, info
- **observed** (top-level keys): info, success, test_runs

### update_tag_v1  —  PATCH /api/v1/projects/{project_id}/tags/{id}
- **declared** (`returns`): id, name
- **observed** (top-level keys): color_preset, created_at, group_id, id, name, updated_at
- **returned, never declared**: group_id, color_preset, created_at, updated_at

### update_test_case_v2  —  PATCH /api/v2/projects/{project_id}/test-cases/{test_case_id}
- **declared** (`returns`): success, test_case, identifier, title, folder_id, priority, status, case_type, automation_status, owner, tags, template, description, preconditions, steps, custom_fields, issues, attachments, is_shared, reviewers, review_status, created_at, last_updated_at, created_by, updated_by, urls
- **observed** (top-level keys): success, test_case

## TestPlanV2Response  (3 capabilities)

### create_test_plan_v2  —  POST /api/v2/projects/{project_id}/test-plans
- **declared** (`returns`): success, test_plan, identifier, name, description, active_state, tags, issues, test_runs_count, sub_plans_count, parent_plan_id, start_date, end_date, created_at, project_id, urls
- **observed** (top-level keys): success, test_plan
- **declared, absent from response**: parent_plan_id — listed unconditionally in the top-level `returns` array, but absent from the actual response entirely (not even present as null). The nested schema description says it is 'present only when this plan is a sub-plan', which is consistent with omission here since this is a top-level plan — so this is a documentation-precision issue (the top-level returns list should mark it conditional) rather than a hard contract violation.

### get_test_plan_v2  —  GET /api/v2/projects/{project_id}/test-plans/{test_plan_id}
- **declared** (`returns`): success, test_plan, identifier, name, description, active_state, tags, issues, test_runs_count, test_runs, sub_plans_count, parent_plan_id, start_date, end_date, created_at, project_id, links, urls
- **observed** (top-level keys): success, test_plan
- **declared, absent from response**: parent_plan_id — listed unconditionally inside the capability's top-level flat `returns` array (alongside identifier, name, etc.), but absent entirely (not null) on BOTH top-level plans probed (TP-1616, TP-1596). The nested per-field schema is more careful ('present only when this plan is a sub-plan', nullable) and is NOT contradicted — the drift is specifically in the flat `returns` summary list overclaiming unconditional presence, same pattern the sibling create_test_plan_v2 probe found.
- **returned, never declared**: urls.self, urls.sub_test_plans, links.self, links.test_runs

### update_test_plan_v2  —  POST /api/v2/projects/{project_id}/test-plans/{test_plan_id}/update
- **declared** (`returns`): success, test_plan, identifier, name, description, active_state, tags, issues, test_runs_count, sub_plans_count, parent_plan_id, start_date, end_date, created_at, project_id, urls
- **observed** (top-level keys): success, test_plan
- **declared, absent from response**: parent_plan_id

## FolderV2WriteResponse  (2 capabilities)

### create_folder_v2  —  POST /api/v2/projects/{project_id}/folders
- **declared** (`returns`): id, name, description, parent_id, cases_count, sub_folders_count, links, urls
- **observed** (top-level keys): folder, success

### rename_folder_v2  —  PATCH /api/v2/projects/{project_id}/folders/{folder_id}
- **declared** (`returns`): id, name, description, parent_id, cases_count, sub_folders_count, links, urls
- **observed** (top-level keys): folder, success

## TestRunWriteV2Response  (2 capabilities)

### replace_test_run_v2  —  POST /api/v2/projects/{project_id}/test-runs/{test_run_id}/update
- **declared** (`returns`): success, testrun, id, uuid, identifier, name, description, owner, assignee, run_state, active_state, is_automation, is_dynamic, tags, configurations, test_plans, test_cases_count, overall_progress, overall_progress_by_status_id, project_id, created_at, updated_at, links
- **observed** (top-level keys): success, testrun
- **declared, absent from response**: id, uuid, type, owner, environment, overall_progress_by_status_id, test_cases_count, is_automation, observability_url, metadata, assignee_imported, is_dynamic, test_plans, self_ui_link, links.detail
- **returned, never declared**: filter_test_cases, urls, links.test_cases, issues

### update_test_run_v2  —  PATCH /api/v2/projects/{project_id}/test-runs/{test_run_id}/update
- **declared** (`returns`): success, testrun, id, uuid, identifier, name, description, owner, assignee, run_state, active_state, is_automation, is_dynamic, tags, configurations, test_plans, test_cases_count, overall_progress, overall_progress_by_status_id, project_id, created_at, updated_at, links
- **observed** (top-level keys): success, testrun
- **declared, absent from response**: testrun.id, testrun.uuid, testrun.owner, testrun.is_automation, testrun.is_dynamic, testrun.test_plans, testrun.test_cases_count, testrun.overall_progress_by_status_id
- **returned, never declared**: testrun.filter_test_cases, testrun.urls, testrun.links.test_cases, testrun.issues

## TestRunsListV2Response  (2 capabilities)

### get_test_plan_test_runs_v2  —  GET /api/v2/projects/{project_id}/test-plans/{test_plan_id}/test-runs
- **declared** (`returns`): success, test_runs, identifier, name, description, run_state, active_state, assignee, tags, configurations, overall_progress, filter_test_cases, test_plan, project_id, created_at, updated_at, links, info
- **observed** (top-level keys): info, success, test_runs
- **declared, absent from response**: test_runs[].test_plan — contract declares every row carries a `test_plan` object ('its id field holds the TP-NNN identifier'); the actual row for TR-9061 under TP-1616 has NO test_plan key at all, even though the run genuinely is linked to TP-1616 (confirmed via the setup attach response, which did show test_plan on the run's own update-response shape).
- **returned, never declared**: test_runs[].urls — an object {self: <UI URL>} that is not mentioned anywhere in the declared response schema or in the capability's 'returns' field list.

### list_test_runs_v2  —  GET /api/v2/projects/{project_id}/test-runs
- **declared** (`returns`): success, test_runs, info, identifier, name, description, assignee, run_state, active_state, tags, configurations, filter_test_cases, test_plan, issues, issue_tracker, overall_progress, project_id, created_at, updated_at, links, urls
- **observed** (top-level keys): info, success, test_runs
- **declared, absent from response**: issues, issue_tracker, overall_progress
- **returned, never declared**: urls (top-level: appears only in the flat 'returns' array, absent from the nested per-item schema's properties entirely, yet returned with a real 'self' sub-key on both runs), links.self, links.test_cases (links is declared as a bare {type: object} with no enumerated properties, but returns these two real keys), test_plan.identifier, test_plan.name (test_plan is declared as a bare {type: object} whose prose only mentions an 'id' sub-field; identifier and name arrive undeclared)

## CommentCreateResponse  (1 capability)

### add_test_case_comment_v1  —  POST /api/v1/projects/{project_id}/folder/{folder_id}/test-cases/{test_case_id}/comments
- **declared** (`returns`): success, comment, id, user_id, entity_id, entity_type, created_at, edited, is_editable
- **observed** (top-level keys): data.comment.comment, data.comment.created_at, data.comment.edited, data.comment.entity_id, data.comment.entity_type, data.comment.group_id, data.comment.id, data.comment.is_editable, data.comment.parent_id, data.comment.project_id, data.comment.user_id.email, data.comment.user_id.full_name, data.comment.user_id.id, data.success

## CommentListResponse  (1 capability)

### get_test_case_comments_v1  —  GET /api/v1/projects/{project_id}/folder/{folder_id}/test-cases/{test_case_id}/comments
- **declared** (`returns`): comments, id, comment, user_id, entity_id, entity_type, created_at, edited, is_editable, success, info
- **observed** (top-level keys): comments, info, success

## CommentResponse  (1 capability)

### create_test_run_test_case_comment_v1  —  POST /api/v1/projects/{project_id}/test-runs/{test_run_id}/test-cases/{test_case_id}/comments
- **declared** (`returns`): data, success, comment, id, user_id, group_id, project_id, parent_id, entity_id, entity_type, created_at, comment, edited, is_editable, review_status
- **observed** (top-level keys): data.comment.comment, data.comment.created_at, data.comment.edited, data.comment.entity_id, data.comment.entity_type, data.comment.group_id, data.comment.id, data.comment.is_editable, data.comment.parent_id, data.comment.project_id, data.comment.user_id.email, data.comment.user_id.full_name, data.comment.user_id.id, data.success

## CommentsListResponse  (1 capability)

### list_test_run_test_case_comments_v1  —  GET /api/v1/projects/{project_id}/test-runs/{test_run_id}/test-cases/{test_case_id}/comments
- **declared** (`returns`): comments, success, info, id, user_id, group_id, project_id, parent_id, entity_id, entity_type, created_at, comment, edited, is_editable, review_status
- **observed** (top-level keys): comments, info, success

## ConfigurationGroupListResponse  (1 capability)

### list_configuration_groups  [ALREADY FIXED — no action]  —  GET /api/v1/configurations/groups
- **declared** (`returns`): id, name, is_system, group_id, created_at
- **observed** (top-level keys): configuration_groups, info, success
- **declared, absent from response**: record_status, updated_at

## CustomFieldV2WithDatasetsResponse  (1 capability)

### get_custom_field_v2  [ALREADY FIXED — no action]  —  GET /api/v2/custom-fields/{id}
- **declared** (`returns`): success, custom_field, id, field_type, field_name, entity_type, is_required, default_value, place_holder_text, placeholder, system_name, is_bulk_editable, is_filterable, group_id, applies_to_all_projects, link_to_future_projects, dataset_ids, datasets_url, dataset_urls
- **observed** (top-level keys): custom_field, success
- **returned, never declared**: system_name, is_bulk_editable, is_filterable, placeholder, group_id

## CustomFieldsV2Response  (1 capability)

### list_custom_fields_v2  [ALREADY FIXED — no action]  —  GET /api/v2/custom-fields
- **declared** (`returns`): success, custom_fields, info, id, field_type, field_name, entity_type, is_required, default_value, place_holder_text, placeholder, system_name, is_bulk_editable, is_filterable, linked_projects_count, group_id
- **observed** (top-level keys): custom_fields, info, success
- **returned, never declared**: placeholder

## ExploratorySessionFormFieldsResponse  (1 capability)

### get_exploratory_session_form_fields  —  GET /api/v1/projects/{project_id}/exploratory-sessions/form-fields
- **declared** (`returns`): success, custom_fields, default_fields, id, field_name, field_user_name, field_type, entity_type, is_required, optional, option_values, field_values, default_value, placeholder, is_bulk_editable, is_filterable, parent_custom_field_id, links
- **observed** (top-level keys): custom_fields, default_fields, success

## GlobalSearchResponse  (1 capability)

### global_search_v1  —  GET /api/v1/global/search
- **declared** (`returns`): test_case, test_run, test_plan, project, shared_step, report, project_details, data, info, test_case_folders, filter_details
- **observed** (top-level keys): project, project_details, report, shared_step, test_case, test_plan, test_run
- **declared, absent from response**: 400 body: `success` key (contract's own 400 schema declares {success:false, error:{code,message,details}}; actual body has no `success` key at all), 400 body: `error.code` / `error.message` / `error.details` (declared as an object with these sub-fields; actual `error` is a bare string, e.g. "No entities provided for search")
- **returned, never declared**: report.info (page/page_size/count/prev/next) -- the 200 schema's `report` object only declares data/scheduled_report_count/total_report_count, never `info`, but every report response returned one

## SubTestPlanV2Response  (1 capability)

### create_sub_test_plan_v2  —  POST /api/v2/projects/{project_id}/test-plans/{test_plan_id}/sub-test-plans
- **declared** (`returns`): success, sub_test_plan, identifier, name, description, active_state, tags, issues, test_runs_count, parent_plan_id, start_date, end_date, created_at, project_id, urls
- **observed** (top-level keys): sub_test_plan, success
- **returned, never declared**: sub_test_plan.sub_plans_count — present on the created object (value 0) and documented in the nested response schema's property list, but absent from the capability's own flat top-level `returns` array, which lists 15 keys and omits it., sub_test_plan.urls.self — `urls` is declared only as a bare `{type: object}` with no enumerated properties (description says only 'Web-app deep links for a human, plus a sub_test_plans link on top-level plans only'); the actual key returned (`self`) is nowhere spelled out.

## TemplateDetailResponse  (1 capability)

### get_template_v2  —  GET /api/v2/templates/{id}
- **declared** (`returns`): success, template, id, name, entity, enabled, step_type, is_default, is_system, future_projects_applicable, field_count, linked_to_all_projects, project_count, created_at, updated_at, description_fields, properties_fields, step_fields
- **observed** (top-level keys): success, template
- **returned, never declared**: field_data.field_type_raw is documented as 'the raw numeric type' but is actually a string type-name ("string", "date", "dropdown", "multi_dropdown", "url"), never a number, for every custom field observed on both templates, field_data (custom fields) carries 12 keys the contract never enumerates: group_id, project_id, entity_type, default_value, is_required, is_bulk_editable, placeholder, record_status, is_filterable, parent_custom_field_id, created_at, updated_at, field_data (system fields) carries keys the contract never enumerates either: system_name, optional, created_at, updated_at (contract only vaguely says field_data is 'the underlying field definition')

## TestResultSearchResponse  (1 capability)

### search_test_results_v1  —  GET /api/v1/test-results
- **declared** (`returns`): success, test_results, info, id, author, updated_by, status, result_status, description, error_description, backtrace, failure_type, log_type, expanded, started_at, finished_at, time_elapsed, created_at, updated_at, created_by_imported, attachments, issues, configuration, test_case, test_run, test_case_id, test_run_id, test_run_results_mapping_id, project_id, links
- **observed** (top-level keys): info, success, test_results
- **declared, absent from response**: test_results[].result_status.entity_type, test_results[].author.reports_and_notification_enabled, test_results[].updated_by.reports_and_notification_enabled, test_results[].issues[].issue_type
- **returned, never declared**: test_results[].result_status.value_category, test_results[].result_status.valueDetails, test_results[].issues[].created_at

## TestRunTestCasesV2Response  (1 capability)

### get_test_run_test_cases_v2  —  GET /api/v2/projects/{project_id}/test-runs/{test_run_id}/test-cases
- **declared** (`returns`): success, info, test_cases, identifier, name, latest_status, latest_result_id, assignee, priority, status, case_type, configuration_id, folder_path, dataset, project_id, source_project_id
- **observed** (top-level keys): info, success, test_cases
- **returned, never declared**: test_cases[].is_shared, test_cases[].source_project_name, test_cases[].execution_id, test_cases[].created_at, test_cases[].last_updated_at, test_cases[].created_by, test_cases[].updated_by, test_cases[].urls, test_cases[].urls.self

## V2BulkResultStatusAcceptedResponse  (1 capability)

### bulk_set_test_result_status_v2  —  PATCH /api/v2/projects/{project_id}/test-runs/{test_run_id}/results
- **declared** (`returns`): success
- **observed** (top-level keys): success

## V2HistoryListResponse  (1 capability)

### get_test_case_histories_v2  —  GET /api/v2/projects/{project_id}/test-cases/{test_case_id}/history
- **declared** (`returns`): success, history, info, version_id, version_name, source, modified_fields, modified, comment, created_at, updated_by, user_id, testcase_id
- **observed** (top-level keys): history, info, success
- **returned, never declared**: history[].origin_channel

## V2ReportDetailResponse  (1 capability)

### create_report_v2  —  POST /api/v2/projects/{project_id}/reports
- **declared** (`returns`): success, data, id, project_id, project_ids, report_type, title, description, report_timeframe, report_creation_mode, custom_date_range, frequency, frequency_details, next_run_at, is_scheduled, created_at, owner, mail_to, report_filters, dynamic_filters, latest_attachment
- **observed** (top-level keys): data, success

## V2TestCaseResponse  (1 capability)

### create_test_case_v2  —  POST /api/v2/projects/{project_id}/folders/{folder_id}/test-cases
- **declared** (`returns`): identifier, title, description, preconditions, template, folder_id, status, priority, case_type, automation_status, owner, tags, issues, steps, feature, background, scenario, custom_fields, attachments, is_shared, review_status, reviewers, created_at, created_by, last_updated_at, updated_by, urls
- **observed** (top-level keys): data.success, data.test_case
- **declared, absent from response**: attachments (declared as a returned array field; absent entirely rather than returned as [] when the case has no attachments)

## V2TestResultListResponse  (1 capability)

### get_test_results_for_test_case_v2  —  GET /api/v2/projects/{project_id}/test-runs/{test_run_id}/test-cases/{test_case_id}/results
- **declared** (`returns`): success, test_results, info, id, created_at, updated_at, created_by, description, test_case_id, test_run_id, result_status, issues, custom_fields, step_result, configuration_id, execution_id, dataset, urls
- **observed** (top-level keys): info, success, test_results
- **declared, absent from response**: test_results[].result_status.id, test_results[].result_status.internal_name, test_results[].result_status.field_name, test_results[].result_status.colour
- **returned, never declared**: test_results[].urls.self

## V2TestRunResultSubmitResponse  (1 capability)

### create_test_results_for_test_run_v2  —  POST /api/v2/projects/{project_id}/test-runs/{test_run_id}/results
- **declared** (`returns`): success, test-result, test-run-step-results, overall-result-status, results, status, message, attachments, attachment_errors, dropped_attachments
- **observed** (top-level keys): success, test-result

## Note on the already-fixed cluster

After the v1.15 correction, `get_test_run_v2` still has one mismatch: the response carries
`urls` (with `urls.self`) and the corrected `returns` does not list it. `urls` is also absent
from the `public_api_serialize_test_run` field list quoted in your message, which suggests
something outside that method adds it — worth knowing, because it means the serializer is not
the whole story for v2 run reads.

`issue_tracker` and `test_plan` are declared by the v1.15 list but were absent from this
particular response; most likely conditional rather than wrong.

