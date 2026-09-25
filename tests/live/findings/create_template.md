# create_template — BLOCKED

- **Product / entity:** tm / `template` (write)
- **Path:** `POST /api/v2/templates`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-17 — 6 attempts across two passes
- **Run file:** `tests/live/runs/tm/create_template.json`

## Summary

**The capability cannot be invoked successfully through its documented surface.** The contract declares `description_fields` and `properties_fields` optional; the live API rejects the create unless certain "non-removable System fields" are present — and those field ids are **not exposed by any documented read capability**, including `get_template` against a known-good template of the same entity type.

This is the same class of defect as `create_root_folder`: a published, structurally valid capability that no agent can actually use.

## Declared contract

Flat top-level body, **no wrapper key** (`json_path: none`):

| field | declared |
| --- | --- |
| `name` | **required**, string |
| `entity` | optional, defaults `"TestCase"` |
| `description_fields` | array, **optional** |
| `properties_fields` | array, **optional** |
| `linked_projects` | object — `link_to_future_projects`, `linked_to_all_projects`, `link_projects` (integer project ids, v1 numeric form), `unlink_projects` |

Guidance states verbatim: *"Omitting [description_fields] creates a template with an empty description section."*

Declared success: **201** with `{success, template}`, the template carrying `id/name/entity/enabled/field_count/…` plus `description_fields`, `properties_fields`, `step_fields`.

## What the contract gets right

The flat body shape is **correct**, and this is worth recording because it was the leading hypothesis for the failure. Attempt 2 wrapped the payload under a `template` key and `invokeCapability` rejected it client-side before any HTTP call:

```
unknown body: template. accepted: description_fields, entity, linked_projects, name, properties_fields
```

So the nesting is not the problem — unlike `create_root_folder`, where it was.

## Attempts

| # | body | result |
| --- | --- | --- |
| 1 | both field arrays **omitted**, per the contract's own guidance | `400 {"success":false,"message":"Fields not present."}` |
| 2 | wrapped under a `template` key | rejected client-side — confirms flat shape is right |
| 3 | both arrays present but **empty** | `400 … templateFieldValidationError: Non-removable System fields not present in template.` |
| 4 | all 6 description + all 7 properties **system** field ids read from live template 1164 | identical `templateFieldValidationError` |
| 5 | *(diagnostic)* description populated, `properties_fields` key omitted | error reverts to generic `"Fields not present."` |
| 6 | **complete field census of template 1164** — all 6 description + all 37 properties (7 system + 30 custom) | identical `templateFieldValidationError` |

### Discovery performed (recorded in `setup[]`, reads only)

1. `list_templates` → system templates **1164** "Test Case Steps" (default, `field_count` 45) and **1664** "Test Case BDD" (`field_count` 47).
2. `get_template` (`id: 1164`) → real layout: description system ids `[1,2,3,4,8,9]`, properties system ids `[10,11,12,13,14,15,16]`, plus 30 custom field ids.

**No field in that response carries a "non-removable" marker at the mapping level.** `is_mandatory` is `false` on *every* entry — including Title, Attachments, Owner and Requirements, whose underlying `field_data.optional` is `false`.

> **Amended 2026-09-18 after probing `get_template` directly** (see `findings/get_template.md`). The sentence above originally read "no field carries any 'non-removable' marker", which was too strong: it was reached by checking `is_mandatory` alone. There is a **second, undocumented required-ness signal** inside the unenumerated `field_data` object — `field_data.is_required`, which is genuinely `true` on custom field `CF_x3ckvk` (id 104762) while that same mapping row's `is_mandatory` is `false`.
>
> **This does not change the BLOCKED verdict.** Attempt 6 sent the *complete* field census of template 1164 — every id the read surface returns — and still failed identically, which makes the marker question moot: whatever create validates against is not among the ids any documented read exposes. But the hidden `field_data.is_required` flag is a live lead for whoever picks this up, and the original wording should not go to the product team unqualified.

## Why this is BLOCKED and not a payload mistake

**Attempt 6 is decisive.** It reproduced, exactly, the complete set of field ids that a real, valid, system-default template of the same entity type actually has — and got the identical error. That rules out "the probe picked the wrong subset of ids." Whatever the API counts as "non-removable" is **not among the ids the documented read surface returns**.

Attempt 5 further separates two distinct failure messages, which the contract documents as neither:
- a **missing key** → `"Fields not present."`
- **both keys present as arrays**, any contents → `templateFieldValidationError: Non-removable System fields not present in template.`

A corroborating detail: `update_template`'s own guidance says "Review & Approve" system fields are auto-injected on update but **filtered out of every read even when stored**. If those same hidden fields are what create demands, then by construction no read capability can ever reveal their ids — which matches the observed behaviour exactly. Stated as the most consistent hypothesis, not as verified fact; confirming it needs backend source.

## Contract defects to fix

1. **`description_fields` / `properties_fields` are documented optional. They are not.** Omitting either is a hard 400. The guidance sentence "Omitting this creates a template with an empty description section" is **false against preprod** and actively misleads an agent into the failing call.
2. **The mandatory system field ids are undocumented and undiscoverable.** The contract names no required field ids, and no documented capability exposes them.

## Evidence not gathered

No backend source or server-side logs were consulted, so the *cause* of the hidden-field requirement is hypothesis. What **is** established by the request/response pairs above is narrower and sufficient: the documented surface is not enough to make this call succeed.

## Suggested next step for the product team

Confirm which system field ids `POST /api/v2/templates` validates as non-removable, and whether any read endpoint exposes them. If none does, the create contract needs either a default the server applies itself, or a documented list of required ids.

## Index action

**Do not mark this PASS or paper over it with a worked payload — there isn't one.** Once the true requirement is known, the index needs (a) `description_fields`/`properties_fields` re-declared as required with their mandatory contents described, and (b) the "omitting this…" guidance sentence removed or corrected. Until then this capability should be treated as unusable by agents.
