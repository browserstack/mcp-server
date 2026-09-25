# create_test_case — DRIFT (low severity; the twin defect is ABSENT)

- **Product / entity:** tm / `test_case` (write)
- **Path:** `POST /api/v2/projects/{project_id}/folders/{folder_id}/test-cases`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18
- **Run file:** `tests/live/runs/tm/create_test_case.json`

> **Verdict re-classified by the orchestrator** from the probing subagent's `PASS` to `DRIFT`, for consistency: a non-empty `declared_missing` has been DRIFT four times already in this suite. The severity here is genuinely low and the headline result is positive — read both parts.

## Headline: the twin defect is not present

This capability was probed specifically because `create_root_folder` shipped **broken for its entire published life** — declaring a flat `{name}` where the API required `{folder:{name}}`.

**`create_test_case` does not reproduce that.** Several things went right, and they are worth recording so nobody "fixes" a correct contract:

- **The declared flat body worked on the first real attempt.** `body {name, test_case_steps:[{step,result}], priority, tags}` → 200.
- **Its `json_path` (`/test_case/<field>`) is honest internal wire-mapping metadata**, and — unlike five siblings in this suite — **its guidance never tells the caller to replicate the wrapper.** That is the correct treatment of `json_path`, and this capability is a good reference for what the others should look like.
- **The flat `returns` array and the nested per-field schema AGREE** — genuinely unusual in this batch, where that disagreement has been the most common defect.
- **`urls` is properly declared** as a `{self}` object rather than the bare `{type: object}` seen across the plan and run families.
- **No undeclared fields were returned.**

## The drift — `attachments` declared but absent

`attachments` is declared as a returned array. On the created case the key is **absent entirely** — not `[]`.

Severity is low, and "omitted when empty" is the plausible reading. But it has a concrete consequence: an agent that does `test_case.attachments.length`, or iterates it, gets a **TypeError** rather than an empty loop. A declared array that is sometimes not there at all is worse for a caller than one that is always `[]`.

**Resolved — this create response is the outlier (added 2026-09-18).** The sibling `get_test_case` probe checked the same field on **both** `TC-54458` and the older `TC-54455` and got an explicit **`[]`** in each case. So "declare an array, then omit the key when empty" is specific to this create endpoint, not a house convention across the test_case family. The read is the conventional one, which makes the create the thing to fix.

## The numeric id is not a field — again

`TC-54458`'s numeric id `1975349` appears **nowhere** in the create response. It was recoverable only from the trailing path segment of `test_case.urls.self` (`.../folder/764138/test-cases/1975349`), then independently confirmed via `list_folder_test_cases`.

This is the same shape of problem as the test_plan family, where the numeric id was likewise only parseable out of `urls.self`. Since several **v1** capabilities require the numeric id, an agent that creates a case through v2 and then needs a v1 capability has to string-parse a URL to proceed. Worth documenting explicitly in the contract — the test-plan *read* contract does state this honestly, and that wording is a good model.

## A cross-capability discrepancy, correctly not blamed on this capability

The v2 create response reported `status: "Active"` and `case_type: "Other"`, while a `list_folder_test_cases` read of **the same row** returned `status: null` and `case_type: null`.

The probing agent attributed this to the v1 listing's own default column selection (it likely needs `required[fields]`) rather than treating it as a create-side drift — the right call, since it is a different capability's read defaults and not a re-derivation of the create response. **The `get_test_case` probe was asked to settle it**: if the v2 read returns those fields populated, the v1 listing's nulls are its own projection default; if it also nulls them, something more interesting is happening.

Recording it here because, if it turns out to be real, it would be a **fifth** instance of one value differing by endpoint — after `is_dynamic` (bool/bool/int across three capabilities), `cases_count`, and `projectVisibilityBanner`.

## Verified against storage

Re-read via `list_folder_test_cases` (project integer `379335744`, folder `764138`): the row for `1975349` / `TC-54458` was present with matching name, folder, `template_id: 1164`, tags and `step_count: 1`. Not trusted from the response echo. Global search was not used (≥6-day indexing lag).

Also confirmed: the v2 route rejects the bare integer project id client-side (`'project_id' must match ^PR-\d+$`), exactly as declared.

## Index actions proposed

1. **Declare `attachments` as optional / "omitted when empty"**, or have the endpoint return `[]`. Returning `[]` is the friendlier fix.
2. **Document that the numeric id is not returned** and that it must be parsed from `urls.self` if a v1 capability needs it — mirroring the honest wording the test-plan read contract already uses.
3. **Leave the body shape and `json_path` handling alone** — they are correct, and this capability is the best example in the batch of `json_path` documented without misleading the caller into wrapping.

## Residue

Test case **`TC-54458`** (numeric `1975349`) in `__scratch__` folder `764138`. Three sibling probes in this batch operate on it; it will end the batch moved and updated.
