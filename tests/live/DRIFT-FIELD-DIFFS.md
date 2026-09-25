# Phase-1 DRIFT — field-level contract diffs

Generated from the `contract` block of the live run records, not from prose.
`declared_missing` = the index declares it, the API never returns it.
`undeclared_returned` = the API returns it, the index never declares it.

**80 capabilities · 231 declared-and-absent · 562 returned-and-undeclared.**

## `assign_test_run_owner`  _(observed on: preprod)_
**declared, never returned:**
- `data.testrun.self_ui_link (declared, never returned)`
- `data.testrun.type (declared, example "TestRun", never returned)`
- `skipped_test_case_ids (top-level sibling of `data` - the tool's own 200 description explicitly promises this key is ADDED to the write response envelope, 'always [] on the build-backed flow'. Genuinely absent from BOTH write responses, top-level or nested, even though nothing was skipped by this write. This is the SHALLOWEST missing path and the primary contract defect.)`
**returned, never declared:**
- `data.testrun.attachments`
- `data.testrun.closed_at`
- `data.testrun.closed_by`
- `data.testrun.created_by`
- `data.testrun.issues`
- `data.testrun.observability_id`
- `data.testrun.test_result_issues`
- `data.testrun.updated_by`

## `bulk_copy_test_cases`  _(observed on: preprod)_
**declared, never returned:**
- `source_path_folders`
**returned, never declared:**
- `folders`

## `bulk_replace_test_case_fields`  _(observed on: preprod)_
**returned, never declared:**
- `test_cases[].attachments`
- `test_cases[].estimated_duration_seconds`
- `test_cases[].is_shared`
- `test_cases[].step_count`
- `test_cases[].template_id, .template_name, .template_step_type`
- `test_cases[].test_case_dataset`
- `test_cases[].test_run_results_count, .test_run_results_issues_count`
- `test_cases[].valueDetails (on case_type/priority/status/automation_state)`
- `test_cases[].value_category (on case_type/priority/status/automation_state)`
- `top-level: folders, workflow`

## `bulk_edit_test_cases_in_test_run`  _(observed on: preprod)_
**declared, never returned:**
- `test_cases[].configuration_id`
- `test_cases[].dataset`
- `test_cases[].folder_path`
- `test_cases[].latest_result_id`
- `test_cases[].source_project_id`
**returned, never declared:**
- `... and roughly 30 more keys — see probe.item_shape for the full list`
- `test_cases[].custom_fields`
- `test_cases[].defects`
- `test_cases[].links`
- `test_cases[].mapping_id`
- `test_cases[].owner`
- `test_cases[].result_custom_fields`
- `test_cases[].result_status`
- `test_cases[].tags`
- `test_cases[].test_case_folders_path`
- `test_cases[].test_case_id`
- `test_cases[].test_run_id`

## `bulk_edit_test_cases`  _(observed on: preprod)_
**declared, never returned:**
- `success.async`
- `success.unique_id`
**returned, never declared:**
- `filter_details`
- `folders`
- `info`
- `test_cases`
- `workflow`

## `bulk_move_test_cases`  _(observed on: preprod)_
**declared, never returned:**
- `source_path_folders — declared as present 'only when the request scoped a source folder', and this call DID send a source-scoping top-level folder_id (765811); the key was absent from the 200 body entirely, not merely null or empty.`
**returned, never declared:**
- `destination_path_folders[] items also carry notes, identifier, created_at, updated_at, deleted, source, entity_type - none declared in the schema (which only lists id/project_id/group_id/name/is_automation/sub_folders_count/links/cases_count/total_cases_count); conversely the declared links field was absent from every destination_path_folders item actually returned.`
- `destination_path_folders[].group_id is a quoted STRING ("3452") in the live response; the declared schema types it as an integer. Every other id-shaped field on the same objects (id, project_id, parent_id) came back as a plain JSON integer, and no id/parent_id-as-string was reproduced here (matching the campaign's prior non-reproduction on create_sub_folder) - the drift is narrowly on group_id.`
- `folders — a top-level breadcrumb map (folder id -> ancestor-chain array) not in the declared response shape at all. Present on every synchronous 200.`

## `bulk_restore_archived_test_cases`  _(observed on: preprod)_
**returned, never declared:**
- `HTTP 404 {success:false} with an empty body (no error object, no message) — not one of the five declared response codes (200/400/401/403/422/500). This is the status a selection containing even one nonexistent id returns; it is NOT the documented bare-400 'empty selection' case (the selection was non-empty and 4/5 ids were valid), so it is a genuinely undeclared failure mode, not an instance of an existing one.`

## `clone_exploratory_session`  _(observed on: preprod)_
**declared, never returned:**
- `exploratory_session.folder_id`
**returned, never declared:**
- `exploratory_session.attachment_relations`
- `exploratory_session.attachments`
- `exploratory_session.closed_at`
- `exploratory_session.custom_fields`
- `exploratory_session.group_id`
- `exploratory_session.identifier`
- `exploratory_session.owner`
- `exploratory_session.project_id`
- `exploratory_session.record_status`
- `exploratory_session.test_plan_id`

## `clone_test_run_by_integer_id`  _(observed on: preprod)_
**declared, never returned:**
- `data.test_run.created_by`
- `data.test_run.observability_url`
- `data.test_run.self_ui_link`
- `data.test_run.type`

## `close_test_run`  _(observed on: preprod)_
**declared, never returned:**
- `observability_url`
- `self_ui_link`
- `type`
**returned, never declared:**
- `attachments`
- `created_by`
- `updated_by`

## `create_bulk_test_cases`  _(observed on: preprod)_
**declared, never returned:**
- `request_trace_id (declared string; returned null every time)`
- `test_cases[].case_type.field_name / .priority.field_name / .status.field_name (declared on all three option objects, present on none)`
- `test_cases[].steps (declared array of {step,result}; always returns empty despite test_case_steps holding real step data)`
- `test_cases[].test_case_steps (declared as a single OBJECT in the response schema; actual is an ARRAY of step records -- none of the declared object's step-authoring keys (background, feature, hashed_id, scenario, sharedStep, shared_step_detail_id, shared_step_id, test_data, test_recording_id, title) appear on the array items)`
**returned, never declared:**
- `path_folders[].identifier/created_at/updated_at/deleted/parent_id/source/entity_type/notes`
- `test_cases[].automation_state (full option object; automation_status is separately declared and also present)`
- `test_cases[].case_type.value_category / .priority.value_category / .status.value_category`
- `test_cases[].folder (full nested folder summary object, entirely undeclared per-item)`
- `test_cases[].is_shared, .test_case_dataset, .test_run_results_count, .test_run_results_issues_count`
- `test_cases[].template_step_type, .template_id, .template_name`
- `test_cases[].test_case_steps[].record_status / .group_id / .test_case_id`

## `create_custom_field_dataset`  _(observed on: preprod)_
**declared, never returned:**
- `data.options — declared as an array of option objects (items: object); the create response returns it as an empty object {} instead, and does not echo the two options submitted in the request body at all. This is not a serializer bug: a follow-up get_custom_field_dataset(dataset_id=31320, fetch_options=true) confirms both options were in fact created and stored (ids 146668/146669) — the create endpoint's response simply never reflects them, regardless of what was sent.`
**returned, never declared:**
- `data.created_at`
- `data.custom_field_id`
- `data.datasetProjects — a second, differently-named copy of the same content as linked_projects (both empty here since no projects were linked; on the sibling dataset 31319 both datasetProjects and linked_projects independently carry the identical single PR-2005 row)`
- `data.future_projects_applicable`
- `data.group_id`
- `data.record_status`

