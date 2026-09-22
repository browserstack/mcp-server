# `edit_test_run` silently destroys data in two different ways

- **Product:** tm
- **Environment:** preprod (`test-management-preprod.bsstag.com`)
- **Status:** for the product team. The most damaging pair found in the writes phase.

Both were reproduced, both are invisible to the caller, and in both cases the **contract
actively tells the caller the opposite of what happens**.

## 1. `test_case_ids` replaces the run's case list — the docs say it is additive

The contract states the field is *"additive … never removes"*. It is a set operation.

Sending `test_case_ids: [1985019, 1985020]` against a run holding TC-54455, TC-54456 and
TC-54458 left the run with **two** cases, not five. The three originals were silently detached.
Confirmed by an independent re-read (3 → 2), then recovered by resending all five ids together.

The damage is proportional to how much the caller does *not* send. An agent adding one case to a
fifty-case run, following the documentation exactly, detaches forty-nine.

**This is the second capability to mislead a caller about adding cases to a run.**
`bulk_assign_test_cases_to_test_run` is named as though it maps cases into a run but only sets
assignees on rows already there. Its probe identified `edit_test_run.test_case_ids` as the
correct alternative — and that field then destroys the existing list. Both routes to the same
goal are documented wrongly, in different directions.

## 2. `owner` is cleared by any edit that omits it

Every other optional field on this capability is documented omit-to-leave-alone and behaves
that way: `tags`, `is_dynamic` and the rest survive an edit that does not mention them.
`owner` does not.

Reproduced twice:
- once on an edit that also changed the case list
- once on an edit touching **only `name`** — `owner` went `3741 → null`

Verified through two independent read capabilities on each occasion, and restored manually both
times. A caller renaming a run loses its owner.

## 3. The write response cannot be used to detect either problem

The owner-restore call returned a response echoing `owner: null` and a stale `updated_at`,
while an independent read one call later showed the write had in fact applied. So the response
was wrong in the *safe* direction there — but it demonstrates the response is not a reliable
witness to what happened, which is exactly what a caller would consult to notice the two bugs
above.

This is now the third test-run endpoint with untrustworthy write responses.

## Why these two are worse than the rest of the campaign's findings

Most drift here is documentation being wrong about a field's *shape*. These are documentation
being wrong about a field's *effect*, in the destructive direction, on a capability an agent
would reasonably call to perform a routine edit. A caller who reads the contract carefully and
follows it precisely still loses data.

## Suggested next step

Either make `test_case_ids` genuinely additive to match the documentation, or — if set
semantics are intended — rename it (`set_test_case_ids`) and add an explicit additive
counterpart, because the current name plus the current doc text guarantees the mistake.

For `owner`: treat an omitted `owner` the same as every other omitted optional field. If
clearing must remain possible, require an explicit null.

## Evidence

Run TR-9110 (integer 17577900), project 379335744, 2026-09-22. Full trace in
`tests/live/runs/tm/edit_test_run.json`. No backend source consulted — observed behaviour only.
