# SYSTEMIC — declared error envelopes are not honoured by the API

- **Product:** tm
- **Scope:** **not one capability** — five capabilities across four entities, five batches
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`)
- **Consolidated:** 2026-09-18, after the third-plus independent instance
- **Supersedes** the per-capability write-ups of this issue in: `get_test_case_linked_issues.md`, `search_all_projects.md`, `list_exploratory_session_form_fields.md`, `update_test_case.md`, `verify_test_case_tags.md`

## The claim

**Every capability in this index declares 4xx/5xx response shapes, and on the evidence gathered so far an agent should not trust any of them.** Five capabilities were observed failing, and **not one** returned the envelope it declared.

This is filed as a single finding rather than five tickets because the fix is one decision, not five.

## The evidence

| capability | entity | status | declared envelope | actual body |
| --- | --- | --- | --- | --- |
| `get_test_case_linked_issues` | issue | **500** | `{success:false, error:{code,message}}` | `{"status":500,"error":"Internal Server Error"}` |
| `verify_test_case_tags` | tag | **500** | `{success:false, error:{code,message}}` | `{"status":500,"error":"Internal Server Error"}` |
| `search_all_projects` | project | **400** | `{success:false, error:{code,message,details}}` | `{"error":"No entities provided for search"}` |
| `list_exploratory_session_form_fields` | exploratory_session | **404** | `{success:false, error:{code,message,details}}` | `{"success":false}` |
| `get_exploratory_session` | exploratory_session | **404** | `{success:false, error:{code,message,details}}` | `{"success":false}` — confirmed 2026-09-21 re-probe, see `runs/tm/get_exploratory_session.json` |
| `update_test_case` | test_case | **400** | `{success:false, error:{code,message,details}}` | `{"success":false,"message":"updated_at must be greater than or equal to current time"}` |
| `submit_test_cases_for_review` | test_case | **400** | `{success:false, error:{code,message,details}}` | `{"errors":"Please enable review approve feature from project settings page"}` |
| `apply_test_case_review_verdict` | test_case | **400** (status itself *is* declared) | `{success:false, error:{code,message,details}}` | `{"errors":"Please enable review approve feature from project settings page"}` — **identical shape and text** to the row above |
| `generate_test_case_automation` | test_case | **422** — *not in the declared set at all* | declared set is 200/400/401/403/404/451/500 | `{"success":false,"message":"{\"message\":{\"title\":\"Internal Error\",\"message\":\"undefined method `[]' for nil:NilClass\"}}"}` |
| `get_test_run_progress` | test_run | **404** (unknown run id) | `{success:false, error:{code,message,details}}` | `{"success":false,"message":"Test Run ID is invalid. Please enter valid Test Run ID and try again"}` |

Ten capabilities, six entities, four distinct status codes (400/404/422/500), and **six different actual body shapes** — none of which is the declared one. (`get_exploratory_session` added 2026-09-21 on re-probe: byte-identical to its sibling `list_exploratory_session_form_fields` row, same entity, same bare-`{success:false}` shape.)

### A withdrawn instance, and why it matters

A tenth instance was briefly recorded here — `get_test_run` returning HTTP 500 with a literal `null` body when passed `minify=true`, reproduced 2/2 — and was **withdrawn on re-test**: the orchestrator re-ran it and got 200. A sibling probe had meanwhile hit three consecutive null-body 500s on unrelated, already-trusted calls, so the original pair was a **preprod flakiness burst** that happened to land on those two requests.

It is recorded here rather than silently deleted because it sets a standard for this finding: **on an environment that fails in bursts, a 2-of-2 reproduction is not enough.** Every row in the table above is either reproduced more than twice, accompanied by a successful control call in the same window, or a deterministic validation/gate response rather than a server fault — and the two 500-class entries (`get_test_case_linked_issues`, `verify_test_case_tags`) each survived 3–5 varied attempts plus a passing control on the same project.

### The shapes look per-controller-family, not per-endpoint

The last two rows are the first **repeat** of a shape across two different capabilities: `submit_test_cases_for_review` and `apply_test_case_review_verdict` return byte-identical `{errors:"Please enable review approve feature from project settings page"}` bodies. Both are review-workflow capabilities, which suggests the actual error shape is a property of the **controller family** rather than of each endpoint.

That is encouraging for the fix: if shapes cluster by family, correcting them is a per-family job rather than 242 individual edits. It also means a sampling sweep (below) would generalise usefully — one observation per family, not one per capability.

### Two instances are a different and worse kind

The last two rows are not merely shape mismatches:

- **`submit_test_cases_for_review` uses the key `errors` (plural)**, where every other variant uses `error` or `message`. So even a caller who gave up on the declared envelope and defensively probed for `error`/`message` would still miss this one.
- **`generate_test_case_automation` returns a status code that is not in its declared set at all** (422 against a declared 200/400/401/403/404/451/500), and its body carries a **leaked server-side exception** — `undefined method '[]' for nil:NilClass` — double-JSON-encoded inside a `message` string. That is an unhandled Ruby `NoMethodError` reaching the caller verbatim. Beyond the contract question, **a raw stack-level error leaking through a public API surface is a product issue in its own right** and should go to the product team independently of anything the index says.

## What the pattern is, and what it is not

An earlier hypothesis was that this clustered on **integration- or tracker-scoped routes** (`/integrations/{issue_type}/…`). **That is wrong** — only `get_test_case_linked_issues` is tracker-scoped. The other four are ordinary project-scoped routes.

Nor is it about 500s specifically: the set spans 400, 404 and 500.

What the instances actually share is narrower and more consequential: **the declared error shapes appear never to have been validated against the API at all.** They look like a house template applied uniformly at authoring time. Where a capability's *prose* describes the real error behaviour it is sometimes correct — but that makes the contract **self-contradicting**, because its own machine-readable schema says the opposite two fields away. Two clean instances of this "prose right, schema wrong" split:

- **`search_all_projects`** — guidance accurately warns of "a bare `error` message with no `success` key"; its declared 400 schema says `{success:false, error:{code,message,details}}`.
- **`apply_test_case_review_verdict`** — its prose **predicts the observed gate body verbatim**, while its formal JSON schema declares the enveloped shape.

This is worth noting for whoever does the fix: in these cases the correct information already exists in the index, in the wrong field. The schemas could in principle be repaired *from* the prose rather than from fresh observation.

## Why this matters more than a typical drift

The declared envelope is what an agent branches on:

- An agent checking `response.success === false` mis-handles `search_all_projects`'s 400 (no `success` key at all).
- An agent reading `error.code` gets `undefined` on **all five**.
- An agent reading `error.message` for something to show a user gets `undefined` on all five, even where a perfectly good message exists under a different key (`message` on `update_test_case`, `error` as a bare string on `search_all_projects`).

So error handling written against this index fails in exactly the moment it is needed. And unlike a missing success field, this is invisible until something goes wrong in production.

## A near-instance that does NOT count — and why that matters

`list_test_case_comments` (batch 7) returned a bare `{"success":false}` on a 404 against a nonexistent test case — the same shape as `list_exploratory_session_form_fields` in the table above. **It is deliberately excluded**, because in *this* capability's declared 400/404 schemas neither `success` nor `error` is marked required, so a bare `{"success":false}` **conforms**.

Two reasons to record the exclusion rather than quietly drop it:

1. **It keeps the table honest.** Every row above is a genuine violation of that capability's own declaration, not merely a body that looks thin.
2. **It reveals the opposite failure mode.** Where most capabilities here **over**-declare their errors (promising an envelope nothing returns), this one **under**-declares — its error schema is loose enough that almost anything conforms. So "the declared error shapes are unreliable" cuts both ways: some assert structure that does not exist, others assert so little that conformance is meaningless. A fix that only corrects the over-declared cases would leave the under-declared ones equally useless to an agent.

## Scale is unmeasured — and cheap to measure

Five capabilities were observed failing because they happened to fail during probing. **No capability has been observed honouring its declared error envelope**, but absence of a counter-example across five is not proof about the other ~237.

**A targeted batch would settle it far more cheaply than the per-capability probing that surfaced it.** Pick one documented error per capability across a spread of entities — a missing required param, a bad id, a non-enum value — fire it deliberately, and diff the body against the declaration. That is one call per capability, needs no fixture writes, and would establish whether this is universal or clustered. On yield per call it is better than most of what remains in the test plan.

## Actions proposed

1. **Decide the direction first.** Either the API standardises on the declared envelope, or the index is corrected to the real shapes. Right now the index asserts a shape that, as far as this suite can tell, nothing returns.
2. **If the index is to be corrected**, note that the real shapes are not uniform either — at minimum `{status, error:<string>}`, `{error:<string>}`, `{success:false}`, `{success:false, message:<string>}` and `{errors:<string>}` all occur, and at least one capability returns a status code outside its own declared set. A single replacement template would be wrong in a new way; the shapes need to come from observation.
3. **Until it is fixed, add a guidance warning** that error bodies do not match the declared schemas and that callers should not branch on `error.code`.
4. **Resolve the self-contradictions** where prose and schema disagree within one capability (`search_all_projects` is the clearest case) — those are cheap wins and actively misleading today.
5. **Run the error-envelope sweep** described above to size the problem.

## Caveats

- **Preprod only.** Production may differ, and any of these could be environment-specific. Every observation here is from `test-management-preprod.bsstag.com`.
- **No backend source or server-side logs** were consulted, so *why* the envelopes diverge is unknown. What is established is only the request/response evidence above — which is sufficient for the conclusion that the declarations are unreliable, and insufficient to say why.
- The two 500s (`get_test_case_linked_issues`, `verify_test_case_tags`) are **separately** BLOCKED capabilities that never return 200 at all; their envelope mismatch is a second, independent defect on top of that, documented in their own findings.
