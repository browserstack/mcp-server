# create_folder — DRIFT

- **Product / entity:** tm / `folder` (write)
- **Path:** `POST /api/v2/projects/{project_id}/folders`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/create_folder.json`

## Headline: the v2 twin does NOT share the v1 defect

This capability was probed specifically because its v1 counterpart, `create_root_folder`, was **published broken for its entire life** — declaring a flat `{name}` body while the API required `{folder:{name}}` (fixed in index v1.11).

**`create_folder` does not have that defect.** Its declared parameter names — `name`, `description`, `parent_id`, `attachments` — are exactly what the surface accepts, and a folder was created successfully and verified. That is the primary result and it is good news.

The DRIFT verdict rests on a **separate, narrower response-type violation** (below), not on the body shape.

## The genuine drift — declared non-nullable integers return null

The create response declares `cases_count` and `sub_folders_count` as **non-nullable integers**. On the freshly created folder, **both returned `null`**:

```json
{"success":true,
 "folder":{"id":764827,"name":"__mcp-probe-folder-2026-09-18T04-31-22Z",
           "parent_id":764138,"description":null,
           "cases_count":null,"sub_folders_count":null,
           "links":{"sub_folders":"..."},"urls":{"self":"..."}}}
```

Worse, **two endpoints disagree about the same folder.** Re-reading folder `764827` via `list_folder_contents` moments later reported `cases_count: 0` and `sub_folders_count: 0` — not null. So the same empty folder is represented two different ways depending on which endpoint answers, and the create response violates its own declared type.

A typed client that trusts the declaration will crash or mis-render on every newly created folder. This is the same family of defect as batch 1's `edit_project`, where `projectVisibilityBanner` came back `null` from the write and an object from the very next read.

### The anomaly is specific to the create path

A third data point narrows this usefully. The sibling `move_folder` probe returned the **same two fields on the same folder** (`764827`) and got real integers:

```json
{"id":764827,...,"parent_id":764828,"cases_count":0,"sub_folders_count":0,...}
```

So three surfaces disagree about one empty folder: **create → `null`**, **move → `0`**, **`list_folder_contents` → `0`**. The create response is the outlier, which points at the create serializer rather than a shared folder serializer — and means the fix is probably local to this endpoint.

Every other declared field (`id`, `name`, `description`, `parent_id`, `links.sub_folders`, `urls.self`) matched exactly, and nothing undeclared was returned.

## On `json_path` — a systemic surface convention, NOT a defect in this capability

The probing agent's first attempt took the contract's `json_path` values (`/folder/name`, `/folder/parent_id`, …) literally and sent `body: {folder: {name, parent_id}}`. `invokeCapability` rejected it **client-side, before any HTTP call**:

```
unknown body: folder. accepted: attachments, description, name, parent_id
```

Flattening to the fields' own declared names then succeeded.

**This is not drift in `create_folder`, and it should not be filed as such.** Evidence from across all three batches shows it is a consistent property of the invoke surface:

| capability | declared `json_path` | what happened |
| --- | --- | --- |
| `edit_project` (batch 1) | `/project/{field}` | agent passed **flat**, tool nested under `project` server-side → 200 |
| `create_template` (batch 1) | `none` | agent tried a `{template:{…}}` wrapper → same client-side rejection, `unknown body: template. accepted: …` |
| `create_folder` (batch 3) | `/folder/{field}` | nested rejected client-side; **flat** → 200 |

So `invokeCapability` always takes body fields **flat, under their own parameter names**, and applies the `json_path` mapping itself. `json_path` is server-side mapping metadata, not call-shape guidance.

**The real issue is presentational and applies to every capability with a `json_path`:** an agent reading the contract can reasonably read `/folder/name` as "nest this under `folder`", and one of three agents in this suite did exactly that, losing an attempt to it. Worth addressing once, at the surface level — either by renaming/annotating the field, or by having `describeCapability` state the calling convention explicitly — rather than as a per-capability fix.

## Verification performed

- Folder **764827** created under `__scratch__` (`764138`), confirmed by re-reading `__scratch__` via `list_folder_contents`: the new folder appears as a child and the parent's `sub_folders_count` rose to 2.
- A second disposable folder, **764828** (`__mcp-probe-movetarget-…`), was also created under `764138` to serve as a move destination for the sibling `move_folder` probe.
- Global search was **not** used — this environment has a ≥6-day indexing lag, so a fresh folder would not appear and its absence would prove nothing.

## Confidence and limits

The null-vs-integer violation was observed on a single freshly created folder, but it is corroborated by the contradicting `list_folder_contents` read of that same folder, which makes a one-off fluke unlikely. Not exercised: `description` and `attachments` on create, nor creation at project root (no `parent_id`), so whether the counts behave differently there is unknown.

## Index actions proposed

1. **Declare `cases_count` and `sub_folders_count` nullable** on the create response, or fix the endpoint to emit `0` as the folder-listing endpoint already does. The two surfaces should agree.
2. **Do not change the body shape** — it is correct as declared. Record explicitly that the v2 route does not carry the v1 twin's nesting defect, so nobody "fixes" it into being wrong.
3. **Consider a surface-level clarification of `json_path`** (see above), since it cost a good-faith attempt here and in batch 1. This is a `describeCapability` presentation change, not a per-capability edit.
