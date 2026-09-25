# generate_test_case_automation — BLOCKED

- **Product / entity:** tm / `test_case` (write — starts an external automation/codegen job)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — 2 deliberate invocations (minimal, then maximal)
- **Run file:** `tests/live/runs/tm/generate_test_case_automation.json`
- **Related:** `findings/error-envelopes-systemic.md`

## Summary

**The endpoint crashes on every call, independent of input**, returning an HTTP **422** — a status code absent from its own declared set — whose body carries a **leaked, double-JSON-encoded Ruby exception**:

```json
{"success":false,"message":"{\"message\":{\"title\":\"Internal Error\",\"message\":\"undefined method `[]' for nil:NilClass\"}}"}
```

Nothing was mutated and nothing appears to have been queued. The case's `automation_status` and `last_updated_at` were identical before and after both attempts.

## Why this is BLOCKED and not a payload mistake

The obvious competing explanation was **an incomplete declared-required set** — `undefined method '[]' for nil:NilClass` is exactly what a handler does when it dereferences an option the caller never supplied, and batch 3's `create_report` demanded three fields both its parameter list *and* its prose called optional. So that had to be ruled out before calling the endpoint broken.

| # | payload | result |
| --- | --- | --- |
| 1 | **minimal** — required fields plus a placeholder `base_url` | 422, leaked Ruby `NoMethodError` |
| 2 | **maximal** — `test_name`, `base_url`, `credentials`, `local_enabled:false`, `steps` from the case's real step text, `test_case_details` built from the case's own real title/identifier/steps, `tags` from the case's real tag, and `test_case_folder_id`/`folder_id` both set to the case's real folder `764828` | **byte-identical 422**, same leaked error |

Deliberately omitted from the maximal payload, with reasons rather than guesses: `lcnc_link` (no prior automation build exists to link to — this is a first-time generation), `feedback` / `score` (both documented as rating *a previous generation*, and none exists for this case), and `preTestConfig` (no pre-test profile has ever been established for this project or case). **No ids were invented.**

Since populating every field that could sensibly be filled changed nothing, there was no plausible field left to add. That rules out the missing-parameter explanation and points at the endpoint being broken independent of input, for this case/project/environment.

This is the same evidentiary standard applied to `get_test_case_linked_issues` (3 attempts, varied `issue_type` and query params) and `verify_test_case_tags` (5 attempts, including the documented-valid empty array) before either was called BLOCKED.

## Proportionality — how this was probed, and why only twice

This capability starts a **real external job**, so it was not fired casually:

- Its contract was read **before** any invoke: the 200 only hands the request to an external automation service, with completion later stamped onto the case by a webhook. It is asynchronous and stateful, with a documented in-progress lock (auto-clearing after an hour) and a region gate — the signature of a metered backend job.
- It was targeted **only** at the disposable fixture case `TC-54458`, never the `__readonly__` cases, with a placeholder `base_url`.
- **Two invocations total.** The second was justified specifically because the first had verifiably queued nothing (the case was unchanged), so the retry was another attempt to start the *first* job rather than a second job.
- No blind third attempt was made, and none is needed.

## The effect would not be verifiable even if it worked

Worth recording independently of the crash: **no companion status capability exists.** A search across automation-status, lcnc, build-link and related surfaces found nothing. The only indirect signal is re-reading the case via `get_test_case`, which exposes `automation_status` but has **no field at all** for the `lcnc_link` / build metadata the guidance describes.

So even a successful queue could only ever be *partially* verified through this index, never confirmed complete. This is structurally the same gap as `initiate_export` (batch 5), whose `export_id` is redeemable only in the product UI — see that run file. **The index publishes job-initiating capabilities with no way to observe their outcome**, which is worth addressing as its own class of problem.

## Error-envelope violation — a new sub-type

Neither the **status code** nor the **body shape** appears anywhere in the declared error set (declared: 200/400/401/403/404/451/500). This adds two things the other six instances did not have:

1. a status code **entirely absent from the declared set**, now confirmed input-independent across both payload sizes;
2. a **leaked raw server-side exception** rather than any structured error object — an unhandled Ruby `NoMethodError`, double-JSON-encoded inside a `message` string.

Consolidated in `findings/error-envelopes-systemic.md`. **The leak is a product issue in its own right:** a stack-level error reaching a public API surface should not happen regardless of what the contract says, and it is worth reporting separately from the documentation problem.

## Pattern across the suite's crash-BLOCKED capabilities

All three capabilities that fail with an unhandled server error are **v1 routes on phase-2 entities**:

| capability | route | failure |
| --- | --- | --- |
| `get_test_case_linked_issues` | `/api/v1/integrations/{issue_type}/…` | bare 500, every input |
| `verify_test_case_tags` | `/api/v1/projects/{id}/test-cases/tags/verify` | bare 500, every input |
| `generate_test_case_automation` | v1 | 422 + leaked Ruby error, every input |

(The suite's fourth BLOCKED, `create_template`, is a v2 route and fails on *validation* rather than a crash — a different mechanism.)

Whether the three share a root cause is unknown from here, but they are worth investigating together rather than as three tickets. Two were already flagged as a possible pair; this is the third.

## What this evidence cannot settle

No backend source or server-side logs were consulted, so **why** the handler dereferences nil is unknown. What is established: the capability cannot be invoked successfully through its documented surface, and the cause is not on the caller's side.

Because no call succeeded, **no field-level declared-vs-actual diff was possible** — `probe.status` is null and `declared_missing`/`undeclared_returned` are deliberately empty rather than guessed.

## Suggested next step for the product team

Server-side logs for the two requests at the probe timestamps, with the **maximal** payload as the reproducing case — it is the stronger one, because it eliminates "the caller omitted something." The stack trace behind `undefined method '[]' for nil:NilClass` should localise it immediately. Worth diffing against the `get_test_case_linked_issues` and `verify_test_case_tags` traces given the shared v1/phase-2 signature.

## Index action

**None on the crash** — the parameter declarations could not be assessed against a working call, and changing the contract on this evidence would be guessing.

**One change is warranted independently:** the declared error set should include whatever this endpoint really returns, and the guidance should note there is no way to observe job completion through this index.

## Residue

None. Both calls crashed before doing anything; `TC-54458` is unchanged and still carries `automation_status: not_automated`.
