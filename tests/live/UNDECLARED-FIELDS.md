# Undeclared fields — what the API returns that the index never declares

**73 capabilities · 562 field entries.**

Not 562 distinct fields. A small set recurs across many capabilities, which points at shared
serializers emitting things the contract never mentions. Fixing the shared descriptor fixes
many capabilities at once.

## Recurring across 4+ capabilities — fix these first

| field | capabilities |
| --- | --- |
| `group_id` | **13** |
| `attachments` | **12** |
| `test_run_results_issues_count` | **11** |
| `is_shared` | **10** |
| `template_step_type` | **9** |
| `template_name` | **9** |
| `` | **8** |
| `record_status` | **8** |
| `template_id` | **8** |
| `test_case_dataset` | **8** |
| `automation_state` | **8** |
| `test_run_results_count` | **8** |
| `estimated_duration_seconds` | **8** |
| `folders` | **8** |
| `value_category` | **7** |
| `created_by` | **7** |
| `updated_by` | **7** |
| `reviewers` | **6** |
| `review_status` | **6** |
| `step_count` | **6** |
| `owner` | **5** |
| `custom_fields` | **5** |
| `closed_at` | **5** |
| `project_id` | **4** |
| `created_at` | **4** |
| `tags` | **4** |
| `test_case_id` | **4** |

## Per capability

### `get_test_case_by_integer_id` — 46 undeclared
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

### `get_test_case_detail` — 29 undeclared
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

### `list_folder_test_cases` — 29 undeclared
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

### `search_project_entities` — 24 undeclared
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

### `list_test_cases` — 23 undeclared
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

### `create_root_folder` — 22 undeclared
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

### `list_test_runs_selection` — 20 undeclared
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

### `search_project_entities_by_filter` — 19 undeclared
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

### `list_test_run_test_cases_by_integer_id` — 15 undeclared
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

### `list_projects` — 15 undeclared
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

### `list_test_plan_test_runs_by_integer_id` — 14 undeclared
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

### `bulk_edit_test_cases_in_test_run` — 12 undeclared
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

### `get_system_field_values` — 10 undeclared
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

### `bulk_replace_test_case_fields` — 10 undeclared
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

### `create_exploratory_session` — 10 undeclared
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

### `update_exploratory_session` — 10 undeclared
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

### `clone_exploratory_session` — 10 undeclared
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

### `get_project_form_fields` — 9 undeclared
- `default_fields.*.values[] entirely undocumented shape beyond the prose '{values, total_count}' -- actual per-option rows carry internal_name, is_default, value, name (and conditionally value_category / colour)`
- `default_fields.*.values[].internal_name / is_default / value / name — whole option-row shape is undocumented at the schema level for default_fields`
- `default_fields.<dataset-backed field>.links.self (undeclared)`
- `default_fields.automation_state.values[].value_category (undeclared)`
- `default_fields.automation_state.values[].value_category — not declared anywhere (default_fields has no item-level schema at all, only prose '{values, total_count}')`
- `default_fields.status.values[].colour (undeclared, and inconsistently present)`
- `default_fields.status.values[].colour — same, undeclared`
- `system_fields returned as an OBJECT {description_fields, property_fields, others} instead of the declared bare ARRAY of {id, field_name, field_type, system_name, is_removable} rows — structural container mismatch (DRIFT)`
- `system_fields: declared type is a bare ARRAY of {id, field_name, field_type, system_name, is_removable}; actual response returns an OBJECT {description_fields: [...], property_fields: [...], others: []} -- a top-level type mismatch, not just an undeclared field`