## `create_custom_field_definition`  _(observed on: preprod)_
**declared, never returned:**
- `data.default_value — declared in the 200 schema (nullable string) and explicitly named in the capability's own top-level `returns` enumeration, but absent entirely from the create response (not even present as null)`
- `data.place_holder_text — same: declared in the 200 schema and named in `returns`, absent entirely from the create response`
**returned, never declared:**
- `data.group_id`
- `data.is_bulk_editable`
- `data.is_filterable`
- `data.parent_custom_field_id`
- `data.system_name`

## `create_dataset`  _(observed on: preprod)_
**declared, never returned:**
- `dataset.created_by.browserstack_user_id (declared on the created_by sub-schema, absent in the live response)`
- `dataset.created_by.group_id (declared on the created_by sub-schema, absent in the live response)`
**returned, never declared:**
- `dataset.created_by.role (present in the live response — value 'owner' — not part of the declared created_by schema)`

## `create_exploratory_session`  _(observed on: preprod)_
**declared, never returned:**
- `/exploratory_session/folder_id`
**returned, never declared:**
- `attachment_relations`
- `attachments`
- `closed_at`
- `custom_fields`
- `group_id`
- `identifier`
- `owner`
- `project_id`
- `record_status`
- `test_plan_id`

## `create_exploratory_session_log`  _(observed on: preprod)_
**declared, never returned:**
- ` `
- `'`
- `(`
- `)`
- `,`
- `.`
- `3`
- `4`
- `5`
- `:`
- `B`
- `H`
- `O`
- `S`
- `T`
- `_`
- ```
- `a`
- `b`
- `c`
- `d`
- `e`
- `f`
- `g`
- `h`
- `i`
- `l`
- `m`
- `n`
- `o`
- `p`
- `r`
- `s`
- `t`
- `u`
- `w`
- `y`
- `—`
**returned, never declared:**
- `session_log.attachment_relations — present in the `returns` summary list but ABSENT from the fully-expanded 201 schema's `properties` object (schema/returns-summary internal inconsistency, not a live-vs-declared drift, but worth noting since it means the schema block alone under-documents the response)`
- `session_log.defects[].created_at — same, undeclared on the defects item schema`
- `session_log.defects[].id (e.g. 849732) — declared defects item schema only requires/declares {issue_id, issue_type}`
- `session_log.group_id (e.g. 3452) — same, undeclared anywhere`
- `session_log.project_id (e.g. 379335744) — not in the 201 schema's `properties` nor in the `returns` summary`

## `create_filter`  _(observed on: preprod)_
**declared, never returned:**
- `data.owner`
**returned, never declared:**
- `data.group_id`
- `data.owner_id`
- `data.record_status`

## `create_report_by_integer_id`  _(observed on: preprod)_
**declared, never returned:**
- `data.mail_to`
**returned, never declared:**
- `data.grain`
- `data.included_projects`
- `data.is_dynamic`
- `data.project_ids`
- `data.slack_notification`
- `data.slack_notification_supported`
- `data.updated_at`

## `create_root_folder`  _(observed on: preprod)_
**declared, never returned:**
- `data.project.links`
- `data.project.project_creator`
- `data.project.test_cases_count`
- `data.project.test_runs_count`
**returned, never declared:**
- `data.folder.attachments`
- `data.folder.created_by`
- `data.folder.notes`
- `data.folder.root`
- `data.folder.updated_by`
- `data.project.access`
- `data.project.app_percy_build_updated_at`
- `data.project.applicable_role`
- `data.project.applicable_role_id`
- `data.project.archived`
- `data.project.build_updated_at`
- `data.project.default_team_id`
- `data.project.group_id`
- `data.project.is_demo`
- `data.project.publicly_readable`
- `data.project.slug`
- `data.project.source`
- `data.project.sub_group_id`
- `data.project.team_id`
- `data.project.user_id`
- `data.project.visual_scanner_percy_build_updated_at`
- `data.project.web_percy_build_updated_at`

## `create_shared_step`  _(observed on: preprod)_
**returned, never declared:**
- `data.tags`

## `create_step_result`  _(observed on: preprod)_
**declared, never returned:**
- `/configuration_id`
**returned, never declared:**
- `test_run_step_result.btcer_id`
- `test_run_step_result.colour`
- `test_run_step_result.field_value`
- `test_run_step_result.id`
- `test_run_step_result.is_latest`
- `test_run_step_result.record_status`
- `test_run_step_result.status_id`
- `test_run_step_result.step_mapping_id`
- `test_run_step_result.total_step_result_count`

## `create_sub_folder`  _(observed on: preprod)_
**returned, never declared:**
- `data.folder.attachments`
- `data.folder.created_by`
- `data.folder.parent_id`
- `data.folder.root`
- `data.folder.updated_by`

## `create_test_case_by_integer_id`  _(observed on: preprod)_
**declared, never returned:**
- `test_case.case_type.field_name / test_case.priority.field_name / test_case.status.field_name (declared on all three option objects, present on none)`
- `test_case.test_case_steps (declared as a single object; actual is an array -- none of the declared object's step-authoring keys (background, feature, hashed_id, scenario, sharedStep, shared_step_detail_id, shared_step_id, test_data, test_recording_id, title) appear on the array items)`
**returned, never declared:**
- `folder.notes, path_folders[].notes/identifier/created_at/updated_at/deleted/parent_id/source/entity_type`
- `test_case.automation_state (full option object; automation_status is separately declared and also present)`
- `test_case.case_type.value_category / test_case.priority.value_category / test_case.status.value_category`
- `test_case.is_shared, test_case.test_case_dataset, test_case.test_run_results_count, test_case.test_run_results_issues_count`
- `test_case.template_step_type, test_case.template_id, test_case.template_name`
- `test_case.test_case_steps[].record_status / .group_id / .test_case_id`

## `create_test_cases`  _(observed on: preprod)_
**declared, never returned:**
- `test_case.case_type.field_name / test_case.priority.field_name / test_case.status.field_name (declared on all three option objects, present on none)`
- `test_case.test_case_steps (declared as a single object; actual is an array -- none of the declared object's step-authoring keys (background, feature, hashed_id, scenario, sharedStep, shared_step_detail_id, shared_step_id, test_data, test_recording_id, title) appear on the array items)`
**returned, never declared:**
- `folder.notes, path_folders[].notes/identifier/created_at/updated_at/deleted/parent_id/source/entity_type`
- `test_case.automation_state (full option object; automation_status is separately declared and also present)`
- `test_case.case_type.value_category / test_case.priority.value_category / test_case.status.value_category`
- `test_case.is_shared, test_case.test_case_dataset, test_case.test_run_results_count, test_case.test_run_results_issues_count, test_case.comments_count`
- `test_case.template_step_type, test_case.template_id, test_case.template_name`
- `test_case.test_case_steps[].record_status / .group_id / .test_case_id`

## `create_test_result_for_test_case`  _(observed on: preprod)_
**declared, never returned:**
- `response.data.test-result.configuration_id (declared, key entirely absent on the 201/200 create response)`
- `response.data.test-result.custom_fields (declared object, key entirely absent on the create response; present as an empty ARRAY -- not object -- on the case-scoped read of the same row)`
- `response.data.test-result.test_run_step_result (declared, key entirely absent on the create response)`
**returned, never declared:**
- `response.data.test-result.updated_by (not in the declared 201 schema's test-result properties)`

## `create_test_run_by_integer_id`  _(observed on: preprod)_
**declared, never returned:**
- `observability_url (never returned by create, though list_test_runs_by_integer_id returns it for the identical run - create-serializer-specific gap)`
- `self_ui_link (never returned, also absent from list_test_runs_by_integer_id for the same run)`
- `skipped_test_case_ids (top-level sibling of data - the tool's own 200 description explicitly promises this key is ADDED to the response envelope; it is genuinely absent from the actual body)`
- `type (never returned, also absent from list_test_runs_by_integer_id for the same run)`
**returned, never declared:**
- `attachments`
- `closed_at`
- `closed_by`
- `created_by`
- `updated_by`

