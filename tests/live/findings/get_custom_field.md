# get_custom_field — DRIFT

- **Product / entity:** tm / `custom_field` (read)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/get_custom_field.json`
- **Related:** `findings/list_custom_fields.md` — the two contracts contradict each other on `id`

## Summary

Invoked cleanly on the first attempt against two real custom fields. **Every declared field was present and correctly typed** — `declared_missing` is empty. The drift is one-directional: **five real fields come back that the contract never mentions.**

A minor but genuine declared-vs-actual gap, so DRIFT rather than PASS. This is not a hollow contract — the declared 200 commits to a specific field list.

## Declared contract

- Path param `id` (integer, required, positive). The contract **explicitly calls out the published spec's `cf-123` string form as wrong** — and it is right to.
- No body, no `json_path` nesting — a plain path-param GET.
- Query `page` / `per_page` (alias `p`) affect only pagination of `dataset_ids` / `dataset_urls`, not the field itself.
- Declared 200: `{success, custom_field: {id, field_type, field_name, entity_type, is_required, default_value, place_holder_text, applies_to_all_projects, link_to_future_projects, dataset_ids, datasets_url, dataset_urls}}`.
- Guidance states upfront that `applies_to_all_projects` / `link_to_future_projects` are hardcoded `false` placeholders rather than real project scope, and that **no option values are ever returned here** — only dataset references to follow separately.

## Ids used — resolved, not invented

`list_custom_fields` (`p=1, count=300`) returned the whole 30-field workspace on one page. Two ids were chosen to cover shape variation:

- **105920** — `dropdown` ("Severity_jzcdfp3_customFields-fyu78i")
- **105914** — `multi_dropdown` ("multi_dropdown_field_uw5mub")

Both calls returned **200** on the first attempt; `attempts[]` is empty.

## The drift — five undeclared fields

Present on **both** the dropdown and the multi_dropdown field, absent from the declared 200 schema and from `returns`:

| field | note |
| --- | --- |
| `system_name` | |
| `is_bulk_editable` | |
| `is_filterable` | |
| `placeholder` | near-duplicate of the declared `place_holder_text`, same value |
| `group_id` | |

`placeholder` is **the same undeclared duplicate that `list_custom_fields` also returns**. Two capabilities exhibiting it points at a shared serializer, so it should be fixed there rather than twice.

## Confirmed correct

- **All 12 declared fields present and correctly typed** on both responses.
- `applies_to_all_projects` and `link_to_future_projects` were both `false`, exactly as the guidance warns (hardcoded placeholders, not real scope).
- **No option values returned** for either field — consistent with the contract's own explicit disclaimer, so this is not a gap.
- The `multi_dropdown` field returned **no extra nested structure** (no `options`, no `levels`) — an envelope identical to the dropdown field, matching the guidance that richer nested data lives behind `dataset_urls`.

## Internal contradiction with `list_custom_fields`

Worth flagging because it shows the index disagreeing with itself rather than merely with the API:

| | declares `id` as |
| --- | --- |
| **this capability** | integer, and says the `cf-123` string form is wrong ✅ matches reality |
| `list_custom_fields` | string, form `cf-123` ❌ contradicted by reality |

This entry is the correct one. The `list` sibling appears to have inherited the stale published spec — see that finding for the full diff, including a `field_type` enum that is likewise wrong there and right in `create_custom_field`.

## Confidence and limits

Two fields probed, chosen for differing types; both showed the identical set of five undeclared keys. Not exercised: the `page` / `per_page` pagination of `dataset_ids` / `dataset_urls`, and following `dataset_urls` to check option values (out of scope — the contract disclaims options here).

## Index actions proposed

1. **Declare `system_name`, `is_bulk_editable`, `is_filterable`, `group_id`** on the 200 shape, or confirm they are intentionally internal.
2. **Resolve `placeholder`** — declare it, or drop it from the serializer as a duplicate of `place_holder_text`. Coordinate with `list_custom_fields`, which returns it too.
3. No change needed to this entry's `id` declaration — it is correct, and is the reference for fixing the `list` sibling.

All are index-side documentation defects; none prevent the capability being used. Of the batch's custom-field findings, this is the least severe: nothing declared is wrong or missing, only under-described.
