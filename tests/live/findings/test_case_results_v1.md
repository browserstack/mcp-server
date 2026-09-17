# test_case_results_v1 — BLOCKED

- **Product / entity:** tm / `issue` (read)
- **Path:** `GET /api/v1/integrations/{issue_type}/test-case/results/{test_case_id}`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-17
- **Run file:** `tests/live/runs/tm/test_case_results_v1.json`

## Declared contract

Required path params:

| param | type | notes |
| --- | --- | --- |
| `issue_type` | string, closed enum | `jira-app, azure, asana, linear, clickup, confluence, figma, devrev, gitlab, github, custom, trello`. Non-enum values 404 at the router. |
| `test_case_id` | **integer** | Not the `TC-NNN` identifier. |

Optional query: `p`, `per_page`.

Declared 200 (`json_path: data.test_case`):

```json
{ "data": { "success": true, "test_case": { "...": "issues, test_run_results, test_run_results_count, test_run_results_issues_count, full case body" } } }
```

The capability also declares 400/401/403/404/500 error shapes, **all** of the form `{ success: false, error: { code, message } }`.

## Actual behaviour

Every attempt returned an identical, bare:

```json
{"status":500,"error":"Internal Server Error"}
```

| # | `issue_type` | `test_case_id` | query | result |
| --- | --- | --- | --- | --- |
| 1 | `jira-app` | `1971631` | `p=1, per_page=10` | 500 |
| 2 | `jira-app` | `1971631` | *(none)* | 500 |
| 3 | `custom` | `1971631` | *(none)* | 500 |

## Why this is not a payload mistake

This is the failure mode the probe instructions specifically warn about mistaking, so the id provenance matters:

- **`test_case_id` was resolved, not invented.** `list_folder_test_cases_v1` (project `379335744`, `__readonly__` folder `764093`) mapped fixture case `TC-54455` → integer `1971631`. It is a real case in the fixture project.
- **Both path params conform to the declared contract** — `issue_type` from the closed enum, `test_case_id` as the required integer.
- **Both dimensions the contract exposes were varied** (tracker type, presence of pagination params) with no change in outcome.
- **`issue_type: custom` also fails.** `custom` requires no external app connection, so the 500 is not explained by a missing Jira integration alone.
- **The 500 does not match the capability's own declared error schema.** A handled "not configured" condition should return `{success: false, error: {code, message}}`; this is a bare transport-level 500 with no application error body, which reads as an unhandled exception rather than a deliberate response.

## Independent corroboration from a second probe

The `unlink_test_case_v1` probe, running separately later in the same batch, tried `test_case_results_v1` as its preferred way to read a case's linked issues. It hit the **same HTTP 500** — and notably against **two different cases**:

- `1972036` (TC-54457, a freshly created case in `__scratch__`)
- `1971631` (TC-54455, the `__readonly__` fixture case)

with and without pagination params. It fell back to `list_folder_test_cases_v1` for all verification instead.

This matters because it **rules out a case-specific cause**. The failure is not tied to one record, to record age, or to which folder the case lives in. Two independent agents, three distinct cases, two `issue_type` values, with and without query params — always the same bare 500.

## What this evidence cannot settle

Two explanations remain open, and this run **cannot** distinguish them:

1. The account has no external-tracker integration for any `issue_type`, and the handler **crashes** while resolving one instead of returning a graceful empty/"not configured" result.
2. The endpoint is broken outright, independent of tracker configuration.

Either way the capability cannot be invoked as documented. Under (1) the index is still arguably wrong — nothing in the guidance warns that an account without a tracker gets a 500 rather than an empty result, which is exactly what an agent would need to know.

**Not yet checked:** backend source or server-side logs. No file/line evidence was gathered, so "the API is broken" is offered as one of two hypotheses, not a conclusion. The remaining 10 `issue_type` values were not tried (3-attempt cap); given `jira-app` and `custom` failed identically there is no evidence-based reason to expect another to differ.

## Suggested next step for the product team

Server-side logs for `GET /api/v1/integrations/custom/test-case/results/1971631` on preprod at the probe timestamp would separate the two hypotheses immediately — a stack trace in the tracker-resolution path confirms (1), anything else points at (2).

## Index action

**None yet — do not edit the index on this evidence.** If (1) is confirmed, the fix is guidance describing the no-integration behaviour, plus a corrected error contract. If (2), this is a product bug and the index is innocent.