## `edit_test_case`  _(observed on: preprod)_
**declared, never returned:**
- `data.test_case.case_type.field_name`
- `data.test_case.priority.field_name`
- `data.test_case.status.field_name`
**returned, never declared:**
- `data.test_case.automation_state`
- `data.test_case.case_type.value_category / priority.value_category / status.value_category / automation_state.value_category`
- `data.test_case.is_shared`
- `data.test_case.template_id`
- `data.test_case.template_name`
- `data.test_case.template_step_type`
- `data.test_case.test_case_dataset`
- `data.test_case.test_run_results_count`
- `data.test_case.test_run_results_issues_count`

## `edit_test_run`  _(observed on: preprod)_
**declared, never returned:**
- `self_ui_link (declared - never returned in any of 4 responses)`
- `type (declared, e.g. 'TestRun' - never returned in any of 4 responses)`
**returned, never declared:**
- `attachments`
- `closed_at`
- `closed_by`
- `created_by`
- `issues`
- `observability_id`
- `test_result_issues`
- `updated_by`

## `get_custom_field_dataset`  _(observed on: preprod)_
**returned, never declared:**
- `data.created_at`
- `data.custom_field_id`
- `data.datasetProjects (duplicates data.linked_projects' project entries under a differently-shaped, undeclared key)`
- `data.future_projects_applicable`
- `data.group_id`
- `data.options.info (page/page_size/count/prev/next — an undocumented pagination block for the options list; the contract's guidance only calls out missing pagination info for linked_projects, never mentions options has its own paging)`
- `data.record_status`
- `each options row's extra fields beyond a generic object: group_id, project_id, custom_field_id, dataset_id, record_status, created_at, updated_at`

## `get_custom_field_values`  _(observed on: prod)_
**returned, never declared:**
- `values[].id, group_id, project_id, custom_field_id, dataset_id, option_value, is_default, parent_option_id, record_status, created_at, updated_at -- ALL undeclared, since the capability's own schema types `values[]` items as a bare `object` with no listed properties. Not a contract violation (nothing was promised to be absent), but confirms the item shape was genuinely unspecified until this probe.`

## `get_dataset`  _(observed on: preprod, prod)_
**declared, never returned:**
- `created_by.browserstack_user_id (declared, absent on every dataset checked)`
- `created_by.group_id (declared, absent on every dataset checked)`
- `dataset.created_by.browserstack_user_id (declared on the created_by sub-schema, absent in the live response)`
- `dataset.created_by.group_id (declared on the created_by sub-schema, absent in the live response)`
**returned, never declared:**
- `created_by.role (undeclared, present on every dataset checked, values observed: 'user', 'admin')`
- `dataset.created_by.role (present in the live response, not part of the declared created_by schema)`

## `list_entity_filter_details`  _(observed on: preprod, prod)_
**declared, never returned:**
- `colour -- declared as a REQUIRED property on every priority/status/case_type item (shared status-value shape), but absent from all three in the actual response.`
- `colour — declared REQUIRED on every priority/status/case_type item; actually absent from all six real items returned (priority High/Critical, status Active/In Review, case_type Acceptance/Functional). Reproduces preprod finding (1) exactly on prod.`
**returned, never declared:**
- `automation_status, created_at, updated_at, custom_fields -- returned as null/{} in the body even though none of q[automation_status]/q[created_at]/q[updated_at]/q[custom_fields] were sent. This directly contradicts the capability's own guidance ('It returns only the keys you actually passed under q... Keys absent from the request are absent here') and the 200 description ('only the keys you supplied under q are present; an empty q yields filter_details:{}'). Every unrequested filter key is present anyway (just empty/null), not absent.`
- `automation_status: null, created_at: null, updated_at: null, custom_fields: {} — all four returned even though NONE were requested in q[...], contradicting the capability's own guidance ('It returns only the keys you actually passed under q ... send nothing and you get {success:true, filter_details:{}}'). Reproduces preprod finding (4) exactly.`
- `entity_type -- present on every priority/status/case_type item, not in the declared schema for that shared shape.`
- `entity_type — present on every priority/status/case_type item ({"entity_type":"TestCase", ...}); not in the declared item schema. Reproduces preprod finding (2) exactly.`
- `folders top-level: select_all_parent_ids, partial_selected_parent_ids, only_selected_parent_ids, only_child_selected_parent_ids — 4 undeclared keys, exactly as preprod found.`
- `folders.folder_tree[] and folders.folders[] items -- actual shape is {id, parent_id, sub_folders_count, name, folder_path, selected_all, ancestors, contents(tree only)}; the declared schema instead specifies {id, project_id, group_id, name, is_automation, sub_folders_count, links.self, cases_count, total_cases_count}. None of project_id/group_id/is_automation/links/cases_count/total_cases_count appeared, and none of parent_id/folder_path/selected_all/ancestors/contents are declared. This is not a couple of extra fields -- it is a different folder-row shape entirely.`
- `folders.folder_tree[] items shaped {id,parent_id,sub_folders_count,name,folder_path,selected_all,ancestors,project_id,contents} — totally different from the declared {id,project_id,group_id,name,is_automation,sub_folders_count,links,cases_count,total_cases_count}. Reproduces preprod finding (3): only id/sub_folders_count/name/project_id survive from the declared shape; group_id, is_automation, links, cases_count, total_cases_count are declared-but-absent, while parent_id, folder_path, selected_all, ancestors, contents are undeclared-but-present.`
- `folders.folders[] (flat list) same structural mismatch as folder_tree, minus the 'contents' key.`
- `folders.select_all_parent_ids, folders.partial_selected_parent_ids, folders.only_selected_parent_ids, folders.only_child_selected_parent_ids -- four top-level keys under filter_details.folders with no mention anywhere in the declared schema.`

## `get_exploratory_session`  _(observed on: preprod, prod)_
**declared, never returned:**
- `folder_id`
- `name`
- `summary`
- `test_plan`
**returned, never declared:**
- `attachment_relations`
- `group_id`
- `owner`
- `project_id`
- `record_status`

## `get_folder_tree`  _(observed on: preprod, prod)_
**declared, never returned:**
- `group_id`
- `group_id — listed in describeCapability's `returns` for every node, never present on any root or nested folder in the actual response`

## `get_issues_count_info`  _(observed on: prod)_
**declared, never returned:**
- `count`
- `label`

## `get_project_form_fields`  _(observed on: preprod, prod)_
**returned, never declared:**
- `default_fields.*.values[] entirely undocumented shape beyond the prose '{values, total_count}' -- actual per-option rows carry internal_name, is_default, value, name (and conditionally value_category / colour)`
- `default_fields.*.values[].internal_name / is_default / value / name — whole option-row shape is undocumented at the schema level for default_fields`
- `default_fields.<dataset-backed field>.links.self (undeclared)`
- `default_fields.automation_state.values[].value_category (undeclared)`
- `default_fields.automation_state.values[].value_category — not declared anywhere (default_fields has no item-level schema at all, only prose '{values, total_count}')`
- `default_fields.status.values[].colour (undeclared, and inconsistently present)`
- `default_fields.status.values[].colour — same, undeclared`
- `system_fields returned as an OBJECT {description_fields, property_fields, others} instead of the declared bare ARRAY of {id, field_name, field_type, system_name, is_removable} rows — structural container mismatch (DRIFT)`
- `system_fields: declared type is a bare ARRAY of {id, field_name, field_type, system_name, is_removable}; actual response returns an OBJECT {description_fields: [...], property_fields: [...], others: []} -- a top-level type mismatch, not just an undeclared field`

## `get_projects_basic`  _(observed on: preprod)_
**declared, never returned:**
- `projects[].permissions`