### `list_entity_filter_details` — 9 undeclared
- `automation_status, created_at, updated_at, custom_fields -- returned as null/{} in the body even though none of q[automation_status]/q[created_at]/q[updated_at]/q[custom_fields] were sent. This directly contradicts the capability's own guidance ('It returns only the keys you actually passed under q... Keys absent from the request are absent here') and the 200 description ('only the keys you supplied under q are present; an empty q yields filter_details:{}'). Every unrequested filter key is present anyway (just empty/null), not absent.`
- `automation_status: null, created_at: null, updated_at: null, custom_fields: {} — all four returned even though NONE were requested in q[...], contradicting the capability's own guidance ('It returns only the keys you actually passed under q ... send nothing and you get {success:true, filter_details:{}}'). Reproduces preprod finding (4) exactly.`
- `entity_type -- present on every priority/status/case_type item, not in the declared schema for that shared shape.`
- `entity_type — present on every priority/status/case_type item ({"entity_type":"TestCase", ...}); not in the declared item schema. Reproduces preprod finding (2) exactly.`
- `folders top-level: select_all_parent_ids, partial_selected_parent_ids, only_selected_parent_ids, only_child_selected_parent_ids — 4 undeclared keys, exactly as preprod found.`
- `folders.folder_tree[] and folders.folders[] items -- actual shape is {id, parent_id, sub_folders_count, name, folder_path, selected_all, ancestors, contents(tree only)}; the declared schema instead specifies {id, project_id, group_id, name, is_automation, sub_folders_count, links.self, cases_count, total_cases_count}. None of project_id/group_id/is_automation/links/cases_count/total_cases_count appeared, and none of parent_id/folder_path/selected_all/ancestors/contents are declared. This is not a couple of extra fields -- it is a different folder-row shape entirely.`
- `folders.folder_tree[] items shaped {id,parent_id,sub_folders_count,name,folder_path,selected_all,ancestors,project_id,contents} — totally different from the declared {id,project_id,group_id,name,is_automation,sub_folders_count,links,cases_count,total_cases_count}. Reproduces preprod finding (3): only id/sub_folders_count/name/project_id survive from the declared shape; group_id, is_automation, links, cases_count, total_cases_count are declared-but-absent, while parent_id, folder_path, selected_all, ancestors, contents are undeclared-but-present.`
- `folders.folders[] (flat list) same structural mismatch as folder_tree, minus the 'contents' key.`
- `folders.select_all_parent_ids, folders.partial_selected_parent_ids, folders.only_selected_parent_ids, folders.only_child_selected_parent_ids -- four top-level keys under filter_details.folders with no mention anywhere in the declared schema.`

### `create_step_result` — 9 undeclared
- `test_run_step_result.btcer_id`
- `test_run_step_result.colour`
- `test_run_step_result.field_value`
- `test_run_step_result.id`
- `test_run_step_result.is_latest`
- `test_run_step_result.record_status`
- `test_run_step_result.status_id`
- `test_run_step_result.step_mapping_id`
- `test_run_step_result.total_step_result_count`

### `edit_test_case` — 9 undeclared
- `data.test_case.automation_state`
- `data.test_case.case_type.value_category / priority.value_category / status.value_category / automation_state.value_category`
- `data.test_case.is_shared`
- `data.test_case.template_id`
- `data.test_case.template_name`
- `data.test_case.template_step_type`
- `data.test_case.test_case_dataset`
- `data.test_case.test_run_results_count`
- `data.test_case.test_run_results_issues_count`

### `list_test_plans_by_integer_id` — 8 undeclared
- `test_plans[].attachments`
- `test_plans[].completed_by`
- `test_plans[].review_settings`
- `test_plans[].review_status`
- `test_plans[].test_plan_progress`
- `test_plans[].test_plan_progress (always {}, separate from the declared test_plan_progress_v2)`
- `test_plans[].test_results_trend`
- `test_plans[].test_results_trend_v2`

### `assign_test_run_owner` — 8 undeclared
- `data.testrun.attachments`
- `data.testrun.closed_at`
- `data.testrun.closed_by`
- `data.testrun.created_by`
- `data.testrun.issues`
- `data.testrun.observability_id`
- `data.testrun.test_result_issues`
- `data.testrun.updated_by`

### `edit_test_run` — 8 undeclared
- `attachments`
- `closed_at`
- `closed_by`
- `created_by`
- `issues`
- `observability_id`
- `test_result_issues`
- `updated_by`

### `update_custom_field_dataset_project_mapping` — 8 undeclared
- `data.created_at`
- `data.custom_field_id`
- `data.datasetProjects — a second, differently-named copy of the exact same content as the declared data.linked_projects (confirmed identical project rows in both keys on every call in this probe, matching the parent create_custom_field_dataset probe's finding)`
- `data.future_projects_applicable — tracks link_to_future_projects (0/1), not declared anywhere in this capability's schema`
- `data.group_id`
- `data.options.info — undeclared pagination envelope around options.data`
- `data.record_status`
- `each options row's extra fields beyond a generic object: group_id, project_id, custom_field_id, dataset_id, record_status, created_at, updated_at`

