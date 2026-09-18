# update_tag_v1 — DRIFT (and a hollow declared response)

- **Product / entity:** tm / `tag` (write)
- **Path:** `PUT /api/v1/projects/{project_id}/tags/{id}`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/update_tag_v1.json`
- **Related:** `findings/get_custom_field_v2.md` — same defect shape, same verdict basis

> **Verdict re-classified by the orchestrator** from the probing subagent's `PASS` to `DRIFT`. Its evidence is accepted unchanged; only the label is corrected, so this batch stays comparable with batch 2, where `get_custom_field_v2` was called DRIFT on exactly this basis.

## Summary

**The write works correctly and was verified in storage.** The drift is in the declared response: the contract commits to almost nothing, and what does come back includes four fields it never mentions.

## The declared response is nearly empty — so a PASS here would be hollow either way

The declared 200 is literally `{"type": "object"}` with **no properties**, plus an informal `returns` hint of `["id", "name"]`. Nothing is formally typed.

This is the hollow-contract case flagged since batch 1 (`get_lcnc_user_test_config_v1`), and it is worth stating plainly: **a contract that promises two informally-hinted fields cannot meaningfully fail a conformance check.** The probing agent described the declared shape as "thin/hollow by itself" and was right to.

## The drift — four undeclared fields

Actual response keys:

```
id, name, group_id, color_preset, created_at, updated_at
```

| field | status |
| --- | --- |
| `id`, `name` | declared (informally) and present ✅ |
| `group_id` | **undeclared** |
| `color_preset` | **undeclared** |
| `created_at` | **undeclared** |
| `updated_at` | **undeclared** |

`declared_missing` is empty. Six real fields came back against two informally hinted ones — so two thirds of the response is undocumented, including `color_preset`, which is a user-visible property an agent might well want to read or preserve.

## What the probe genuinely established — the write is sound

None of this is in doubt, and it is the more reassuring half of the result:

- **`project_id` is the integer form** (`379335744`), **not** `PR-NNN` — correctly declared.
- **`id` is the tag's own numeric id**, which must be resolved from a listing rather than passed as a name — correctly declared.
- **No `json_path` is declared at all**, and the flat body worked first try, consistent with the surface convention documented in `findings/create_folder_v2.md`.
- **The rename landed in storage**, verified by re-reading `list_tags_v3` *and* `list_test_case_tags_v1`: old wording gone, new wording present, count unchanged at 1.
- **The tag stayed attached to its test case.** Re-reading `get_test_case_tags` on scratch case `1972036` (`TC-54457`) showed the tag still attached under its new wording. A rename that silently detached tags from cases would have been a serious finding; it does not.

## Subject provenance — why this was safe to mutate

Tags are **account-scoped shared state**, and a sibling probe established that the account holds **120 pre-existing tags** (60 `test_case` + 60 `test_run`), none of which belong to this fixture. Mutating any of those would have been out of bounds.

The subject here was created by this suite: tag `__mcp-probe-tag-20260918a`, applied by the `verify_test_case_tags_v1` probe to scratch case `1972036` via `update_test_case_v2`. Before renaming, the probe resolved its id (**541004**) from `list_tags_v3` — not invented — and confirmed via `get_test_case_tags` that it was attached to that scratch case, positively identifying it as fixture-created. Renamed to `__mcp-probe-tag-20260918a-renamed`.

## A prior discrepancy, resolved

Two concurrent sibling probes had disagreed about the fixture project's tag count — `list_test_case_tags_v1` reported 1, `list_tags_v3` reported 0. This probe re-checked both capabilities **sequentially**, before and after the rename, and they agreed every time (count 1, correct wording).

**Conclusion: that was a timing race between concurrently-running probes, not an under-report by `list_tags_v3`.** Worth recording, because the alternative would have been a significant finding against `list_tags_v3` and it would have been wrong to file it.

## Side finding — not this capability

While resolving that discrepancy, the probe found that **`list_test_case_tags_v1` with a non-blank `q` query param returns a genuine `{"status":500,"error":"Internal Server Error"}`**, reproduced twice, on this project. The same capability with `p` instead of `q` works fine, so it is the search branch specifically. This is **not** the `"the product could not be reached"` outage signature.

`list_test_case_tags_v1` is not in any batch of this suite, so it is unprobed and uncharacterised — flagging it here so it is not lost. It is the **third** bare-500 in the suite, after `test_case_results_v1` (batch 1) and `verify_test_case_tags_v1` (this batch), and all three are v1 routes.

## Index actions proposed

1. **Declare the response shape properly.** Replace the empty `{"type":"object"}` with the real fields: `id`, `name`, `group_id`, `color_preset`, `created_at`, `updated_at`. As written, the contract tells an agent almost nothing about what it gets back.
2. **Document `color_preset`** in particular — it is a user-visible property and an agent renaming a tag may need to know it exists and is preserved.
3. **Record the verified good behaviour** in the guidance: a rename preserves tag→test-case attachments. That is exactly the reassurance an agent needs before calling a write on shared, account-scoped state.
4. Consider whether the hollow `{"type":"object"}` pattern appears on other tag capabilities — `list_tags_v3` has the same empty declared 200 and was marked UNVERIFIED this batch, which suggests it is a family-wide gap rather than a one-off.

## Residue

Tag **`__mcp-probe-tag-20260918a-renamed`** (id `541004`) exists account-wide and remains attached to scratch case `TC-54457`. Tags cannot be deleted through this surface (no tag-delete capability was found; only `merge_tags_v1` and `update_tag_v1` exist), so this persists as fixture residue.