## `get_projects_minify`  _(observed on: preprod, prod)_
**declared, never returned:**
- `permissions`
- `projects[].permissions`
**returned, never declared:**
- `access_via_secondary_team`
- `projects[].access_via_secondary_team`

## `get_report_detail`  _(observed on: preprod, prod)_
**declared, never returned:**
- `data.mail_to — declared required (type object, required:[users,external_mails]) but the key is entirely absent from data on EVERY get_report_detail response taken in this run (bare, sections=, report_data_only, is_print — both a Test Run Summary and a Test Plan Summary report). This is the exact same field the preprod create_report_by_integer_id/update_report probes found missing from their response.data.`
- `report_data.test_run_data (and the other 6 schema-required report_data properties) — ALL absent when sections=<a *_drilldown value>&widget_type=... is used; see undeclared_returned for what replaces them. Verified with sections=tr_drilldown&widget_type=active_runs.`
- `report_filters.custom_fields / .test_run_ids / .first_test_run — declared required sub-fields, but report_filters comes back as a bare {} for every last_one_week/last_one_month report probed here (report_timeframe not using report_filters). Same behavior preprod's get_report_detail run already documented as tied to timeframe, not new.`
**returned, never declared:**
- `data.updated_at, data.project_ids, data.included_projects, data.is_dynamic, data.grain, data.slack_notification, data.slack_notification_supported — the SAME 7 fields flagged in the preprod create_report_by_integer_id/update_report finding as evidence of one shared serializer. Confirmed present, byte-for-byte the same field set, on get_report_detail's read response too. This extends the shared-serializer drift from the write path to this read capability.`
- `is_dynamic, filters — present on every call (bare, is_print, drilldown); listed in the capability's own `returns` summary array but absent from the formal 200 response JSON-schema `properties` block (prose-vs-schema disagreement, not a runtime defect)`
- `is_dynamic, filters — top-level keys present on every call; listed in this capability's own `returns` summary array but absent from the formal 200 JSON-schema `properties` block (same prose-vs-schema gap noted on preprod).`
- `report_data.rows, report_data.total, report_data.info — when a *_drilldown section is requested, report_data is wholly replaced by this paginated-rows shape ({rows:[...], total:30, info:{page,page_size}}); this replacement shape is not present in the schema's report_data definition at all, which is fixed to the 7 aggregate fields with no oneOf/alternate for drilldown mode`
- `report_data.time_tracking_enabled — present only with is_print/sections, not declared anywhere in the schema (same as preprod).`
- `report_data.time_tracking_enabled — present with is_print/sections, not declared anywhere in this capability's schema (time_tracking and estimated_vs_actual ARE declared as valid section names but time_tracking_enabled is not documented at all)`

## `get_report_section`  _(observed on: preprod, prod)_
**returned, never declared:**
- `The declared 200 schema is the literal empty object {"type":"object"} — no properties at all, so every key returned (test_run_data, issues_data, test_run_status, test_cases_status, user_result_stats, issues_by_status, issues_by_priority, time_tracking, estimated_vs_actual and all nested fields) is technically undeclared. Same unfalsifiable-schema condition already recorded on preprod.`
- `The entire response body is undeclared: describeCapability's 200 schema is the literal empty object {"type":"object"} — no properties are declared at all, so every key returned (test_run_data, issues_data, test_run_status, test_cases_status, user_result_stats, issues_by_status, issues_by_priority, time_tracking, estimated_vs_actual, and all nested fields) is technically undeclared.`

## `list_root_folders`  _(observed on: preprod, prod)_
**declared, never returned:**
- `parent_id (promised in prose `returns` list and in guidance text, never present on any root-folder row, not even as null)`
**returned, never declared:**
- `folders[].notes`
- `notes (present on live folder rows; absent from the declared 200 JSON schema's folders[] item properties, though present in the capability's separate prose `returns` list)`

## `get_selected_report_testcases`  _(observed on: preprod, prod)_
**declared, never returned:**
- `selection_data: root `required` array lists it as mandatory and its schema is `type: object` with its own `required: [select_all, folders, unique_test_case_count]`, not marked nullable anywhere. The live 200 response returned `selection_data: null` — a bare JSON null, not an object, so none of select_all/folders/unique_test_case_count could be checked. This also contradicts the capability's own prose guidance, which states for exactly this case (a report with no case filters saved, which SC-489 is — report_filters: {} confirmed via get_report) that the endpoint 'simply returns an unfiltered project selection tree' — i.e. a populated folder-keyed object, not null.`
- `selection_data: root `required` array marks it mandatory, typed `object` with its own required sub-fields (select_all, folders, unique_test_case_count), not nullable anywhere in the schema. The live 200 response returned selection_data: null — a bare JSON null, not an object, so none of select_all/folders/unique_test_case_count could be checked. This also directly contradicts the capability's own guidance, which says for exactly this state (a report with no case filters saved, and report_filters:{} was confirmed for SC-12541 via get_report_detail/list_reports in the sibling run files) it 'simply returns an unfiltered project selection tree' — i.e. a populated folder-keyed object, not null.`

## `get_system_field_values`  _(observed on: preprod, prod)_
**returned, never declared:**
- `*.values[].internal_name — undeclared on every field_name tested (status/priority/case_type/automation_state); machine slug distinct from display `name``
- `*.values[].is_default — undeclared on every field_name tested; BOTH duplicate rows of the default option carry the same is_default:1, so it cannot be used to pick a canonical copy`
- `automation_state.values[].value_category (present only on automation_state)`
- `automation_state.values[].value_category — undeclared, present ONLY on automation_state rows ('automated' | 'manual')`
- `info.count disagrees with the number of rows actually returned, on every field_name that has duplicates: status count=13 vs 10 rows returned; priority count=11 vs 8 rows; case_type count=23 vs 22 rows — and this is with info.next:null (page 1 of 1, i.e. the response claims to be the complete list). automation_state (count=5, 5 rows) and defects (count=0, 0 rows) — the only two field_names with no duplication — have count == rows exactly.`
- `internal_name (undeclared on every field_name)`
- `is_default (undeclared on every field_name)`
- `priority.values[] and case_type.values[] carry NEITHER colour NOR value_category — declared schema (value+name only) is short by 2 fields even on the 'plainest' field types`
- `status.values[].colour (present only on status)`
- `status.values[].colour — undeclared, present ONLY on status rows (value equals internal_name, e.g. 'active')`

## `get_test_case_by_integer_id`  _(observed on: preprod, prod)_
**declared, never returned:**
- `data.test_case.title — describeCapability on prod still declares `title` (example "Login with valid credentials") as one of only 3 properties under data.test_case. The live prod response has no `title` key at all; the real field is `name` (confirmed "MCP" / "User Register form" across all 3 sampled cases), exactly matching the guidance prose ("the field is called `name`, not `title`"). Schema is stale/wrong on prod, identically to preprod.`
- `data.test_case.title — the declared 200 schema names the field `title` (with example "Login with valid credentials"); the actual response has no `title` key at all, only `name`. This matches the capability's own guidance text ("the field is called `name`, not `title`"), so the guidance is correct and the formal schema property is simply stale/wrong.`
**returned, never declared:**
- `(47 fields total under data.test_case on this prod payload vs a declared schema of 3 properties: identifier, id, title/name. reviewers and review_status are undeclared fields present on prod that were absent from the preprod trace's own item_shape — either not observed there or genuinely env-specific; not itself evidence of a contract problem beyond the same 3-vs-N stub gap.)`
- `(~41 fields total under data.test_case — the declared 200 schema lists only 3 properties: identifier, id, title/name. Everything else the live route returns is undeclared, including the full assignee/creator user objects, all four option-row descriptors, steps/tags/attachments, and run/issue counts.)`
- `assignee`
- `attachments`
- `automation_state`
- `automation_status`
- `case_type`
- `case_type_imported`
- `comments_count`
- `created_at`
- `creator_details`
- `custom_fields`
- `description`
- `estimated_duration_seconds`
- `expected_result`
- `history_count`
- `is_automation`
- `is_shared`
- `issues`
- `lcnc_build_map`
- `links`
- `metadata`
- `name`
- `owner`
- `owner_imported`
- `preconditions`
- `priority`
- `priority_imported`
- `project_id`
- `review_status`
- `reviewers`
- `status`
- `status_imported`
- `steps`
- `tags`
- `template`
- `template_id`
- `template_name`
- `template_step_type`
- `test_case_dataset`
- `test_case_folder_id`
- `test_case_steps`
- `test_run_results_count`
- `test_run_results_issues_count`
- `updated_at`
- `updator_details`