### `get_custom_field_dataset` — 8 undeclared
- `data.created_at`
- `data.custom_field_id`
- `data.datasetProjects (duplicates data.linked_projects' project entries under a differently-shaped, undeclared key)`
- `data.future_projects_applicable`
- `data.group_id`
- `data.options.info (page/page_size/count/prev/next — an undocumented pagination block for the options list; the contract's guidance only calls out missing pagination info for linked_projects, never mentions options has its own paging)`
- `data.record_status`
- `each options row's extra fields beyond a generic object: group_id, project_id, custom_field_id, dataset_id, record_status, created_at, updated_at`

### `list_test_runs_by_integer_id` — 8 undeclared
- `test_runs[].assignee.email — the declared assignee object lists only {id, browserstack_user_id, full_name, group_id, onboarded}; actual assignee objects (e.g. TR-9075, TR-9091, TR-9089) additionally carry an `email` string`
- `test_runs[].attachments (null in all 30 rows)`
- `test_runs[].build_meta (object: id, name, creationType, buildNormalisedName, build_number) — not in the declared schema or the capability's `returns` list`
- `test_runs[].closed_at (null in all 30 rows)`
- `test_runs[].closed_by (null in all 30 rows)`
- `test_runs[].created_by (null in all 30 rows)`
- `test_runs[].observability_id (string, duplicates the numeric part of observability_url; also equals `uuid` numerically, e.g. TR-9075: uuid=17576237, observability_id="17576237")`
- `test_runs[].updated_by (null in all 30 rows)`

### `get_test_runs_form_fields` — 7 undeclared
- `custom_fields[].field_type values ('field_multi_dropdown', 'field_string') — do not match ANY value in the declared enum (string, text, user, dropdown, multi_dropdown, url, boolean, int, date); every field_type observed carries an undeclared 'field_' prefix not in the declared enum`
- `custom_fields[].field_user_name, optional, is_bulk_editable, is_filterable, links — all undeclared, present on every custom field row`
- `custom_fields[].field_values[] — undeclared key, present on every row (empty for dropdown types, populated with literal values for the string-type field)`
- `custom_fields[].id — declared type 'string', actual type is integer (e.g. 193254, not "193254")`
- `custom_fields[].option_values[] — undeclared key entirely replacing the declared 'options' key, with an undeclared per-option shape: {id, option_value, is_default, record_status, created_at, updated_at, dataset_id}`
- `default_fields.status.values[].value_category — not in the declared item schema (required: internal_name, is_default, colour, value, name); present on 7 of 8 rows (passed, failed, blocked, retest, skipped, in_progress, unknown all carry value_category:'completed') and ABSENT on the 8th ('untested', the is_default:1 row) — looks like a real semantic marker (terminal/completed vs. the default open state) that the schema simply never documented, not noise.`
- `default_fields.status.values[].value_category — still undeclared (as on preprod); present on 29 of 30 rows, absent only on 'untested'`

### `update_report` — 7 undeclared
- `data.grain`
- `data.included_projects`
- `data.is_dynamic`
- `data.project_ids`
- `data.slack_notification`
- `data.slack_notification_supported`
- `data.updated_at`

### `create_report_by_integer_id` — 7 undeclared
- `data.grain`
- `data.included_projects`
- `data.is_dynamic`
- `data.project_ids`
- `data.slack_notification`
- `data.slack_notification_supported`
- `data.updated_at`

### `create_bulk_test_cases` — 7 undeclared
- `path_folders[].identifier/created_at/updated_at/deleted/parent_id/source/entity_type/notes`
- `test_cases[].automation_state (full option object; automation_status is separately declared and also present)`
- `test_cases[].case_type.value_category / .priority.value_category / .status.value_category`
- `test_cases[].folder (full nested folder summary object, entirely undeclared per-item)`
- `test_cases[].is_shared, .test_case_dataset, .test_run_results_count, .test_run_results_issues_count`
- `test_cases[].template_step_type, .template_id, .template_name`
- `test_cases[].test_case_steps[].record_status / .group_id / .test_case_id`

