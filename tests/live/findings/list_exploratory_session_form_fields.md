# list_exploratory_session_form_fields — DRIFT

- **Product / entity:** tm / `exploratory_session` (read)
- **Path:** `GET /api/v1/projects/{project_id}/exploratory-sessions/form-fields`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — 3 attempts plus 5 confirmation calls
- **Run file:** `tests/live/runs/tm/list_exploratory_session_form_fields.json`

## Summary

**The capability's single optional query parameter breaks it.** `values=true` — the documented way to get each field's configured choices, and the whole point of calling this endpoint before writing a session — returns **404 every time**. Only `values=false` or omitting it entirely returns 200.

An agent that follows the contract's own guidance literally gets a 404 instead of data, on every call.

## Declared contract

| param | where | declared |
| --- | --- | --- |
| `project_id` | path | integer, required — **confirmed correct** |
| `values` | query | boolean, default `false` — *"Set to true to get each field's configured choices alongside its definition"* |

Declared 200: `{success, custom_fields[], default_fields[]}`.
Declared 400/401/403/404/500: `{success: false, error: {code, message, details}}`.

## The drift — `values=true` is a hard 404

| # | arguments | result |
| --- | --- | --- |
| 1 | `project_id: 379335744`, `values: true` | **404** `{"success":false}` |
| 2 | `project_id: "PR-2005"`, `values: true` | rejected client-side: `'project_id' must be a number` — confirms the declared integer type is right |
| 3 | `project_id: 379335744`, no query | **200** `{"success":true,"custom_fields":[],"default_fields":[]}` |

Isolating the cause, with repeats:

| `values` | outcome |
| --- | --- |
| `true` | 404 (reproduced) |
| `"true"` | 404 |
| `1` | 404 |
| `false` | 200 (2/2) |
| omitted | 200 (2/2) |

**Any truthy value 404s.** This is not an id problem, not intermittent, and not the environment — `project_id` is identical across all of them and the falsy cases succeed on the same id.

The consequence is that the capability is usable only in its degraded mode. Its guidance frames `values=true` as how you resolve option ids before writing an exploratory session; that path does not exist.

## Secondary drift — the 404 body ignores its own declared error envelope

The contract declares every error as `{success: false, error: {code, message, details}}`. The actual 404 is a bare:

```json
{"success":false}
```

No `error` object at all — so no `code`, no `message`, nothing an agent could use to understand what went wrong. A caller branching on `error.code` finds `undefined`.

## This settles the cross-capability error-envelope question

This suite was watching for a pattern after two capabilities never returned 200. Three data points now exist, and **the "integration- or tracker-scoped route" hypothesis does not hold**:

| capability | route scoping | declared error envelope | actual |
| --- | --- | --- | --- |
| `get_test_case_linked_issues` (batch 1) | **tracker-scoped** (`/integrations/{issue_type}/…`) | `{success:false, error:{code,message}}` | bare `{"status":500,"error":"Internal Server Error"}` |
| `verify_test_case_tags` (batch 3) | ordinary project-scoped | `{success:false, error:{code,message}}` | bare `{"status":500,"error":"Internal Server Error"}` |
| **this capability** | ordinary project-scoped | `{success:false, error:{code,message,details}}` | bare `{"success":false}` |

Only one of the three is integration-scoped, so scoping is not the common factor. What **is** common is narrower and more useful: **these capabilities declare a rich error envelope and the API does not honour it.** The failing status code varies (500, 500, 404) and so does the shape of what comes back, but in all three cases the declared error contract is fiction.

That is worth treating as one systemic finding rather than three tickets: **the declared error envelopes in this index appear not to be validated against the API at all.** Every capability in the registry declares 4xx/5xx shapes; on the evidence here, none of them should be trusted by an agent. A cheap way to confirm the scale would be to deliberately trigger one documented error on a sample of capabilities across entities and diff the bodies.

## What could not be checked

`custom_fields` and `default_fields` both came back **empty** on the fixture project, so the **nested per-field shape** — `option_values`, `field_values`, `parent_custom_field_id`, `links` and similar, which is precisely where this suite has found drift before (batch 2's `get_template` hid an undocumented `field_data.is_required` inside an unenumerated object) — could not be enumerated against real data.

Two independent reasons, both dead ends:
1. No custom fields are configured for exploratory sessions on this project.
2. The richer form (`values=true`) 404s, so even a configured project could not be read that way.

No cross-project fallback was available: the contract frames this as project-scoped with no account-level variant, and the v2 identifier form is rejected on type before reaching the server.

**Verdict note:** this is `DRIFT`, not `UNVERIFIED`. The empty-collection caveat applies only to the item-shape sub-question; the `values=true` 404 is a concrete, reproduced declared-vs-actual disagreement that stands on its own.

## Index actions proposed

1. **Fix or remove `values`.** If the API supports fetching choices by some other spelling or mechanism, document that instead; if it does not, delete the parameter and the guidance sentence promising it, because both currently lead an agent into a guaranteed 404.
2. **Correct the declared error envelope** for this capability to the bare `{success:false}` it actually returns — or, better, treat it as part of the systemic error-envelope problem above.
3. **Warn that `custom_fields`/`default_fields` can be empty** even on a valid project, so a caller does not read an empty list as a failure.

## Suggested next step for the product team

`GET /api/v1/projects/379335744/exploratory-sessions/form-fields?values=true` on preprod, versus the same call without the parameter. Whatever the `values` branch does — a missing route, a bad lookup, an unhandled nil — the two requests differ by one query param and land on different outcomes, which should localise it immediately.