## `get_test_case_count_trend`  _(observed on: preprod, prod)_
**declared, never returned:**
- `data.Total.field`

## `get_test_case_detail`  _(observed on: preprod, prod)_
**declared, never returned:**
- `using_fallback_template - never appeared in any of the 4 probed responses despite being called out in guidance prose.`
**returned, never declared:**
- `attachments[]`
- `automation_state (full descriptor, distinct from the declared automation_status:{name,value})`
- `data.test_case.attachments (array — present with real data, and explicitly promised by the capability's own intent text, but absent from the declared 200 schema)`
- `data.test_case.automation_state (whole object: id, internal_name, field_name, colour, value_category, name — schema only declares the separate `automation_status` {name,value} pair)`
- `data.test_case.duplicates_tc_count (mentioned only in guidance prose, never in the formal schema; populated only when hasDuplicates=true is sent, otherwise null)`
- `data.test_case.folder (always null in every response seen)`
- `data.test_case.folder_path (present only when include=folder_path is sent; documented in the query param description, not in the response schema)`
- `data.test_case.is_shared`
- `data.test_case.template_id`
- `data.test_case.template_name`
- `data.test_case.template_step_type`
- `data.test_case.test_case_dataset`
- `data.test_case.test_run_results_count`
- `data.test_case.test_run_results_issues_count`
- `data.test_case.testcase_template (mentioned only in guidance prose, never in the formal schema; a large nested object)`
- `duplicates_tc_count`
- `estimated_duration_seconds (real value; declared `estimate` field is always null as guidance says)`
- `folder (always null in all 4 probes)`
- `folder_path (only with include=folder_path)`
- `is_shared`
- `reviewers (array, empty on all probed cases) and review_status (string, e.g. 'pending') - NOT called out in the preprod undeclared-field list; new additional undeclared fields observed on prod.`
- `template_id`
- `template_name`
- `template_step_type`
- `test_case_dataset`
- `test_run_results_count`
- `test_run_results_issues_count`
- `testcase_template (huge, ~1MB+)`
- `value_category nested inside case_type / priority / status objects (schema declares only {id, internal_name, field_name, colour, name} for each; value_category is undeclared on all three, not just on automation_state as a general house rule might suggest)`

## `list_test_case_histories`  _(observed on: preprod, prod)_
**declared, never returned:**
- `histories[].user.email`
- `user.email`
**returned, never declared:**
- `histories[].origin_channel`
- `origin_channel`

## `get_test_case_history`  _(observed on: preprod, prod)_
**declared, never returned:**
- `history.user.email`
- `history.user.email (declared on the user sub-schema; absent from the live user object, same gap seen on other tm user sub-objects this session)`
- `history.version_name`
- `history.version_name (declared nullable string on the history schema; absent entirely — not even null — from this response; the listing row for this same id 1674611 DID carry version_name 'V19', so the field exists server-side and this route simply drops it)`
**returned, never declared:**
- `history.origin_channel`
- `history.origin_channel (present as "api" in the live response; not part of the declared history schema)`

## `list_test_run_test_cases_by_integer_id`  _(observed on: preprod, prod)_
**returned, never declared:**
- `assignee_imported`
- `automation_state`
- `dataset_values`
- `deleted`
- `is_shared`
- `project_name`
- `result_notes`
- `review_status`
- `reviewers`
- `step_count`
- `template_id`
- `template_step_type`
- `test_case_folders_path`
- `test_run_results_count`
- `test_run_results_issues_count`

## `list_test_cases`  _(observed on: preprod, prod)_
**declared, never returned:**
- `comments_count`
- `test_cases[].comments_count`
**returned, never declared:**
- `automation_state`
- `estimated_duration_seconds`
- `is_shared`
- `review_status`
- `reviewers`
- `step_count`
- `template_id`
- `template_name`
- `template_step_type`
- `test_case_dataset`
- `test_cases[].automation_state (whole descriptor object)`
- `test_cases[].estimated_duration_seconds`
- `test_cases[].is_shared`
- `test_cases[].priority.value_category / case_type.value_category / status.value_category`
- `test_cases[].step_count`
- `test_cases[].template_id`
- `test_cases[].template_name`
- `test_cases[].template_step_type`
- `test_cases[].test_case_dataset`
- `test_cases[].test_run_results_count`
- `test_cases[].test_run_results_issues_count`
- `test_run_results_count`
- `test_run_results_issues_count`

## `get_test_plan_by_integer_id`  _(observed on: preprod, prod)_
**declared, never returned:**
- `test_plan.parent_plan`
- `test_plan.parent_plan — expected absence, this is a top-level plan (parent_plan is sub-plan-only per guidance)`
- `test_plan.reviewers`
**returned, never declared:**
- `test_plan.test_plan_progress`
- `test_plan.test_plan_progress (always {})`
- `test_plan.test_results_trend`
- `test_plan.test_results_trend (null)`

## `get_test_plan_execution_trend`  _(observed on: preprod, prod)_
**declared, never returned:**
- `The declared 200 schema for test_plans_execution_trend_graph is a bare {type: object, description: 'The trend series for the scoped plan or run.'} placeholder with NO properties at all — it does not declare the field as an array, does not declare a 'name'/'data' series shape, and does not declare the inner point shape. Nothing below the top key is specified.`
- `The declared schema for test_plans_execution_trend_graph is a bare {type:object} with no properties — it does not declare an array, a name/data series shape, or the inner point shape. Same gap on prod as on preprod.`
**returned, never declared:**
- `data (per-series array of [date_string, count_int] positional pairs)`
- `data (per-series array of [date_string, count_int] positional pairs, undocumented)`
- `name (series label, e.g. "Untested"/"Failed" — a result-status name, undocumented)`
- `name (series label, e.g. 'Untested' — a result-status name, not documented anywhere in the schema)`

## `list_test_plan_test_runs_by_integer_id`  _(observed on: preprod, prod)_
**declared, never returned:**
- `test_runs[].self_ui_link`
- `test_runs[].self_ui_link — declared string; absent entirely from the actual row (same depth as `type`, so both are reported — neither sits inside another missing path).`
- `test_runs[].type`
- `test_runs[].type — declared string (example 'TestRun'); absent entirely from the actual row.`
**returned, never declared:**
- `test_runs[].attachments`
- `test_runs[].attachments (null)`
- `test_runs[].build_meta`
- `test_runs[].build_meta (object: id, name, creationType, buildNormalisedName, build_number) — none of this is in the declared schema or the capability's `returns` list.`
- `test_runs[].closed_at`
- `test_runs[].closed_at (null)`
- `test_runs[].closed_by`
- `test_runs[].closed_by (null)`
- `test_runs[].created_by`
- `test_runs[].created_by (null)`
- `test_runs[].observability_id`
- `test_runs[].observability_id (string, duplicates the numeric part of observability_url)`
- `test_runs[].updated_by`
- `test_runs[].updated_by (null)`