### `get_report_detail` — 6 undeclared
- `data.updated_at, data.project_ids, data.included_projects, data.is_dynamic, data.grain, data.slack_notification, data.slack_notification_supported — the SAME 7 fields flagged in the preprod create_report_by_integer_id/update_report finding as evidence of one shared serializer. Confirmed present, byte-for-byte the same field set, on get_report_detail's read response too. This extends the shared-serializer drift from the write path to this read capability.`
- `is_dynamic, filters — present on every call (bare, is_print, drilldown); listed in the capability's own `returns` summary array but absent from the formal 200 response JSON-schema `properties` block (prose-vs-schema disagreement, not a runtime defect)`
- `is_dynamic, filters — top-level keys present on every call; listed in this capability's own `returns` summary array but absent from the formal 200 JSON-schema `properties` block (same prose-vs-schema gap noted on preprod).`
- `report_data.rows, report_data.total, report_data.info — when a *_drilldown section is requested, report_data is wholly replaced by this paginated-rows shape ({rows:[...], total:30, info:{page,page_size}}); this replacement shape is not present in the schema's report_data definition at all, which is fixed to the 7 aggregate fields with no oneOf/alternate for drilldown mode`
- `report_data.time_tracking_enabled — present only with is_print/sections, not declared anywhere in the schema (same as preprod).`
- `report_data.time_tracking_enabled — present with is_print/sections, not declared anywhere in this capability's schema (time_tracking and estimated_vs_actual ARE declared as valid section names but time_tracking_enabled is not documented at all)`

### `get_test_run_detail` — 6 undeclared
- `assignee_imported`
- `build_normalised_name`
- `build_serial_id`
- `environment`
- `is_read_from_tra_enabled`
- `tc_sharing_enabled`

### `create_test_cases` — 6 undeclared
- `folder.notes, path_folders[].notes/identifier/created_at/updated_at/deleted/parent_id/source/entity_type`
- `test_case.automation_state (full option object; automation_status is separately declared and also present)`
- `test_case.case_type.value_category / test_case.priority.value_category / test_case.status.value_category`
- `test_case.is_shared, test_case.test_case_dataset, test_case.test_run_results_count, test_case.test_run_results_issues_count, test_case.comments_count`
- `test_case.template_step_type, test_case.template_id, test_case.template_name`
- `test_case.test_case_steps[].record_status / .group_id / .test_case_id`

### `create_custom_field_dataset` — 6 undeclared
- `data.created_at`
- `data.custom_field_id`
- `data.datasetProjects — a second, differently-named copy of the same content as linked_projects (both empty here since no projects were linked; on the sibling dataset 31319 both datasetProjects and linked_projects independently carry the identical single PR-2005 row)`
- `data.future_projects_applicable`
- `data.group_id`
- `data.record_status`

### `create_test_case_by_integer_id` — 6 undeclared
- `folder.notes, path_folders[].notes/identifier/created_at/updated_at/deleted/parent_id/source/entity_type`
- `test_case.automation_state (full option object; automation_status is separately declared and also present)`
- `test_case.case_type.value_category / test_case.priority.value_category / test_case.status.value_category`
- `test_case.is_shared, test_case.test_case_dataset, test_case.test_run_results_count, test_case.test_run_results_issues_count`
- `test_case.template_step_type, test_case.template_id, test_case.template_name`
- `test_case.test_case_steps[].record_status / .group_id / .test_case_id`

### `get_exploratory_session` — 5 undeclared
- `attachment_relations`
- `group_id`
- `owner`
- `project_id`
- `record_status`

### `create_exploratory_session_log` — 5 undeclared
- `session_log.attachment_relations — present in the `returns` summary list but ABSENT from the fully-expanded 201 schema's `properties` object (schema/returns-summary internal inconsistency, not a live-vs-declared drift, but worth noting since it means the schema block alone under-documents the response)`
- `session_log.defects[].created_at — same, undeclared on the defects item schema`
- `session_log.defects[].id (e.g. 849732) — declared defects item schema only requires/declares {issue_id, issue_type}`
- `session_log.group_id (e.g. 3452) — same, undeclared anywhere`
- `session_log.project_id (e.g. 379335744) — not in the 201 schema's `properties` nor in the `returns` summary`

### `bulk_edit_test_cases` — 5 undeclared
- `filter_details`
- `folders`
- `info`
- `test_cases`
- `workflow`

### `create_test_run_by_integer_id` — 5 undeclared
- `attachments`
- `closed_at`
- `closed_by`
- `created_by`
- `updated_by`

### `update_custom_field_definition` — 5 undeclared
- `group_id`
- `is_bulk_editable`
- `is_filterable`
- `parent_custom_field_id`
- `system_name`

### `create_custom_field_definition` — 5 undeclared
- `data.group_id`
- `data.is_bulk_editable`
- `data.is_filterable`
- `data.parent_custom_field_id`
- `data.system_name`

### `update_exploratory_session_log` — 5 undeclared
- `session_log.attachment_relations ([]) — present in the `returns` summary list but ABSENT from the expanded 200 schema's `properties` object; the live response sides with the returns summary (the field is present), so the two declared sources disagree with each other and the response resolves that disagreement in favor of the summary, not the properties block.`
- `session_log.defects[].created_at — same, undeclared on the defects item schema`
- `session_log.defects[].id (849732) — declared defects item schema only requires/declares {issue_id, issue_type}`
- `session_log.group_id (3452) — same, undeclared anywhere`
- `session_log.project_id (379335744) — not in the 200 schema's properties nor in the returns summary`

