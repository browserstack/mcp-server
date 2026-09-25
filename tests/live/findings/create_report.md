# create_report — DRIFT

- **Product / entity:** tm / `report` (write)
- **Path:** `POST /api/v2/projects/{project_id}/reports`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/create_report.json`

## Summary

**A payload built faithfully from the declared contract was rejected with a 400.** The API demands three body fields that the contract's parameter list does not mark required *and* that the contract's own prose guidance explicitly says are **not** required.

This is the same class of defect as `create_root_folder` — a declared request shape the API won't accept — reached not through body nesting but through the required-field set. The response shape, by contrast, is flawless.

## The contradiction, in the index's own words

Declared required: `project_id` (path, `^PR-\d+$`), `report_type` (closed enum of 10 display names), `report_timeframe`, `report_creation_mode` (`custom_report` | `system_generated`).

`title`, `frequency`, `mail_to` and `report_filters` carry **no `required: true`** in the parameter list. And the guidance text states, verbatim:

> "the real required set is only report_type, report_timeframe and report_creation_mode … [others] are not [required]"

So both the machine-readable flags and the prose agree with each other — and both are wrong.

## Attempts

**Attempt 1** — exactly as declared: the three flagged-required fields plus `title`, nothing else.

→ **400 `Invalid JSON data`**, verbatim:

```
The property '#/' did not contain a required property of 'report_filters'
The property '#/' did not contain a required property of 'mail_to'
The property '#/' did not contain a required property of 'frequency'
```

**Attempt 2** — added exactly the three fields the contract said were unnecessary, with trivial values (`frequency: "once"`, `mail_to: {users:[],external_mails:[]}`, `report_filters: {}` — the timeframe was `last_one_week`, a rolling window needing no filters).

→ **201 Created.** Report `SC-489` on `PR-2005`, title `__mcp-probe-report-2026-09-18T04:32:18Z`, `report_type: "Test Run Summary"`, unscheduled, no mail recipients.

The drift is therefore precise and unambiguous: **the declared required set is incomplete by exactly three fields**, and the guidance actively reinforces the wrong answer. An agent following the contract fails on its first call and has no way to learn what's missing except by reading a 400 that happens to name the fields.

## The response shape is clean

Worth stating plainly, because it isolates the defect: **every** field the 201 schema declares was present with matching nested shapes — `id`, `project_id`, `project_ids`, `report_type`, `title`, `description`, `report_timeframe`, `report_creation_mode`, `custom_date_range`, `frequency`, `frequency_details`, `next_run_at`, `is_scheduled`, `created_at`, `owner`, `mail_to`, `report_filters`, `dynamic_filters`, `latest_attachment`. Nothing undeclared came back. `declared_missing: []`, `undeclared_returned: []`.

## Verification against storage, not the echo

Batch 2 established that some create capabilities replay request values rather than reading storage, which makes a response-vs-request diff yield a false PASS. This probe avoided that trap:

- `get_report(PR-2005, SC-489)` → 200, byte-identical record.
- `list_reports(PR-2005)` → `total_report_count: 1`, up from the **0 baseline** a sibling probe had established beforehand, with `SC-489` the sole row.

Both recorded in `setup[]`. The report genuinely exists.

## Safety notes

The report was created **unscheduled** (`frequency: "once"`, `frequency_details: null`, `is_scheduled: false`, `next_run_at: null`) and with **no mail recipients** (`mail_to: {users:[],external_mails:[]}`), so nothing fires on a timer and nothing is emailed to anyone. Scoped to the fixture project only.

One thing to be aware of for future probes: **`frequency: "once"` is documented as a substitution for a stored null**, not a real schedule. A caller could read `"once"` as "this is a scheduled report that runs one time" when in fact no schedule exists. The sibling `get_report` probe was asked to check that specifically.

## Index actions proposed

1. **Mark `report_filters`, `mail_to` and `frequency` required** in the parameter list.
2. **Fix the guidance sentence** that says the real required set is only the three fields. It is the more damaging half of this defect: a careful agent that reads the prose will trust it over its own caution and still fail.
3. **Document the acceptable trivial values** for the three, since they are required but often semantically empty — `report_filters: {}`, `mail_to: {users:[],external_mails:[]}`, `frequency: "once"` all work and are what an unscheduled, unmailed report needs.
4. **Clarify the `frequency: "once"` substitution** so a caller cannot mistake an unscheduled report for a recurring one.

No change needed to the declared response shape — it is accurate.

## Residue

Report **`SC-489`** remains on project `PR-2005`. It is unscheduled and has no recipients, so it is inert, but it is the only report on that project and two sibling probes assert against it.
