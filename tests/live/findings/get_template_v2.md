# get_template_v2 — DRIFT

- **Product / entity:** tm / `template` (read)
- **Path:** `GET /api/v2/templates/{id}`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/get_template_v2.json`

## Summary

The capability invokes cleanly — both probes succeeded first try, and the declared 200 is a genuinely rich schema, not a thin passthrough, so this is a substantive result rather than a hollow conformance check. Two declared claims are false against the live API, and a third gap hides a required-ness signal the contract never mentions.

**Probed two templates, not one**, so none of this is a single-record fluke:
- **1164** "Test Case Steps" — `description_fields` system ids `[1,2,3,4,8,9]`, `properties_fields` system ids `[10…16]` + 30 custom fields, `step_fields: []`
- **1664** "Test Case BDD" — same shape; `description_fields` adds system ids 5/6/7 (Background / Features / Scenario, gherkin type) in place of id 4; same 30 custom fields by id; `step_fields: []`

## Declared contract

Input is only `path_params.id` (integer, required, plain numeric — no prefix). No query, no body, no `json_path`.

Declared 200: `{success, template}`, where `template` carries list-style metadata (`id, name, entity, enabled, step_type, is_default, is_system, future_projects_applicable, field_count, linked_to_all_projects, project_count, created_at, updated_at`) plus `description_fields` / `properties_fields` / `step_fields`, each an array of mapping rows `{id, field_category, custom_field_id, system_field_id, order, is_mandatory, field_data}`.

## Drift 1 — `field_data.field_type_raw` is documented as numeric; it is a string

The guidance says `field_data`'s type is *"returned as a name, with the raw numeric type alongside it."*

In reality `field_type_raw` is **never numeric**. On every custom field, on both templates, it is a string type-name: `"string"`, `"date"`, `"dropdown"`, `"multi_dropdown"`, `"url"`. Its sibling `field_type` (the "name") is also a string, e.g. `"field_string"`. Both keys are strings; the specific claim about a raw numeric type is simply false.

A caller that treated `field_type_raw` as an integer — which is what the contract tells it to do — would break.

## Drift 2 — `field_data` is unenumerated, and hides a second required-ness signal

The contract leaves `field_data` almost entirely unenumerated. In practice it is a large, asymmetric object: **7 keys for system fields, 17 for custom fields.**

Among the undeclared keys is **`field_data.is_required`** — and it is genuinely `true` on custom field `CF_x3ckvk` (id **104762**) on both templates, **while that same mapping row's `is_mandatory` is `false`.**

So there are **two independent required-ness signals**, and the contract documents only one of them.

## Drift 3 — `field_count` is null from this endpoint

`field_count` came back `null` on both templates. This is **not a schema violation**: the schema explicitly permits it to be nullable "when not computed for this response." But it means `get_template_v2` apparently never computes it, while `project_count` (1830) *is* populated on both. Worth documenting so nobody treats this endpoint as a source of `field_count`.

Note for cross-referencing: the 45/47 `field_count` values recorded in batch 1 came from **`list_templates_v2`**, not from this endpoint.

## This partially corrects a batch-1 finding

`tests/live/findings/create_template_v2.md` states: *"No field in that response carries any 'non-removable' marker. `is_mandatory` is `false` on every single entry."*

The first half of that sentence is **too strong**. It was reached by checking only `is_mandatory`. Drift 2 shows a second, undocumented required-ness signal inside `field_data` — so "no marker at all" was an incomplete reading of the response.

**This does not overturn the BLOCKED verdict on `create_template_v2`.** That verdict rests on attempt 6, which sent the *complete* field census of template 1164 — every id the endpoint returns — and still failed with `templateFieldValidationError`. Sending all the ids makes the marker question moot: whatever create demands is not among the ids this read surface exposes at all. But the wording of that finding should be tightened before it goes to the product team, and the existence of a hidden `field_data.is_required` is worth handing them as a lead.

## Confirmed correct (replicated on a second template)

- `is_mandatory` is `false` on every mapping row on **both** templates, including Title / Attachments / Owner / Requirements, whose `field_data.optional` is `false` on both. Batch 1 saw this on 1164; it holds on 1664 too.
- Review & Approve fields are absent from `properties_fields` on both, consistent with the filtering the guidance describes. **Unproven either way:** absence cannot distinguish "filtered out" from "genuinely not stored" without another surface to compare against, and none was invoked.

## Index actions proposed

1. **Fix the `field_type_raw` description** — it returns a string type-name, not a raw numeric type.
2. **Enumerate `field_data`**, or at minimum document `field_data.is_required` and note that it is independent of the mapping-level `is_mandatory`. Two contradictory required-ness flags with one undocumented is a trap.
3. **Note that `field_count` is not computed on this endpoint**, and point callers at `list_templates_v2` for it.
4. Tighten the `create_template_v2` finding's "no non-removable marker" sentence as described above.

All four are index-side documentation defects. None prevent the capability being used.
