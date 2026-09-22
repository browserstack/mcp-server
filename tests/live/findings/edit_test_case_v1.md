# `edit_test_case_v1` (tm, preprod) — live probe findings

Verdict: **DRIFT**. Case tested: TC-54484 (integer id 1985018), `__scratch__` folder 764138, project 379335744 / PR-2005. All calls made via `describeCapability` / `invokeCapability` only.

## 1. Decisive experiment — which field carries steps in, which field carries steps out

Declared body field for steps (`json_path: /test_case/test_case_steps`) says: *"The ONLY key the server reads for steps ... A differently named key such as `steps` is silently ignored."* There is also a legacy `steps` field (`json_path: /test_case/steps`) described as write-only-and-dangerous (a real JSON array wipes steps while returning 200).

**Request sent** (flat body, after also sending `template_step_type` per the contract's own warning that `template` defaults to `test_case_text` and would otherwise discard the steps):

```json
{
  "test_case_steps": [
    { "step": "Navigate to the probe login page (edited)", "result": "Probe login page renders with edited content", "order": 1 }
  ],
  "template_step_type": "test_case_steps",
  "priority": 318618
}
```

**Result:** accepted (200). On the edit response itself, and again on an independent read via `get_test_case_by_integer_id_v1`:

- `data.test_case.test_case_steps` → array containing the new step content (the field that actually carries the data).
- `data.test_case.steps` → `[]` (empty), both immediately and on the follow-up read.

**This is consistent with the earlier `create_test_case_v1` finding** — `test_case_steps` is the one field that round-trips content on both create and edit; the declared `test_case.steps` field is dead on both paths.

**New drift found here** that the create probe did not see: `edit_test_case_v1`'s declared 200 schema types `data.test_case.test_case_steps` as a single **object** (with `background`/`feature`/`hashed_id`/`order`/`result`/`scenario`/`step`/... as top-level properties). The actual field is always an **array** of such objects. This is a real type mismatch, not merely an empty-vs-populated difference — code written against the declared schema would try to read `test_case_steps.step` directly and get `undefined`.

## 2. Partial-update semantics — PUT or PATCH?

The task hypothesis (from the existence of a sibling `edit_test_case_partial_v1`) was that this path is a full destructive replace. **That is only half true.**

**Baseline** (before any edit): name `__mcp-probe-createcase-20260921`, priority Medium (318618), case_type Other (318626), status Active (318632), tags `["mcp-probe"]`, template `test_case_steps`, `template_id: 1164`, `template_name: "Test Case Steps"`, `history_count: 1`.

**Edit A** (decisive-experiment call above) omitted `name`, `case_type`, `status`, `tags`.
**Edit B** sent **only** `{"name": "__mcp-probe-createcase-20260921-edited"}`, omitting everything else — steps, priority, case_type, status, tags, template fields.

**Independent read-back after both edits** (via `get_test_case_by_integer_id_v1`, not just the edit response):

| field | survived omission? |
|---|---|
| `priority` (318618/Medium) | yes |
| `case_type` (318626/Other) | yes |
| `status` (318632/Active) | yes |
| `tags` (`["mcp-probe"]`) | yes |
| `test_case_steps` (set in Edit A) | yes — still present after Edit B |
| `template` / `template_step_type` | **no** — reset to `test_case_text` |
| `template_id` / `template_name` | **no** — reset to `null` / `null` |

**Verdict: mostly PATCH (partial merge), with one specific, undeclared destructive side effect.** Ordinary content fields (name, priority, case_type, status, tags, steps) survive being omitted from a request — this is NOT the naive full-replace-on-every-call behavior the sibling-capability name implies. But `template_id`/`template_name`/`template_step_type` get silently reset on **any** edit call that doesn't explicitly resend `template_id`/`template_step_type` — even an edit that only touches `name`. The underlying step *data* is not deleted (still returned in full), only the template/step-shape classification is downgraded. This is more specific and more accurate than the contract's own warning ("template defaults to test_case_text when omitted, which discards test_case_steps you sent") — the discarding claim is partly wrong (steps survive); what's actually lost is the template linkage.

**Recommendation for the contract text:** replace the "discards test_case_steps" framing with something like: *"Omitting `template_id`/`template_step_type` on ANY edit resets the case's template classification to `test_case_text`, independent of which fields you are actually editing — always resend the case's current template on every edit, not just ones that touch steps."*

## 3. Secondary drift observed

- **`field_name` missing on edit responses.** The declared schema for `case_type`/`priority`/`status` option objects includes `field_name`. It is present when the SAME case is read via `get_test_case_by_integer_id_v1` (`field_name: "category" / "priority" / "status"`), but **absent** from `data.test_case.case_type` / `.priority` / `.status` in both successful `edit_test_case_v1` responses observed. Edit-response-specific, not a general absence.
- **Undeclared `value_category`** appears on `case_type`, `priority`, `status` (all `null`) and `automation_state` (`"manual"`) in the edit response — not mentioned anywhere in the declared schema.
- **Transient null counts in the edit response.** `history_count`, `test_run_results_count`, `test_run_results_issues_count` come back `null` in the edit response body itself, but as real integers (3, 0, 0) on the very next independent GET. Not real data loss, but worth flagging so a null in the edit response isn't mistaken for a wipe.
- **Undeclared fields returned generally**: `automation_state`, `is_shared`, `template_step_type`, `template_id`, `template_name`, `test_run_results_count`, `test_run_results_issues_count`, `test_case_dataset` — none are in the declared 200 schema.

## 4. Wrapper trap — confirmed correct (no drift)

Contract guidance explicitly says the body must be sent flat and a nested `test_case` wrapper is rejected client-side. Verified:

Request: `{"test_case": {"tags": ["mcp-probe", "nested-wrapper-test"]}}`

Response: `unknown body: test_case. accepted: attachments, automation_state, ... test_case is a wrapper this surface builds for you from each field's json_path — send the fields directly instead of nesting them`

This matches the guidance exactly. Opposite of `create_test_case_v1` (nested required there); matches `create_test_plan_v1` (flat required). No drift on this specific point for `edit_test_case_v1`.

## Evidence

Full request/response trace, including the baseline read, both successful edits, the wrapper-trap rejection, and the final independent read-back, is in `tests/live/runs/tm/edit_test_case_v1.json`.