## `list_test_results_for_test_case_by_integer_id`  _(observed on: preprod, prod)_
**declared, never returned:**
- `test-results[].configuration_id`
**returned, never declared:**
- `info.truncated`
- `test-results[].updated_by`

## `get_test_run_detail`  _(observed on: preprod, prod)_
**declared, never returned:**
- `all_test_cases`
**returned, never declared:**
- `assignee_imported`
- `build_normalised_name`
- `build_serial_id`
- `environment`
- `is_read_from_tra_enabled`
- `tc_sharing_enabled`

## `get_test_runs_form_fields`  _(observed on: preprod, prod)_
**declared, never returned:**
- `custom_fields[].applies_to_all_projects — declared, never present on any of the 3 returned custom fields`
- `custom_fields[].assigned_projects — declared, never present`
- `custom_fields[].link_to_future_projects — declared, never present`
- `custom_fields[].options — declared key never appears; actual key is 'option_values' with a completely different item shape`
- `custom_fields[].place_holder_text — declared; actual key (when present) is 'placeholder' (different spelling/casing, and absent entirely on the multi_dropdown fields)`
**returned, never declared:**
- `custom_fields[].field_type values ('field_multi_dropdown', 'field_string') — do not match ANY value in the declared enum (string, text, user, dropdown, multi_dropdown, url, boolean, int, date); every field_type observed carries an undeclared 'field_' prefix not in the declared enum`
- `custom_fields[].field_user_name, optional, is_bulk_editable, is_filterable, links — all undeclared, present on every custom field row`
- `custom_fields[].field_values[] — undeclared key, present on every row (empty for dropdown types, populated with literal values for the string-type field)`
- `custom_fields[].id — declared type 'string', actual type is integer (e.g. 193254, not "193254")`
- `custom_fields[].option_values[] — undeclared key entirely replacing the declared 'options' key, with an undeclared per-option shape: {id, option_value, is_default, record_status, created_at, updated_at, dataset_id}`
- `default_fields.status.values[].value_category — not in the declared item schema (required: internal_name, is_default, colour, value, name); present on 7 of 8 rows (passed, failed, blocked, retest, skipped, in_progress, unknown all carry value_category:'completed') and ABSENT on the 8th ('untested', the is_default:1 row) — looks like a real semantic marker (terminal/completed vs. the default open state) that the schema simply never documented, not noise.`
- `default_fields.status.values[].value_category — still undeclared (as on preprod); present on 29 of 30 rows, absent only on 'untested'`

## `list_test_runs_selection`  _(observed on: preprod, prod)_
**declared, never returned:**
- `test_cases[].assignee`
- `test_cases[].automation_status (declared as {name,value} object, actual is a bare string e.g. 'not_automated' — confirmed in both response shapes)`
- `test_cases[].automation_status (declared as {name,value} object, actual is a bare string e.g. 'not_automated')`
- `test_cases[].case_type`
- `test_cases[].case_type_imported`
- `test_cases[].comments_count`
- `test_cases[].creator_details`
- `test_cases[].custom_fields`
- `test_cases[].custom_fields (present only in the LEAN shape, absent from the RICH shape)`
- `test_cases[].estimate`
- `test_cases[].history_count`
- `test_cases[].is_automation`
- `test_cases[].issues`
- `test_cases[].lcnc_build_map`
- `test_cases[].links`
- `test_cases[].owner_imported`
- `test_cases[].priority`
- `test_cases[].priority_imported`
- `test_cases[].status`
- `test_cases[].status_imported`
- `test_cases[].steps`
- `test_cases[].tags`
- `test_cases[].test_case_folder_id`
- `test_cases[].test_case_steps`
- `test_cases[].updator_details`
**returned, never declared:**
- `test_cases[].archived_at`
- `test_cases[].automation_id`
- `test_cases[].created_by`
- `test_cases[].estimated_duration_seconds`
- `test_cases[].folder_id`
- `test_cases[].folder_structure`
- `test_cases[].group_id`
- `test_cases[].import_id`
- `test_cases[].is_project_level`
- `test_cases[].is_shared`
- `test_cases[].priority_id (lean-shape only, an integer id, not the declared priority object)`
- `test_cases[].review_sent_date`
- `test_cases[].review_status`
- `test_cases[].source`
- `test_cases[].source_entity_id`
- `test_cases[].template_id`
- `test_cases[].third_party_identifier`
- `test_cases[].trashed_at`
- `test_cases[].type`
- `test_cases[].updated_by`

## `list_test_runs_by_integer_id`  _(observed on: preprod)_
**declared, never returned:**
- `test_runs[].self_ui_link — declared string; absent from every row (same depth as `type`, both reported since neither sits inside another missing path).`
- `test_runs[].type — declared string (example 'TestRun'); absent from every one of the 30 rows returned.`
**returned, never declared:**
- `test_runs[].assignee.email — the declared assignee object lists only {id, browserstack_user_id, full_name, group_id, onboarded}; actual assignee objects (e.g. TR-9075, TR-9091, TR-9089) additionally carry an `email` string`
- `test_runs[].attachments (null in all 30 rows)`
- `test_runs[].build_meta (object: id, name, creationType, buildNormalisedName, build_number) — not in the declared schema or the capability's `returns` list`
- `test_runs[].closed_at (null in all 30 rows)`
- `test_runs[].closed_by (null in all 30 rows)`
- `test_runs[].created_by (null in all 30 rows)`
- `test_runs[].observability_id (string, duplicates the numeric part of observability_url; also equals `uuid` numerically, e.g. TR-9075: uuid=17576237, observability_id="17576237")`
- `test_runs[].updated_by (null in all 30 rows)`

## `list_folder_contents`  _(observed on: prod)_
**declared, never returned:**
- `On the nested_sub_folders=true path, `info` was returned as bare null instead of the declared object shape ({page, page_size, count, prev, next}).`
- `self.notes was declared in the 200 schema but absent from the response body entirely (not even null) on non-leaf folders 40231630 and 40231631; present as a string on leaf folders 9697326/9600935.`
**returned, never declared:**
- `On the nested_sub_folders=true path, self.contents is still populated recursively even though the capability's own guidance says nested mode strips self.contents.`
- `self.contents[].group_id is returned as a JSON string ("2") though the declared schema types group_id as integer for every item shape in this response, including self.contents[] items (same schema block reused).`

## `list_folder_test_cases`  _(observed on: preprod, prod)_
**declared, never returned:**
- `test_cases[].test_case_steps -- declared as a nested object (background, feature, scenario, hashed_id, id, order, project_id, result, sharedStep, shared_step_detail_id, shared_step_id, step, test_data, test_case_id, test_recording_id, title, created_at, updated_at); every observed row across both folders (20 rows total) returns an empty ARRAY instead. This is a type mismatch, not just an empty-collection ambiguity -- the container type itself disagrees with the contract, so none of those nested fields are reachable via this response shape.`
**returned, never declared:**
- `automation_state (whole descriptor object; schema only documents automation_status:{name,value})`
- `creator_details`
- `duplicates_tc_count`
- `estimated_duration_seconds`
- `folders (top-level, only present when include_subfolders_tc=true) -- declared as bare {type:object}; see scratch_folder_flag_comparison.branch_include_subfolders_tc_true.folders_block for the actual shape`
- `is_shared`
- `priority.value_category`
- `review_status`
- `reviewers`
- `step_count`
- `template_id`
- `template_name`
- `template_step_type`
- `test_case_dataset`
- `test_cases[].automation_state -- a full descriptor object (id, internal_name, field_name, colour, value_category, name), entirely absent from the declared schema, which documents only the differently-shaped automation_status:{name,value}. The two co-exist on every row and describe the same underlying state.`
- `test_cases[].duplicates_tc_count`
- `test_cases[].estimated_duration_seconds`
- `test_cases[].is_shared`
- `test_cases[].priority.value_category -- undeclared extra key on the otherwise-matching priority object (always null in observations)`
- `test_cases[].step_count`
- `test_cases[].template_id`
- `test_cases[].template_name`
- `test_cases[].template_step_type`
- `test_cases[].test_case_dataset`
- `test_cases[].test_run_results_count`
- `test_cases[].test_run_results_issues_count`
- `test_run_results_count`
- `test_run_results_issues_count`
- `updator_details`

