# verify_test_case_tags — BLOCKED

- **Product / entity:** tm / `tag` (declared `mode: read`)
- **Path:** `POST /api/v1/projects/{project_id}/test-cases/tags/verify` (a read that takes a body)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — 5 attempts
- **Run file:** `tests/live/runs/tm/verify_test_case_tags.json`

## Summary

**Every invocation returned HTTP 500, on every payload tried — including the empty list the contract explicitly says is valid.** A control call to a sibling capability against the identical `project_id` succeeded, so this is not an outage, not a bad fixture id, and not payload-dependent.

## The name is misleading, and that is worth fixing independently

Despite being called `verify_test_case_tags`, **this capability is not scoped to a test case at all** — its contract has no `case_id` / `test_case_id` parameter anywhere.

What it actually does, per the contract: take a **list of tag wordings you supply** and check them against every tag already used on the *project's* test cases, returning two buckets — `tags` (wordings not yet in use) and `error_tags` (wordings already in use) — plus an advisory `error` message and a `success` flag that is `false` only when *none* of the submitted wordings were new.

So it is a **project-wide tag-vocabulary lookup keyed by wordings**, not a per-case check. An agent reading the name would reach for it to answer "what tags does this case have?" and would be reaching for the wrong thing. That is a discoverability defect regardless of the 500.

Declared `mode: read` **does** match the declared effect ("nothing is saved by this check") — no mode/effect mismatch here, unlike batch 2's `update_custom_field`.

## Declared contract

| param | where | declared |
| --- | --- | --- |
| `project_id` | path | **integer** (required) — confirmed correct; `PR-2005` is rejected client-side with `'project_id' must be a number` |
| `tags` | body | array of strings (required), **flat top-level** — no `test_case` wrapper, unlike the update/edit routes |

The contract explicitly states an empty `tags` array is valid and "simply reports nothing new."

## Attempts

| # | `project_id` | body | result |
| --- | --- | --- | --- |
| 1 | `379335744` | `{"tags":["__mcp-probe-tag-20260918a","__mcp-probe-tag-20260918-new"]}` — one known-used tag + one new | **500** `{"status":500,"error":"Internal Server Error"}` |
| 2 | `379335744` | identical retry | **500** — not transient |
| 3 | `"PR-2005"` | same body | rejected client-side: `'project_id' must be a number` — confirms the declared integer type is right |
| 4 | `379335744` | `{"tags":[]}` — the contract's own documented valid empty case | **500** |
| 5 | `379335744` | `{"tags":["smoke"]}` — an ordinary plausible tag | **500** |

## Why this is BLOCKED and not a payload or environment problem

The setup work makes this unusually well-controlled:

1. **A real tag was created first, not invented.** `update_test_case` applied disposable tag `__mcp-probe-tag-20260918a` to scratch case `TC-54457` (int `1972036`) in `__scratch__` folder `764138` — 200, confirmed on the case.
2. **The tag was confirmed to be in the project's vocabulary.** `list_test_case_tags` on project `379335744` returned it (count 1).
3. **That sibling call is the control.** It returned **200 against the identical `project_id`** moments before. So preprod was up, the project id was valid and resolvable, and credentials were fine. The fault is specific to this capability's own handler.
4. **The failure is payload-independent.** It fails on the documented-valid empty array, on an ordinary tag wording, and on the probe's own real tags alike. There is no shape of input that succeeds.
5. **The declared integer `project_id` is correct**, so this is not the v1/v2 id-form confusion that has bitten other capabilities in this suite.
6. **The error is not the outage signature.** `{"status":500,"error":"Internal Server Error"}` is distinct from the `"the product could not be reached"` message preprod emitted during its outage earlier the same day.

## Pattern worth flagging

This is the **second** capability in this suite to fail with a bare, payload-independent 500 that does not match its own declared error schema — the first was `get_test_case_linked_issues` (batch 1, `GET /api/v1/integrations/{issue_type}/test-case/results/{test_case_id}`). Both are **v1 routes on phase-2 entities**, both return a bare `{"status":500,"error":"Internal Server Error"}` with no application error body, and both fail regardless of input. Whether they share a root cause is unknown from here, but they are worth investigating together rather than as two isolated tickets.

## What this evidence cannot settle

No backend source or server-side logs were consulted, so **why** the handler crashes is unknown. What is established is narrower and sufficient: the capability cannot be invoked successfully through its documented surface, and the cause is not on the caller's side.

Because no call returned 200, **no field-level declared-vs-actual diff was possible.** `probe.status` is null and `declared_missing` / `undeclared_returned` are deliberately empty rather than guessed — the declared 200 shape (`tags`, `error_tags`, `error`, `success`) remains entirely unverified.

## Suggested next step for the product team

Server-side logs for `POST /api/v1/projects/379335744/test-cases/tags/verify` on preprod at the probe timestamp, with body `{"tags":[]}` — the simplest reproducing case. Compare against the successful `list_test_case_tags` call on the same project in the same window; the diff between those two handlers should localise it quickly. Worth diffing against `get_test_case_linked_issues`'s stack trace too, given the shared signature.

## Index action

**None on the 500 — do not edit the contract on this evidence.** The parameter declarations were all confirmed correct by the probe, and the response shape cannot be assessed until the endpoint works.

**One index change is warranted independently:** the capability's name and intent should make clear it is a **project-wide tag-wording lookup**, not a per-test-case check. Nothing about `verify_test_case_tags` suggests "give me a list of tag names and I will tell you which are already in use in this project."

## Residue

Tag `__mcp-probe-tag-20260918a` now exists project-wide on `PR-2005` / `379335744`, applied to scratch case `TC-54457`. Tags are account-scoped, so this persists. It is deliberately disposable and is the intended subject for the `update_tag` probe, which needs a tag of known fixture provenance.