### `create_sub_folder` — 5 undeclared
- `data.folder.attachments`
- `data.folder.created_by`
- `data.folder.parent_id`
- `data.folder.root`
- `data.folder.updated_by`

### `get_test_plan_by_integer_id` — 4 undeclared
- `test_plan.test_plan_progress`
- `test_plan.test_plan_progress (always {})`
- `test_plan.test_results_trend`
- `test_plan.test_results_trend (null)`

### `get_test_plan_execution_trend` — 4 undeclared
- `data (per-series array of [date_string, count_int] positional pairs)`
- `data (per-series array of [date_string, count_int] positional pairs, undocumented)`
- `name (series label, e.g. "Untested"/"Failed" — a result-status name, undocumented)`
- `name (series label, e.g. 'Untested' — a result-status name, not documented anywhere in the schema)`

### `search_project_users` — 3 undeclared
- `email`
- `is_re_arch_enabled`
- `is_test_plan_detailed_report_enabled`

### `update_filter` — 3 undeclared
- `data.group_id`
- `data.owner_id`
- `data.record_status`

### `bulk_move_test_cases` — 3 undeclared
- `destination_path_folders[] items also carry notes, identifier, created_at, updated_at, deleted, source, entity_type - none declared in the schema (which only lists id/project_id/group_id/name/is_automation/sub_folders_count/links/cases_count/total_cases_count); conversely the declared links field was absent from every destination_path_folders item actually returned.`
- `destination_path_folders[].group_id is a quoted STRING ("3452") in the live response; the declared schema types it as an integer. Every other id-shaped field on the same objects (id, project_id, parent_id) came back as a plain JSON integer, and no id/parent_id-as-string was reproduced here (matching the campaign's prior non-reproduction on create_sub_folder) - the drift is narrowly on group_id.`
- `folders — a top-level breadcrumb map (folder id -> ancestor-chain array) not in the declared response shape at all. Present on every synchronous 200.`

### `create_filter` — 3 undeclared
- `data.group_id`
- `data.owner_id`
- `data.record_status`

### `update_shared_step` — 3 undeclared
- `data.step_count — returned (1) but not in the declared 200 schema's `data` properties.`
- `data.tags — returned on every response, absent from the declared 200 response schema's `data` properties (title, id, created_by, updated_by, shared_step_details only). Same drift the create probe found, now confirmed present on the update path too.`
- `data.test_case_count — returned (0) but not in the declared 200 schema's `data` properties.`

### `update_test_plan_by_integer_id` — 3 undeclared
- `test_plan.test_plan_progress`
- `test_plan.test_results_trend`
- `test_plan.test_results_trend_v2`

### `close_test_run` — 3 undeclared
- `attachments`
- `created_by`
- `updated_by`

### `move_folder_by_integer_id` — 3 undeclared
- `data.unique_id was absent on this synchronous, same-project move. This matches the capability's own guidance (unique_id is described as the async-path artifact) so it is NOT treated as drift, just recorded for completeness.`
- `group_id came back as a quoted STRING ("3452") everywhere it appeared in this response - data.folder.group_id, source_path_folders[0].group_id, and destination_path_folders[0].group_id - against the declared integer type. Every other id-shaped field (id, project_id, parent_id) was a plain JSON integer in the same objects; the drift is narrowly on group_id.`
- `source_path_folders[] and destination_path_folders[] items also carry notes, identifier, created_at, updated_at, deleted, parent_id, source, entity_type - none declared in the schema (which lists only id/project_id/group_id/name/is_automation/sub_folders_count/links/cases_count/total_cases_count).`

### `list_test_case_histories` — 2 undeclared
- `histories[].origin_channel`
- `origin_channel`

### `get_test_case_history` — 2 undeclared
- `history.origin_channel`
- `history.origin_channel (present as "api" in the live response; not part of the declared history schema)`

### `list_folder_contents` — 2 undeclared
- `On the nested_sub_folders=true path, self.contents is still populated recursively even though the capability's own guidance says nested mode strips self.contents.`
- `self.contents[].group_id is returned as a JSON string ("2") though the declared schema types group_id as integer for every item shape in this response, including self.contents[] items (same schema block reused).`

