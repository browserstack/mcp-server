# update_test_case_v2 — DRIFT

- **Product / entity:** tm / `test_case` (write)
- **Path:** `PATCH /api/v2/projects/{project_id}/test-cases/{test_case_id}`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — subject `TC-54458` (numeric `1975349`), fully restored afterwards
- **Run file:** `tests/live/runs/tm/update_test_case_v2.json`
- **Related:** `findings/error-envelopes-systemic.md`, `findings/create_test_case_v2.md`

## Summary

The update itself works correctly, is genuinely sparse, and its 200 response matches the declared nested schema exactly. Three defects on the **request** side, one of which is traceable to a specific hand-resolution of a naming collision.

## Drift 1 — the contract narrates behaviour for a field it does not declare

`is_shared` is **not in the declared param list.** Sending it is rejected client-side before any HTTP call:

```
unknown body: is_shared. accepted: attachment_id, automation_status, background,
case_type, created_at, custom_fields, description, estimate, expectation,
expected_result, feature, identifier, ids, issue_tracker, issues, name, old_id,
owner, preconditions, priority, review_status, reviewers, scenario,
send_for_review, status, tags, template, template_id, test_case_dataset,
test_case_folder_id, test_case_steps, updated_at
```

Yet the capability's **own guidance narrates specific server-side behaviour for `is_shared`** — that it is checked before the write and then discarded.

**This is traceable to the collision resolution.** `update_test_case_v2` was one of five naming collisions resolved by hand when the phase-2 PR landed, and that commit message states plainly: *"dropped `is_shared` (ours). It is permitted only in the BULK edit params… so it cannot change sharing here and silently does nothing when it passes. Guidance says so."*

So the resolution **removed the field from the permit list and deliberately kept guidance describing it.** The reasoning for dropping it was sound; leaving the guidance behind was the slip. The result is an internally inconsistent contract: it explains the handling of a parameter an agent cannot send through this surface.

This is a **new class of defect** for this suite — not declared-vs-actual, but guidance-vs-own-declaration. Worth a targeted sweep: wherever guidance discusses a field, check that field is still in the param list.

## Drift 2 — `updated_at` contradicts its own documentation

The contract claims `updated_at` is "dropped without error," behaving like `created_at`. Only half of that holds:

| field | documented | actual |
| --- | --- | --- |
| `created_at` | silently ignored, no effect, no error | **exactly as documented** ✅ |
| `updated_at` | same — "dropped without error" | **actively validated**, then still discarded ❌ |

A past-dated `updated_at` returns **400**: `updated_at must be greater than or equal to current time`. A *valid* future-dated value passed validation and was **still never applied** — the response's `last_updated_at` was the server's real current time, not the submitted value.

So it is validated-yet-always-discarded. An agent told the field is harmlessly dropped will be surprised by a 400 on a value the contract implied was ignorable.

## Drift 3 — the 400 body ignores the declared error envelope

That validation failure returned:

```json
{"success": false, "message": "updated_at must be greater than or equal to current time"}
```

No `error` object — the contract declares `{success, error: {code, message, details}}`.

This is the **fifth** instance of this across the suite and the reason it is now consolidated into a single systemic finding rather than filed per capability. See **`findings/error-envelopes-systemic.md`**.

## Claims that checked out, and one that is untestable

**All seven "added" fields are genuinely declared.** The collision resolution added `old_id`, `expectation`, `attachment_id`, `ids`, `issue_tracker`, `created_at`, `updated_at`, which neither original side had declared — all seven are present in the permit list above.

- `old_id` and `expectation` were **accepted (200)** but are echoed by neither this response nor `get_test_case_v2`, so their effect is **unverifiable through this surface**.
- `attachment_id` was **skipped** — no real stored attachment exists and inventing an id was correctly declined.
- `ids` was **skipped deliberately**, because it risks fanning the write to other cases, possibly including the `__readonly__` fixtures. Good judgement: that is exactly the kind of param that turns a single-case probe into a multi-record accident.
- `issue_tracker` was skipped as only meaningful paired with `issues`.

**`identifier` is untestable here without risk.** The guidance says it is read from raw params and mapped to a third-party identifier when the workspace uses project-level ids. The probe sent the case's **own current value** (`TC-54458`) rather than a new one — a no-op either way — precisely so the fixture's addressability could not be damaged if the workspace turned out to be in that mode. Recorded as untestable rather than guessed at.

**Sparse-update semantics hold.** Omitted fields (`status`, `case_type`, `automation_status`, `owner`, `preconditions`, `custom_fields`, `attachments`, `folder_id`, `template`) all kept their stored values.

## Empty-string semantics differ by field — worth documenting

- `description: ""` **actually clears** the field to `null`. Verified by an independent `get_test_case_v2` read, with `last_updated_at` advancing — a real write, not a no-op.
- `name: ""` is documented as a **400** rather than a clear.

So "empty string" means clear on one field and an error on another. Batch 2's `update_custom_field_v2` had the same field-dependent inconsistency (empty strings as no-ops on some fields). An agent cannot generalise here and the contract should say so per field.

## Not scored as drift

The guidance describes a `test_case`-wrapped HTTP body. The probe read this as a description of the **underlying HTTP contract** rather than a caller-facing instruction, sent flat, and it worked every time. That is the correct reading and matches the sibling `create_test_case_v2`, which declares `json_path: /test_case/<field>` without telling the caller to wrap. Not counted against this capability — but see `findings/create_test_plan_v2.md` for the five capabilities whose guidance *does* wrongly instruct wrapping.

## Fixture left as found

Name, description, priority, tags and one step's result text were all restored, confirmed by a final independent `get_test_case_v2` read matching the original baseline exactly — only `last_updated_at` differs, which necessarily advances on any write. All verification went through separate reads, never the update echo.

## Index actions proposed

1. **Remove the `is_shared` guidance**, or re-declare the field if entitled workspaces need to send it. As it stands the contract documents an unsendable parameter.
2. **Correct the `updated_at` description** — it is validated (and rejects past dates) and then discarded, which is not the same as `created_at`'s silent drop.
3. **Fix the declared 400 envelope** — see the consolidated systemic finding.
4. **Document empty-string semantics per field** — `description` clears, `name` 400s.
5. **Warn about `ids`** — that it fans a single-case update across multiple cases is a significant footgun and deserves a prominent note, not just a parameter line.
6. Note that `old_id` / `expectation` are accepted but not reflected in any read, so their effect cannot be confirmed by a caller.