## `list_projects`  _(observed on: preprod, prod)_
**declared, never returned:**
- `project_creator`
- `projects[].project_creator`
**returned, never declared:**
- `duplicates_tc_count`
- `info.starred_count`
- `jira_mapped`
- `normalisedName`
- `projectVisibilityBanner`
- `projects[].duplicates_tc_count`
- `projects[].jira_mapped`
- `projects[].normalisedName`
- `projects[].projectVisibilityBanner`
- `projects[].starred`
- `projects[].test_plans_count`
- `projects[].thProjectId`
- `starred`
- `test_plans_count`
- `thProjectId`

## `list_test_case_tags`  _(observed on: preprod, prod)_
**declared, never returned:**
- `tag_objects — declared as a required field of the 200 schema (required: [tags, tag_objects, info]), but the unfiltered/paged call (no q) omits it entirely; it only appears when q is supplied`
- `tag_objects — declared required in the 200 schema but absent from the response body (not even an empty array) when q is omitted (attempt 1). Present and populated as soon as q is supplied (attempts 2-3). Confirmed on real data: this project has 31 real test-case tags, all visible via the no-q call, none of which came back with tag_objects.`

## `list_test_plans_by_integer_id`  _(observed on: preprod, prod)_
**returned, never declared:**
- `test_plans[].attachments`
- `test_plans[].completed_by`
- `test_plans[].review_settings`
- `test_plans[].review_status`
- `test_plans[].test_plan_progress`
- `test_plans[].test_plan_progress (always {}, separate from the declared test_plan_progress_v2)`
- `test_plans[].test_results_trend`
- `test_plans[].test_results_trend_v2`

## `list_workspace_fields`  _(observed on: preprod)_
**declared, never returned:**
- `info.total_pages — absent on every response where the result spans more than one page (i.e. whenever info.prev/info.next are present); only appears when the whole result fits on page 1`
**returned, never declared:**
- `info.prev, info.next — present whenever the result spans more than one page, or even on a legitimate zero-count query (entity_type=TestPlan); absent (replaced by total_pages) only in the single-page case. Neither key is in the declared `info` schema nor in the capability's `returns` list.`

## `move_folder_by_integer_id`  _(observed on: preprod)_
**declared, never returned:**
- `source_path_folders[].links and destination_path_folders[].links - the declared schema gives every path-folder item a links:{self} object; the live items (both source_path_folders[0] and destination_path_folders[0]) omit the key entirely, not merely set it null.`
**returned, never declared:**
- `data.unique_id was absent on this synchronous, same-project move. This matches the capability's own guidance (unique_id is described as the async-path artifact) so it is NOT treated as drift, just recorded for completeness.`
- `group_id came back as a quoted STRING ("3452") everywhere it appeared in this response - data.folder.group_id, source_path_folders[0].group_id, and destination_path_folders[0].group_id - against the declared integer type. Every other id-shaped field (id, project_id, parent_id) was a plain JSON integer in the same objects; the drift is narrowly on group_id.`
- `source_path_folders[] and destination_path_folders[] items also carry notes, identifier, created_at, updated_at, deleted, parent_id, source, entity_type - none declared in the schema (which lists only id/project_id/group_id/name/is_automation/sub_folders_count/links/cases_count/total_cases_count).`

## `rename_folder_by_integer_id`  _(observed on: preprod)_
**returned, never declared:**
- `data.folder.group_id (declared type integer in the 200 schema; returned as the JSON string "3452" instead of a number)`
- `data.folder.notes`

## `reorder_test_cases_by_folder`  _(observed on: preprod)_
**declared, never returned:**
- `info (top-level) — declared as a returned key on every 200, but absent from every successful response body in this probe (shallowest miss; not pursued deeper into test_cases[] once this top-level key was already confirmed missing)`
**returned, never declared:**
- `error envelope shape: declared 400/404/500 all say {success:false, error:{code,message,details}}; every actual error in this probe was {errors:"<plain string>"} — no success key, no error object, no code. (The capability's own guidance text already flags this pattern in prose; this probe reconfirms it against the ACTUAL declared JSON schema, which still shows the generic envelope and was never corrected to match.)`
- `test_cases[].automation_state, .is_shared, .estimated_duration_seconds, .template_id, .template_name, .template_step_type, .step_count, .test_run_results_count, .test_run_results_issues_count, .test_case_dataset — present on every row, none declared`

## `search_group_tags`  _(observed on: preprod, prod)_
**declared, never returned:**
- `tag_objects — declared required in the 200 schema, never present in any of the 4 successful live responses observed (entity_type=test_case and test_run; with and without q; p=1 and p=2)`
- `tag_objects — declared required in the 200 schema; NEVER present in any of the 24 live responses observed in this run (entity_type=test_case across ~15 sampled pages from p=1 to p=357, and entity_type=test_run at p=1). Every successful body had exactly the keys ['tags','info'].`
**returned, never declared:**
- `tags[].id — the declared 200 schema types `tags` as a plain array of strings ('Simple array of tag names (for backward compatibility)'); every live response instead returned `tags` as an array of {id, name} objects, on both entity_type values, at every page sampled including the very first (p=1) and very last (p=357) real pages.`
- `tags[].id — the declared 200 schema types `tags` as a plain array of strings ('Simple array of tag names (for backward compatibility)'); every live response instead returned `tags` as an array of {id, name} objects. Both the formal schema and its own prose are wrong about this field's shape.`

## `search_project_entities`  _(observed on: preprod, prod)_
**declared, never returned:**
- `test_cases[].comments_count`
**returned, never declared:**
- `folders — TYPE MISMATCH: declared as an array of {id, project_id, group_id, name, is_automation, sub_folders_count, links, cases_count, total_cases_count}; actual response is an OBJECT keyed by folder_id whose value is an array of trimmed objects {id, name, parent_id, ui_position} (no project_id/group_id/is_automation/sub_folders_count/links/cases_count/total_cases_count; adds parent_id, ui_position)`
- `folders: structural type mismatch — declared array, actual object keyed by folder_id with a further-trimmed item shape wrapped in an array per key`
- `test_cases[].attachments`
- `test_cases[].automation_state`
- `test_cases[].case_type.valueDetails`
- `test_cases[].case_type.value_category`
- `test_cases[].estimated_duration_seconds`
- `test_cases[].is_shared`
- `test_cases[].metadata.lcnc_build_map.profileId`
- `test_cases[].priority.valueDetails`
- `test_cases[].priority.value_category`
- `test_cases[].priority.value_category / valueDetails`
- `test_cases[].review_status`
- `test_cases[].reviewers`
- `test_cases[].status.valueDetails`
- `test_cases[].status.value_category`
- `test_cases[].status.value_category / valueDetails`
- `test_cases[].step_count`
- `test_cases[].template_id`
- `test_cases[].template_name`
- `test_cases[].template_step_type`
- `test_cases[].test_case_dataset`
- `test_cases[].test_run_results_count`
- `test_cases[].test_run_results_issues_count`