### `get_dataset` — 2 undeclared
- `created_by.role (undeclared, present on every dataset checked, values observed: 'user', 'admin')`
- `dataset.created_by.role (present in the live response, not part of the declared created_by schema)`

### `list_root_folders` — 2 undeclared
- `folders[].notes`
- `notes (present on live folder rows; absent from the declared 200 JSON schema's folders[] item properties, though present in the capability's separate prose `returns` list)`

### `search_group_tags` — 2 undeclared
- `tags[].id — the declared 200 schema types `tags` as a plain array of strings ('Simple array of tag names (for backward compatibility)'); every live response instead returned `tags` as an array of {id, name} objects, on both entity_type values, at every page sampled including the very first (p=1) and very last (p=357) real pages.`
- `tags[].id — the declared 200 schema types `tags` as a plain array of strings ('Simple array of tag names (for backward compatibility)'); every live response instead returned `tags` as an array of {id, name} objects. Both the formal schema and its own prose are wrong about this field's shape.`

### `get_report_section` — 2 undeclared
- `The declared 200 schema is the literal empty object {"type":"object"} — no properties at all, so every key returned (test_run_data, issues_data, test_run_status, test_cases_status, user_result_stats, issues_by_status, issues_by_priority, time_tracking, estimated_vs_actual and all nested fields) is technically undeclared. Same unfalsifiable-schema condition already recorded on preprod.`
- `The entire response body is undeclared: describeCapability's 200 schema is the literal empty object {"type":"object"} — no properties are declared at all, so every key returned (test_run_data, issues_data, test_run_status, test_cases_status, user_result_stats, issues_by_status, issues_by_priority, time_tracking, estimated_vs_actual, and all nested fields) is technically undeclared.`

### `get_projects_minify` — 2 undeclared
- `access_via_secondary_team`
- `projects[].access_via_secondary_team`

### `list_test_results_for_test_case_by_integer_id` — 2 undeclared
- `info.truncated`
- `test-results[].updated_by`

### `rename_folder_by_integer_id` — 2 undeclared
- `data.folder.group_id (declared type integer in the 200 schema; returned as the JSON string "3452" instead of a number)`
- `data.folder.notes`

### `reorder_test_cases_by_folder` — 2 undeclared
- `error envelope shape: declared 400/404/500 all say {success:false, error:{code,message,details}}; every actual error in this probe was {errors:"<plain string>"} — no success key, no error object, no code. (The capability's own guidance text already flags this pattern in prose; this probe reconfirms it against the ACTUAL declared JSON schema, which still shows the generic envelope and was never corrected to match.)`
- `test_cases[].automation_state, .is_shared, .estimated_duration_seconds, .template_id, .template_name, .template_step_type, .step_count, .test_run_results_count, .test_run_results_issues_count, .test_case_dataset — present on every row, none declared`

### `get_custom_field_values` — 1 undeclared
- `values[].id, group_id, project_id, custom_field_id, dataset_id, option_value, is_default, parent_option_id, record_status, created_at, updated_at -- ALL undeclared, since the capability's own schema types `values[]` items as a bare `object` with no listed properties. Not a contract violation (nothing was promised to be absent), but confirms the item shape was genuinely unspecified until this probe.`

### `create_shared_step` — 1 undeclared
- `data.tags`

### `list_workspace_fields` — 1 undeclared
- `info.prev, info.next — present whenever the result spans more than one page, or even on a legitimate zero-count query (entity_type=TestPlan); absent (replaced by total_pages) only in the single-page case. Neither key is in the declared `info` schema nor in the capability's `returns` list.`

### `create_test_result_for_test_case` — 1 undeclared
- `response.data.test-result.updated_by (not in the declared 201 schema's test-result properties)`

### `bulk_copy_test_cases` — 1 undeclared
- `folders`

### `update_dataset` — 1 undeclared
- `dataset.created_by.role (present in the live response — value 'owner' — not part of the declared created_by schema)`

### `create_dataset` — 1 undeclared
- `dataset.created_by.role (present in the live response — value 'owner' — not part of the declared created_by schema)`

### `bulk_restore_archived_test_cases` — 1 undeclared
- `HTTP 404 {success:false} with an empty body (no error object, no message) — not one of the five declared response codes (200/400/401/403/422/500). This is the status a selection containing even one nonexistent id returns; it is NOT the documented bare-400 'empty selection' case (the selection was non-empty and 4/5 ids were valid), so it is a genuinely undeclared failure mode, not an instance of an existing one.`
