# edit_project — DRIFT

- **Product / entity:** tm / `project` (write)
- **Path:** `POST /api/v1/projects/{project_id}/edit`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-17
- **Run file:** `tests/live/runs/tm/edit_project.json`

> **Verdict re-classified by the orchestrator** from the probing subagent's `PASS` to `DRIFT`. The subagent's evidence is accepted unchanged; only the label is corrected. Reasoning in "Why DRIFT" below.

## Summary

**The write works correctly.** It is a genuine partial patch, the edit took effect, and it was verified and reverted. The drift is in the **declared 200 response**: three fields the contract promises never arrive — and the guidance tells the agent to read one of them back to confirm the change took.

## Declared contract

- **Path param:** `project_id` — must be the **integer** id. The spec is explicit: "the numeric `id`, not the PR-NNN identifier."
- **Body:** `name`, `description`, `access_type`, `users`, each declared under a `project` wrapper (`json_path: /project/{field}`), and **all individually optional**. Guidance: "Send at least one of name, description or access_type… omit to keep the current [value]." An empty body is documented as a 400.
- **200 envelope:** `data.success` + `data.project{…}`, with `access_type`, `user_role` and `permissions` among the declared returns.

## What the contract gets right

- **The partial-patch semantics are accurate.** Sending only `description` left `name` completely untouched — confirmed by re-reading. This is not a full-object replace.
- **The `json_path` nesting is handled as declared.** Passing the fields as flat top-level keys to `invokeCapability` correctly produced the `/project/{field}` nesting server-side.
- **The edit genuinely persists.** Verified by an independent fresh read, not inferred from a 200.

## The drift — three declared fields never returned

Actual `probe.response_keys`:

```
name, identifier, id, thProjectId, description, created_at, import_id,
test_cases_count, test_runs_count, test_plans_count, links,
normalisedName, starred, jira_mapped, projectVisibilityBanner
```

| declared field | on this endpoint's 200 | on a plain `get_project_by_integer_id` read |
| --- | --- | --- |
| `access_type` | **absent** | **absent** |
| `user_role` | **absent** | **present** |
| `permissions` | **absent** | **present** |

## Why DRIFT rather than PASS

`contract.declared_missing` is non-empty, which is the definition of DRIFT ("invoked, but declared and actual disagree") rather than PASS ("the response carries what the contract declares").

The subagent proposed that the absences reflect an account-level condition — project-level access control likely disabled on this preprod account. **That explanation holds for `access_type`**, which is missing from a plain read too. **It does not hold for `user_role` and `permissions`**, which the same subagent observed as *present* on `get_project_by_integer_id` for this very project and *absent* here. That is an endpoint-specific gap independent of account configuration.

There is also a concrete agent-facing consequence, which is what lifts this above a cosmetic doc nit: the capability's **own guidance instructs the caller to "read `access_type` back from the response to confirm the change took."** That instruction cannot be followed — the key is never present. An agent doing exactly what the index tells it would conclude its own successful write had failed.

## Secondary observation — type inconsistency

`projectVisibilityBanner` came back as `null` on the edit response, but as an object `{is_visible:false, source:""}` on the very next plain read of the same, unchanged project. Same field, same project, two shapes depending on which endpoint answered. Minor, but it is the kind of thing that breaks a typed client.

## Fixture safety

The fixture project was left exactly as found, which matters because the whole suite depends on it:

1. Original `name` (`__mcp-capability-fixture__`) and `description` recorded **before** any mutation.
2. Only `description` was sent; `name` was never included, so it could not be altered — the seed script finds the fixture by name.
3. Change verified by fresh read, then the original description restored by a second `edit_project` call, then the restore independently confirmed by a third read.

## Index actions proposed

1. **Remove `access_type`, `user_role` and `permissions` from the declared 200**, or fix the endpoint to return them. For `user_role`/`permissions` the endpoint looks like the wrong side, since a plain read returns them.
2. **Fix the guidance sentence** telling callers to confirm the change by reading `access_type` back from the response. Until the field is actually returned, that advice is unfollowable — an alternative confirmation path (re-read the project) should be documented instead.
3. Consider normalising `projectVisibilityBanner` so it does not alternate between `null` and an object across endpoints.

**Worth checking on an account that has project-level access control enabled**, to separate the account-condition part (`access_type`) from the endpoint part (`user_role`, `permissions`) with certainty. This run could only establish the latter.
