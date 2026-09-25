# rename_folder — DRIFT (guidance falsified)

- **Product / entity:** tm / `folder` (write)
- **Path:** `PATCH /api/v2/projects/{project_id}/folders/{folder_id}`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/rename_folder.json`
- **Related:** `findings/create_folder.md`, `findings/unlink_test_run.md` (same verdict basis)

> **Verdict re-classified by the orchestrator** from the probing subagent's `PASS` to `DRIFT`. Its evidence is accepted unchanged; only the label is corrected. Batch 1's `unlink_test_run` was called DRIFT because its *guidance* was wrong despite a schema-conformant success response — the same reasoning applies here, and labelling this PASS would contradict that precedent.

## Summary

**The capability works and the response schema is flawless.** The drift is a claim the contract's own guidance makes about the request shape, which the probe tested and falsified — and following that claim would actively block an agent.

## The falsified claim

The guidance states, verbatim:

> "The body must contain a `folder` object (400 otherwise)"

**This is false.** The probe sent a **flat** body and got a clean 200 on the first attempt:

```
path_params: {project_id: "PR-2005", folder_id: 764827}
body:        {name: "__mcp-probe-folder-renamed-2026-09-18T05-00-00Z"}
```

The rename was verified in storage (below). No `folder` wrapper was needed, and no 400 occurred.

### Why this guidance is worse than merely inaccurate

An agent that **follows** this instruction never reaches the API at all. The sibling `create_folder` probe established that `invokeCapability` rejects a folder wrapper **client-side, before any HTTP call**:

```
unknown body: folder. accepted: attachments, description, name, parent_id
```

So the guidance sends a caller down a path that is blocked by the tool's own validator. It reads like a copy-paste from **`create_root_folder`** — the v1 capability that genuinely *did* require `{folder:{name}}` and was broken for its entire published life for declaring otherwise. The wrapper requirement has been transplanted onto a v2 capability that does not have it.

There is a neat irony worth recording: the v1 folder-create capability was broken because it declared flat and needed nested; this v2 rename capability is documented as needing nested when it is actually flat. **Same family, opposite error, both discoverable only by invoking.**

## Second gap — `name` declared required, actually optional

The body field `name` carries `required: true` in the contract but is **optional server-side**. Minor next to the wrapper claim, but it is another declared-vs-actual mismatch on the same capability.

## The response schema is clean

Stated plainly, to isolate the defect: **no drift in either direction** — `declared_missing: []`, `undeclared_returned: []`. Every declared field was present and correctly typed (`id`, `name`, `description`, `parent_id`, `cases_count`, `sub_folders_count`, `links.sub_folders`, `urls.self`), and `attachments` was correctly absent, which the contract documents as conditional.

## Verification — a real effect, not a hollow 200

`list_folder_contents` (integer project id `379335744`) was read on parent folder `764828` **before and after**:

- **before:** old name `__mcp-probe-folder-2026-09-18T04-31-22Z`, `parent_id` 764828
- **after:** new name persisted in both `folders[]` and `self.contents`, old name gone entirely, `parent_id` still 764828 — the rename did not move the folder

Global search was not used (≥6-day indexing lag on this environment).

## Third data point on the create-path null anomaly

`cases_count` and `sub_folders_count` both came back as real integers (`0`, `0`) — matching `move_folder`, **not** `create_folder`'s `null`.

That completes the picture across four surfaces for the same empty folder `764827`:

| surface | `cases_count` / `sub_folders_count` |
| --- | --- |
| `create_folder` | **`null`** ← outlier |
| `move_folder` | `0` |
| `rename_folder` | `0` |
| `list_folder_contents` | `0` |

The null is specific to the **create** path, which localises that fix to one serializer. See `findings/create_folder.md`.

## Not exercised

The `auto_rename` clash-handling branch — no name collision arose, so the documented "lowercase and append ` (1)`" behaviour is unverified. Worth a follow-up, since it is the only branch where `auto_rename`'s literal-`true`-only semantics would show.

## Index actions proposed

1. **Delete the "body must contain a `folder` object" guidance line.** It is false, and it routes an agent into a client-side rejection. Highest priority here.
2. **Audit the rest of the folder family for the same copy-paste.** The line almost certainly came from `create_root_folder`; anywhere else it was pasted, it will be equally wrong on a v2 route.
3. **Correct `name` from required to optional**, or make the endpoint enforce it.
4. Consider documenting the `auto_rename` clash behaviour more precisely once someone exercises it.

No change needed to the declared response shape — it is accurate.