## `search_project_entities_by_filter`  _(observed on: preprod, prod)_
**declared, never returned:**
- `None in the strict sense — the declared 200 schema has NO properties at all for test_cases, folders, or filter_details (only `success` and `info`), so there is nothing declared to be missing. Worth flagging separately: comments_count, which v1 wrongly declares-and-omits, is also absent from every v2 row, but v2 simply never declares it, so this is not a contract violation for v2 the way it is for v1 — it's a symptom of the schema not describing the payload at all.`
- `None in the strict sense — the declared 200 schema on prod has NO properties for test_cases, folders, or filter_details (only success and info), identical to preprod. Nothing is declared, so nothing can be 'missing' from the declaration.`
**returned, never declared:**
- `filter_details — undeclared object, returned empty ({}) in every call made here`
- `filter_details — undeclared, returned empty ({}) in every successful call`
- `folders — entire object undeclared; object keyed by folder_id with each value wrapped in a 1-element array`
- `folders — the entire object is undeclared; behaviorally it repeats v1's bug pattern (object keyed by folder_id rather than an array) and adds a further undocumented wrinkle: each value is itself a 1-element array of the trimmed folder object, not the object directly`
- `test_cases[] — entire array and all ~40 row fields undeclared`
- `test_cases[] — the entire array and all ~40 row fields are undeclared, since the schema has no `test_cases` property whatsoever`
- `test_cases[].attachments[]`
- `test_cases[].attachments[], issues[], metadata, test_case_dataset, links`
- `test_cases[].automation_state`
- `test_cases[].automation_status, is_shared, is_automation, steps, test_case_steps, step_count`
- `test_cases[].case_type / priority / status / automation_state — full option objects with field_name, value_category, valueDetails[]`
- `test_cases[].case_type.value_category / valueDetails (also present on priority, status, automation_state)`
- `test_cases[].estimated_duration_seconds`
- `test_cases[].is_shared`
- `test_cases[].step_count`
- `test_cases[].template_id / template_name / template_step_type`
- `test_cases[].test_case_dataset`
- `test_cases[].test_run_results_count`
- `test_cases[].test_run_results_issues_count`

## `search_project_users`  _(observed on: preprod, prod)_
**returned, never declared:**
- `email`
- `is_re_arch_enabled`
- `is_test_plan_detailed_report_enabled`

## `update_custom_field_dataset_project_mapping`  _(observed on: preprod)_
**declared, never returned:**
- `data.options — declared type 'array' (items: object); every live response (all 4 calls) returned it as an OBJECT {data:[...3 rows...], info:{page,page_size,count,prev,next}}, never a bare array. Same drift previously confirmed on get_custom_field_dataset's contract — this write endpoint's re-read has the identical shape bug.`
**returned, never declared:**
- `data.created_at`
- `data.custom_field_id`
- `data.datasetProjects — a second, differently-named copy of the exact same content as the declared data.linked_projects (confirmed identical project rows in both keys on every call in this probe, matching the parent create_custom_field_dataset probe's finding)`
- `data.future_projects_applicable — tracks link_to_future_projects (0/1), not declared anywhere in this capability's schema`
- `data.group_id`
- `data.options.info — undeclared pagination envelope around options.data`
- `data.record_status`
- `each options row's extra fields beyond a generic object: group_id, project_id, custom_field_id, dataset_id, record_status, created_at, updated_at`

## `update_custom_field_definition`  _(observed on: preprod)_
**declared, never returned:**
- `default_value`
- `place_holder_text`
**returned, never declared:**
- `group_id`
- `is_bulk_editable`
- `is_filterable`
- `parent_custom_field_id`
- `system_name`

## `update_dataset`  _(observed on: preprod)_
**declared, never returned:**
- `dataset.created_by.browserstack_user_id (declared on the created_by sub-schema, absent in the live response)`
- `dataset.created_by.group_id (declared on the created_by sub-schema, absent in the live response)`
**returned, never declared:**
- `dataset.created_by.role (present in the live response — value 'owner' — not part of the declared created_by schema)`

## `update_exploratory_session`  _(observed on: preprod)_
**declared, never returned:**
- `/exploratory_session/folder_id`
**returned, never declared:**
- `attachment_relations`
- `attachments`
- `closed_at`
- `custom_fields`
- `group_id`
- `identifier`
- `owner`
- `project_id`
- `record_status`
- `test_plan_id`

## `update_exploratory_session_log`  _(observed on: preprod)_
**declared, never returned:**
- ` `
- `'`
- `(`
- `)`
- `,`
- `-`
- `.`
- `0`
- `2`
- `:`
- `C`
- `S`
- `_`
- ```
- `a`
- `b`
- `c`
- `d`
- `e`
- `f`
- `g`
- `h`
- `i`
- `k`
- `l`
- `m`
- `n`
- `o`
- `p`
- `r`
- `s`
- `t`
- `u`
- `v`
- `w`
- `x`
- `y`
- `—`
**returned, never declared:**
- `session_log.attachment_relations ([]) — present in the `returns` summary list but ABSENT from the expanded 200 schema's `properties` object; the live response sides with the returns summary (the field is present), so the two declared sources disagree with each other and the response resolves that disagreement in favor of the summary, not the properties block.`
- `session_log.defects[].created_at — same, undeclared on the defects item schema`
- `session_log.defects[].id (849732) — declared defects item schema only requires/declares {issue_id, issue_type}`
- `session_log.group_id (3452) — same, undeclared anywhere`
- `session_log.project_id (379335744) — not in the 200 schema's properties nor in the returns summary`

## `update_filter`  _(observed on: preprod)_
**declared, never returned:**
- `data.owner`
**returned, never declared:**
- `data.group_id`
- `data.owner_id`
- `data.record_status`

## `update_report`  _(observed on: preprod)_
**declared, never returned:**
- `data.mail_to`
**returned, never declared:**
- `data.grain`
- `data.included_projects`
- `data.is_dynamic`
- `data.project_ids`
- `data.slack_notification`
- `data.slack_notification_supported`
- `data.updated_at`

## `update_shared_step`  _(observed on: preprod)_
**returned, never declared:**
- `data.step_count — returned (1) but not in the declared 200 schema's `data` properties.`
- `data.tags — returned on every response, absent from the declared 200 response schema's `data` properties (title, id, created_by, updated_by, shared_step_details only). Same drift the create probe found, now confirmed present on the update path too.`
- `data.test_case_count — returned (0) but not in the declared 200 schema's `data` properties.`

## `update_test_plan_by_integer_id`  _(observed on: preprod)_
**declared, never returned:**
- `test_plan.reviewers — listed in the capability's `returns` array but entirely absent (not even null) from the actual 200 body`
**returned, never declared:**
- `test_plan.test_plan_progress`
- `test_plan.test_results_trend`
- `test_plan.test_results_trend_v2`

---

# Why half of these need live probing — measured, not asserted

teststack-e6 parsed the declared-and-absent entries above and ran each against the static
returns-vs-schema check:

| | count |
| --- | --- |
| the static check **would** flag it — the schema does not back it either | **98** |
| the static check **cannot see it** — the schema declares it too; only the API disagrees | **105** |

So a build-time gate retires roughly **half** the declared-and-absent set for free. The other
half is the irreducible case for invoking the thing.

**`assign_test_run_owner.skipped_test_case_ids` is the clean example.** The 200 description
explicitly promises the key is added to the write envelope. The schema agrees. It is absent from
both write responses. Index and spec are consistent with each other and both wrong about
reality — no amount of static checking reaches it.

**And the 105 are the more dangerous half.** A field backed by the schema reads as
authoritative, so a caller has more reason to trust it, not less.

The two checks are complementary and neither subsumes the other:

- **static** — does the index agree with the spec?
- **live probe** — does the spec agree with reality?

## A related distinction worth keeping separate

A **type mismatch** is not the same failure as an absent field, and should not be batched with
them. `rename_folder_by_integer_id`'s `group_id` is declared integer and returns the string `"3452"` — a
caller comparing or indexing by it fails **silently at the caller**, rather than reading
`undefined` and noticing. Absent fields announce themselves; wrong types do not.
