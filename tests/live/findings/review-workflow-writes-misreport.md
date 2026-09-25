# The review workflow: one input silently dropped, one verdict silently not applied

- **Product:** tm · **Capabilities:** `submit_test_cases_for_review`, `apply_test_case_review_verdict`
- **Environment:** **PRODUCTION**, `Demo Project 1` (332537), 2026-09-22
- **Status:** for the product team. Both contracts are correct — this is behaviour.

## Why this was only findable on production

Both capabilities sat UNVERIFIED for the whole campaign because the preprod fixture answers
`400 {errors:"Please enable review approve feature from project settings page"}` — the feature
is off there. **Production has it on.** The contracts were never wrong; the environment simply
could not exercise them.

Probed against a case this campaign created for the purpose (`TC-6272345`,
`__mcp-probe-prod-review-20260922-170927`), not against existing demo content.

## 1. `submit_test_cases_for_review` — `reviewers` is accepted, echoed, and discarded

Sent exactly what the contract asks for: the **internal** TM user id (`87158`), which the field's
own description is explicit about ("not browserstack_user_id, not email").

| | |
| --- | --- |
| request | `{test_case: {ids: [...], review_status: "in_review", reviewers: [87158]}}` |
| response | `200 {success: true}` — and `testCases[0].reviewers` is the **fully expanded user object** for 87158 |
| stored state, read back 4× | `reviewers: []` |

`review_status` is applied correctly: the case moves `pending` → `in_review` and stays there. So
the call is not a no-op — **one field of it is**, and the response actively confirms the field
that was dropped. A caller checking its own response sees the reviewer assigned.

## 2. `apply_test_case_review_verdict` — `success: true` for a verdict that never lands

| | |
| --- | --- |
| request | `{test_case: {ids: [...], review_status: "approved"}}` |
| response | `200 {success: true, testCases: [...]}` |
| **`review_status` inside that same response** | **`"in_review"`** |
| stored state, read back 4× over ~12s | `in_review` |

This one fails differently, and the difference matters. The response body is **internally
honest** — it reports `in_review`, which is the truth. It is the `success: true` envelope that
misleads. An agent that branches on `success`, which is the documented way to branch, concludes
the case was approved. An agent that instead reads the returned row gets the right answer.

The preconditions were met: the case was in `in_review` when the verdict was sent, which is what
the capability's own guidance requires ("Every selected case must currently be 'in_review'").
When that precondition genuinely was not met — the earlier attempt from `pending` — the endpoint
returned a clean, accurate `422 invalid_review_state` with a readable message. **So the endpoint
can reject properly. It just does not do so here.**

## What is NOT wrong

Worth stating, because it narrows the search: the index needs no change for either capability.
`json_path: /test_case/ids` correctly declares the wrapper the server wants, `returns` correctly
carries the camelCase `testCases`, and the guidance predicted both the feature-flag 400 and the
`invalid_review_state` 422 verbatim. Everything the contract promises about shape is true.

## Suggested next step

For (1): whether `reviewers` is being read from a different key, or dropped by the replace the
field description mentions ("it is forwarded to the backing store as a replace").

For (2): whether `success` is set before the verdict transaction is attempted. The response
already carries the real post-state, so the row and the envelope are computed from different
things — that is the seam to look at.

## Residue

`TC-6272345` in folder 9697326 ("MCP Testing") of project 332537, left in `in_review`. It is a
probe case created for this test and is safe to delete; the destructive tier is refused through
this surface so it could not be cleaned up automatically.
