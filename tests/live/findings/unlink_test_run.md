# unlink_test_run — DRIFT

- **Product / entity:** tm / `issue` (write)
- **Path:** `POST /api/v1/integrations/{issue_type}/unlink-test-run`
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-17
- **Run file:** `tests/live/runs/tm/unlink_test_run.json`

## Summary

**The capability works, and its declared success shape is exactly right — but its documented default call silently fails.** Following the guidance as written produced a false "nothing to unlink" result twice against a link that was verifiably present. The call only succeeded once an optional parameter the guidance tells you to omit was supplied.

## Declared contract

- **Path param:** `issue_type` — required, closed enum (`jira-app|azure|asana|linear|clickup|confluence|figma|devrev|gitlab|github|custom|trello`). `jira-app` normalises to `jira` server-side.
- **Body:** flat, no `json_path` nesting — `test_run_id` (int, required), `project_id` (int, required), `issue_id` (string — echoed, but **not** used to select which link is removed), `build_id` (int, **optional**), `p` (int, optional).
- **Declared 200:** `{success, test_runs[], info{page,page_size,count,prev,next}}` — the refreshed list of runs still linked to the ticket.
- The contract notes that failures **also** return HTTP 200, carrying `{success:false, status:404}`, so status code alone cannot distinguish them.

The guidance describes omitting `build_id` as **"the normal call"**, mentioning it only as relevant "for accounts on build-based run ingestion" — with nothing telling a caller how to detect that condition, nor what value to pass.

## Prerequisite and verification

- **Before:** `get_test_run_detail` (project `379335744`, run `TR-9061`) confirmed the link was live —
  `issues[0] = {id: 848917, issue_id: "TES-121", issue_type: "jira", entity_type: "Build", entity_id: 17574995, record_status: "active"}`
- **After:** the same read returned an empty `issues[]`. The link is genuinely gone — this was confirmed by re-reading, not inferred from a 200.

## Attempts

| # | body | result |
| --- | --- | --- |
| 1 | `build_id` **omitted** — the contract's documented "normal call" | `200 {success:false, status:404}` — despite the link being confirmed present moments earlier |
| 2 | identical retry, to rule out the transient-downtime caveat the contract itself raises | same `404` — **not** transient |
| 3 | `build_id: 17574995` added (inferred from the link row's `entity_type: "Build"` / `entity_id: 17574995`) | **`200 {success:true, test_runs:[], info:{page:1,page_size:10,count:0,prev:null,next:null}}`** |

## Why DRIFT rather than PASS

The end state is correct and the success response matched the declared schema exactly — no `declared_missing`, no `undeclared_returned`. The drift is in the **guidance**, and it is the dangerous kind:

- The documented default path returns `{success:false, status:404}` — a shape the contract itself admits is **indistinguishable** from "no such link exists" and from a platform-downtime window.
- A caller following the documentation would therefore conclude, wrongly and silently, that there was nothing to unlink — and would have no way to tell that conclusion was false.
- The parameter that actually makes the call work is documented as the one to leave out.

This is precisely the failure mode the guidance warns about, triggered not by downtime but by the contract's own recommended default.

## Caveat on `issue_id`

`TES-121` is the contract's **own documented example key**; no real Jira ticket exists in this account. This is acceptable here because `issue_id` is explicitly documented as echoed but **not** used to select which link is removed — the selection happened on `test_run_id`/`build_id`, both real. Still, treat any conclusion that depends on ticket-key semantics as **provisional**: this run cannot prove behaviour against a genuine tracker ticket.

## Index actions proposed

1. **Correct the guidance on `build_id`.** Either document how a caller determines that their account needs it (and what value to send — here it equalled the run's uuid `17574995`), or have the server resolve it. "Omit for the normal call" is actively wrong for this account.
2. **Flag the ambiguous failure shape.** Since `{success:false, status:404}` covers "no such link", "wrong build_id" and "downtime" alike, the guidance should tell callers to verify by re-reading the run's `issues[]` rather than trusting the response — which is what caught this.

Whether the underlying endpoint *should* need `build_id` at all is a product question, not an index one; the index defect is real regardless of how that is answered.
