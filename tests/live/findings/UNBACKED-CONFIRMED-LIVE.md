# Unbacked `returns` entries CONFIRMED present in a live response

Schema gaps, not over-claims: the field is real and the resolved 2xx schema does not
describe it. Evidence is the probe run for each capability, tests/live/runs/tm/<name>.json.

## list_custom_fields_v2  —  GET /api/v2/custom-fields
  - `placeholder`

## edit_project_v1  —  POST /api/v1/projects/{project_id}/edit
  - `import_id`
  - `normalisedName`
  - `projectVisibilityBanner`

## get_exploratory_session_form_fields  —  GET /api/v1/projects/{project_id}/exploratory-sessions/form-fields
  - `custom_fields`
  - `default_fields`
  - `success`

## global_search_v1  —  GET /api/v1/global/search
  - `project`
  - `project_details`
  - `report`
  - `shared_step`
  - `test_case`
  - `test_plan`
  - `test_run`

## link_entities_to_jira_issue  —  POST /api/v1/integration/jira-app/jira-ticket/link-entities
  - `async`
  - `message`
  - `success`

## linked_test_cases_selection_v1  —  GET /api/v1/integrations/{issue_type}/test-cases/selection
  - `selection`
  - `success`

## list_tags_v3  —  GET /api/v1/projects/{project_id}/tags/v3
  - `info`
  - `tags`

## move_folder_v2  —  POST /api/v2/projects/{project_id}/folders/{folder_id}/move
  - `description`
  - `id`
  - `links`
  - `name`
  - `parent_id`
  - `urls`

## unlink_test_case_v1  —  POST /api/v1/integrations/{issue_type}/unlink-test-case
  - `recent_folder`
  - `recent_project`

