# update_custom_field_v2 — declared `mode: write`, destructive in effect

- **Product / entity:** tm / `custom_field` (declared `mode: write`)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Reviewed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/update_custom_field_v2.json` (verdict **UNVERIFIED**)
- **Related:** `findings/list_custom_fields_v2.md`, `findings/get_custom_field_v2.md`

## Nature of this finding — read first

**The capability was never invoked.** Every claim below is drawn from `describeCapability`'s own text, quoted verbatim, cross-checked against `create_custom_field_v2`'s contract, and against two live read-only probes of the account's custom fields.

So this is **not** a declared-vs-actual drift — there is no observed response to diff. It is a **contract-level defect**: the declared `mode` misrepresents the capability's blast radius, and the contract documents a live bug in its own guidance. Those are checkable by reading the index and need no invocation. The run file's verdict stays `UNVERIFIED`, and `declared_missing` / `undeclared_returned` stay empty, because filling them would be a guess.

**Why it was not invoked:** custom fields are one flat account-level collection — `list_custom_fields_v2` accepts no project or workspace identifier and returned all 30 rows on a single page, all sharing `group_id` 3452. All 30 are pre-existing fields attached to system template **1164**, linked to **1830 projects**. There is no disposable subject: `create_custom_field_v2` is itself UNVERIFIED because a created field cannot be removed (custom-field deletion is `mode: destructive`, and the runtime refuses destructive capabilities outright — confirmed this batch, even with `user_permission: "granted"`). Updating any of the 30 would change behaviour account-wide.

## Defect 1 — the mode understates irreversible, account-wide data loss

The capability is classified `write`, which in this runtime means it proceeds after a permission prompt. Ordinary writes are reversible; these are not. Its **own guidance**:

> "None of it can be undone. Option lists and project links are rewritten in place, there is no bin and no prior revision."

Three parameters destroy stored test-case data:

| parameter | documented effect |
| --- | --- |
| `options[]` | *"Replaces the dropdown's option list WHOLE on the field's existing dataset, options you leave out are removed and the values test cases hold for them are gone, in every linked project, with no undo."* |
| `assigned_projects[]` | *"is read as the complete desired set, not an addition — any currently linked project you omit is unlinked, and the values stored there go with it."* |
| `unlinked_projects[]` | *"Unlinking discards the values those projects' test cases hold for this field and cannot be undone."* |

`assigned_projects` is the sharpest edge: it is a **declarative set, not an additive list**. An agent that sends the one project it cares about silently unlinks every other project on that field and destroys their stored values. On this account that would mean up to 1830 projects from a single well-intentioned call.

By effect, these are deletes. The runtime's `destructive` gate — which exists precisely to stop unrecoverable operations, and which correctly blocked `delete_template_v2` this batch — does not apply here, because the capability is labelled `write`.

## Defect 2 — a body `field_type` is silently swallowed and the call still returns 200

From the guidance, verbatim:

> "field_type is not editable here. A field_type in the body is ignored, the stored type is kept and the call still answers 200, so never report a type change as done. **A guard meant to refuse it with 400 exists but cannot fire, because the stored field is loaded after that check runs.**"

The index is documenting a live product bug: a validation guard that is unreachable because of statement ordering. The consequence for an agent is a false success — it asks to change a field's type, receives `200`, and reports the change as done while nothing happened.

This matters more than it looks, because `create_custom_field_v2` says type can never be edited and that changing one *"in practice means deleting it and creating it again, which destroys every value already stored on test cases."* An agent that believes the no-op 200 will not know it must take the destructive path instead.

## Defect 3 — a successful response cannot confirm what it appears to confirm

The declared 200 is `{success, custom_field:{…}}`, but per the guidance the response **replays the request** for `options`, `assigned_projects`, `applies_to_all_projects` and `link_to_future_projects` rather than reading them back from storage:

> "Confirm project links and option values by reading the field's datasets."

So a `200` proves nothing about whether the dataset-side change landed. This is the same echo trap as `create_custom_field_v2`, and it has a direct consequence for this suite: **any future probe that diffs this response against its own request will produce a false PASS.** Verification must go through `get_custom_field_v2` and `dataset_urls`.

## Defect 4 — the two-phase write is not atomic

> "Field attributes are written first, the dataset second, so a failure on the dataset call leaves the rename or required-flag change already applied. Re-read the field before retrying."

A partial failure leaves the field in a mixed state, and the guidance's own advice — re-read before retrying — is sound but undercut by Defect 3, since the fields most likely to have failed are exactly the ones the response echoes rather than reads.

## Also recorded

- **Silent no-ops:** empty strings on `field_name`, `place_holder_text` and `default_value` are ignored rather than clearing the stored value. `is_required` is the one field where `false` is honestly written.
- **`levels[]`** is forwarded upstream but currently ignored there for renames.
- **`default_value` quirk:** on a boolean field it must be the **string** `"true"`/`"false"` (coerced to `"1"`/`"0"`); a real JSON boolean is rejected by the body schema.

## Credit where the contract is good

Two things this entry documents **well**, and which should not be lost in a rewrite:

- **The `applies_to_all_projects` asymmetry is called out explicitly on both sides.** On create it links every existing project (enumerating the workspace, ~3000 projects); here it *only* toggles the future-projects flag and never touches existing links. Both contracts state this and agree. A same-named boolean with different semantics across sibling capabilities is a genuine trap, and the index catches it.
- **`default_value` is consistent across the pair.** Create defers default-setting to this capability; this capability accepts it for every type. The documented create-then-edit workflow is internally coherent (though unexercised).

## Index actions proposed

1. **Reclassify, or split.** Either promote this capability to `destructive`, or separate the safe attribute edits (`field_name`, `is_required`, `place_holder_text`, `default_value`) from the data-destroying ones (`options`, `assigned_projects`, `unlinked_projects`) so the gate can protect the latter. As it stands, the runtime's strongest safety mechanism does not cover one of its most destructive endpoints.
2. **Make `assigned_projects`' set semantics unmissable** — at minimum in the intent line, not only in a parameter note. "Complete desired set, omissions are unlinked and their values destroyed" belongs where an agent cannot skip it.
3. **Escalate Defect 2 to the product team.** The unreachable 400 guard is a code-ordering bug, not a documentation problem. Until it is fixed, the guidance's "never report a type change as done" must stay.
4. **Keep the echo warning, and carry it into the suite.** The deterministic replay checker must verify this capability against stored state, never against the response.

## What proper verification would require

A disposable workspace whose custom-field collection can be populated and torn down — one where `create_custom_field_v2` is not blocked and created fields can actually be deleted. Then, on that subject: a rename; an `is_required` flip both ways; `default_value` on a boolean and a non-boolean type; an `options` replacement that deliberately drops an option, to confirm test-case value loss; an `assigned_projects` / `linked_projects` / `unlinked_projects` round trip to confirm declarative-vs-incremental behaviour; and a `field_type`-in-body call to confirm the silent no-op. Each verified by re-reading stored state, not by the response. None of it is safe against this shared 30-field, 1830-project account.
