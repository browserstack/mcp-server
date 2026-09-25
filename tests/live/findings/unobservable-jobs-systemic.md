# SYSTEMIC — job-initiating capabilities whose effect cannot be observed through this index

- **Product:** tm
- **Scope:** **not one capability** — at least five, across three entities, four batches
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`)
- **Consolidated:** 2026-09-18

## The claim

Several capabilities exist to **produce an artifact or start a job**. Each returns a 2xx that means *"accepted"*, not *"done"*. **None of them can be verified through any capability in this index** — there is no status, polling, or download capability for any of them.

For an agent, this means their headline purpose is unconfirmable by construction. A probe can only ever record "the request was accepted," never "the thing was produced."

## The evidence

| capability | batch | returns | how the artifact is delivered | can it be checked? |
| --- | --- | --- | --- | --- |
| `initiate_export` | 5 | `{success, export_id}` | file collected from the Test Management UI's exports list | **No** — no status/download capability exists; `export_id` is redeemable only in the UI |
| `generate_test_case_automation` | 5 | (crashes — see below) | webhook stamps completion onto the case later | **No** — no companion status capability; `get_test_case` exposes `automation_status` but has no field for the `lcnc_link`/build metadata the guidance describes |
| `export_test_run_csv` | 6 | `{channel, success}` | CSV built async, **pushed over a websocket channel** to the requester's web session | **No** — response "carries no file and no download link" per its own guidance |
| `download_report` | — | `{channel, success}` | same websocket-push architecture | **No** — now live-probed (report 10393/SC-492, preprod, 2026-09-22): returned `{"channel":"996cbba6-3e8d-4417-bdb7-dc8919d52998","success":true}`, exactly the declared `{channel, success}` shape, zero drift. No status/poll/download capability in the profile accepts that `channel` |
| `export_dashboard_analytics` | — | — | same | **No** — documents the identical limitation |

`export_dashboard_analytics` was not probed in any batch; it was found during `export_test_run_csv`'s search for an artifact-fetch path, and its contract **documents the same limitation in its own text**. `download_report` has since been probed directly (see `tests/live/runs/tm/download_report.json`) and the live response confirms the prediction exactly: the `project_id`/`report_id` input side works fine (report 10393 exists, is ours, and the id was accepted), but the `channel` the call mints is, precisely like the other rows, unredeemable by anything else this index exposes — a third confirmed instance of the mint-a-handle-nothing-can-redeem pattern, not a second suspicion.

Notably, the backing service's generic export machinery is documented as reporting **"pending forever"** and **404-ing on download** for these export types — so even the infrastructure that would normally provide polling does not serve them.

## What this is, and what it is not

**It is not a contract defect in any individual capability.** In every case the declared response matched what actually came back — `export_test_run_csv` in particular returned `{"channel":"0cb604df-…","success":true}`, exactly its declared `{channel, success}` schema, with zero drift on request or response. These contracts are *honest*: several state outright that no file or link is returned.

**It is a coverage gap in the index as a whole.** The product delivers these artifacts over websockets and UI surfaces that an API-driven agent cannot reach. So the index publishes capabilities an agent can *start* but never *finish*, and it offers no capability that closes the loop.

**It is also why these probes are `UNVERIFIED` rather than `PASS`.** This suite judges writes on whether the effect landed. Where the effect is unobservable by design, "the request conformed" is the most that can honestly be claimed — and recording that as a PASS would overstate what was tested. (Contrast `count_binned_test_cases`, a *read* whose entire declared shape was verifiable even over an empty bin, which correctly earned a PASS.)

## Why it matters more than it looks

An agent asked to "export the test run and tell me what's in it" will call the capability, receive `success: true`, and have **no way to obtain or confirm the result**. Worst case it reports success to a user for a file that was never produced — indistinguishable, from the API side, from one that was.

This overlaps with a separate and worse pattern found in batch 6, where two `test_run` **write** capabilities returned success and demonstrably did nothing (`findings/assign_test_run_test_cases.md`, `findings/bulk_update_test_run_test_cases.md`). Those are bugs. **These are not** — but from the agent's vantage point the two are indistinguishable, because in both cases a 2xx is all there is. That is the deeper problem: **this index gives an agent no general way to tell a successful write from a no-op.**

## Actions proposed

1. **Decide whether these belong in an agent-facing index at all.** A capability an agent cannot complete may be worse than no capability, because it invites a confident false report. If they stay, their intent lines should say plainly: *"starts a job; the result is not retrievable through this API."*
2. **Expose status/download capabilities** for the export family if the product can serve them. That would convert five UNVERIFIED results into verifiable ones and is the single highest-yield addition suggested by this suite so far.
3. **Add a standard guidance sentence** to every job-initiating capability stating what the 2xx does and does not mean, and where the artifact actually lands.
4. **Audit for others.** Five were found incidentally rather than by systematic search; a sweep for capabilities returning a job/channel/export id would likely find more.

## Caveats

- **Preprod only.** A production environment might expose retrieval paths this one does not.
- **No backend source or logs** were consulted. The architecture described above comes from the capabilities' own contracts plus observed responses, not from reading the service.
- `generate_test_case_automation` is listed for the coverage gap only; it is separately **BLOCKED** because it crashes on every input, which is a distinct defect documented in its own finding.

## `send_report_email_now` — a PASS that cannot mean what a PASS usually means

Added 2026-09-22 after probing it on preprod with the operator's explicit approval.

The call is contract-correct: `200 {success: true, message: "Report generation started. Email
will be sent shortly."}`, declared and actual agreeing exactly. It is recorded PASS on that
basis.

But the PASS covers the request contract and the 200 envelope **only**. It does not — and
through this surface cannot — establish that any mail was generated or delivered:

- the 200 means **enqueued**, not sent, and the message says so in as many words
- there is **no job id** in the response
- there is **no status endpoint** anywhere in the index to poll
- generation or delivery can fail afterwards with nothing observable to the caller

So this capability sits in the same family as `initiate_export` and `export_test_run_csv`:
the product accepts the work and then goes quiet. It differs from them in one way that makes it
worse rather than better — **the side effect is external and irreversible.** The other two
produce an artifact nobody can fetch; this one puts a real attachment in a real inbox, at
arbitrary addresses, and is not permission-gated. A caller cannot confirm success, cannot
retract a mis-addressed send, and cannot tell a silent failure from a silent success.

Probed safely: a throwaway report was created in the campaign's own fixture
(`__mcp-probe-email-report-*`, id 10442) so the attachment carried fixture data rather than
anyone else's, and the single recipient was an address the operator owns.

**What the product team should add:** a job id on the 200 and a status endpoint, the same ask as
the rest of this finding. For this capability specifically, that is the difference between
"we think we emailed your customer" and knowing.
