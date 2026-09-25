# list_custom_fields — DRIFT

- **Product / entity:** tm / `custom_field` (read)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/list_custom_fields.json`
- **Related:** `findings/get_custom_field.md` — the two disagree with each other, see "Internal contradiction" below

## Summary

Invoked first try and returned a real, richly-shaped collection of 30 pre-existing custom fields, so the item shape was fully checkable. **Two declared types are wrong, a declared enum is wrong for 2 of the 5 observed values, and one field comes back undeclared.**

No declared field was *missing* — every promised key was present on every row, and the `info` pagination envelope matched exactly.

## Declared contract

Read, entity `custom_field`. **No `path_params`, no `body`, and no project or workspace identifier at all** — query only:

| param | declared |
| --- | --- |
| `p` | page, default 1 |
| `count` | page size, default 30, max 300 (the spec *text* claims 100 while the constraint enforces 300 — see below) |

This confirms custom fields are **account-level, not project- or folder-scoped**, so the fixture pool was irrelevant here and went untouched. `setup[]` is empty.

## Actual behaviour

`query: {p:1, count:300}` → **200**, 30 rows, `info: {count:30, page:1, page_size:300, prev:null, next:null}` (single page). Matches the earlier observation that system template 1164 carries 30 custom field ids.

### Drift 1 — `id` declared string, returned integer

Declared as a string in the form `cf-123`. Actually a bare JSON integer, e.g. `105921`.

### Drift 2 — `group_id` declared string, returned integer

Actually a bare JSON integer, e.g. `3452` — identical across all 30 rows, so this workspace has one group.

### Drift 3 — `field_type` enum is wrong for 2 of 5 observed values

| declared enum | actually observed |
| --- | --- |
| `text`, `textarea`, `dropdown`, `multiselect`, `number`, `date`, `boolean`, `url` | `string`, `dropdown`, `multi_dropdown`, `url`, `date` |

- `dropdown`, `url`, `date` — match.
- **`string`** is returned where the enum declares **`text`**.
- **`multi_dropdown`** is returned where the enum declares **`multiselect`**.

An agent filtering or branching on the declared tokens would silently miss every field of those two types. Note the *create* capability (`create_custom_field`) declares its own `field_type` values as `string, text, user, dropdown, multi_dropdown, url, boolean, int, date, nested_dropdown` — which uses `string` and `multi_dropdown`, i.e. the **actual** vocabulary. So the read capability's enum is the odd one out, and the correct token set is already documented elsewhere in the same index.

### Drift 4 — undeclared `placeholder`

Every row carries `placeholder`, a duplicate of the declared `place_holder_text` with the same value. Never mentioned in the contract's item schema.

**This is not isolated:** `get_custom_field` returns the same undeclared `placeholder` alongside `place_holder_text`. Two capabilities, same duplicated-and-undeclared key — this looks like a shared serializer, so the fix belongs at that level rather than per-capability.

## Internal contradiction with `get_custom_field`

The two sibling contracts state **opposite** things about the same field:

| | `id` |
| --- | --- |
| `list_custom_fields` declares | string, form `cf-123` |
| `get_custom_field` declares | integer — and explicitly says the published spec's `cf-123` string form **is wrong** |
| reality | integer |

So the index already knows the right answer in one place while stating the wrong one in another. The same applies to the `field_type` enum. Whatever produced the `list` entry appears to have been generated from the published spec, while the `get` entry was corrected against reality — worth checking whether other `list_*` entries inherited the same stale spec.

## Confidence and limits

30 rows on a single page, all consistent. Not tested: pagination beyond page 1 (only one page exists), and the documented `count > 300` refusal. The spec-text-vs-constraint discrepancy on `count` (100 vs 300) was noted from the contract but not exercised.

Nested structures (`options` / `datasets` / `levels`) did not appear — **expected, not drift**: the guidance says option values are read separately via datasets.

## Field ids recorded for reuse

Handed to the sibling `get_custom_field` probe: `multi_dropdown` 105921 and 105914; `dropdown` 105920, 105915, 105911, 105898, and 103927 ("Template Platform", `linked_projects_count` 912 — a useful outlier for linked-project behaviour); plus `string`/`url`/`date` examples and one `is_required: true` example, 104785.

## Index actions proposed

1. **Correct `id` to integer** and drop the `cf-123` form — `get_custom_field` already documents this correctly.
2. **Correct `group_id` to integer.**
3. **Fix the `field_type` enum** to the real vocabulary (`string`, `multi_dropdown`, … as `create_custom_field` already lists).
4. **Declare `placeholder`**, or remove it from the serializer as a duplicate of `place_holder_text` — coordinate with `get_custom_field`.
5. **Reconcile the `count` ceiling** between the spec text (100) and the enforced constraint (300).
6. **Audit other `list_*` v2 entries** for the same stale-spec inheritance.

All are index-side documentation defects. None prevent the capability being used, but 1–3 would each break a typed client.
