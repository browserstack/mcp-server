# assign_test_run_test_cases_v2 — DRIFT (the capability cannot perform its function)

- **Product / entity:** tm / `test_run` (write)
- **Path:** `PATCH /api/v2/projects/{project_id}/test-runs/{test_run_id}/test-cases/assign` (assign rows to a user)
- **Environment:** **preprod** (`test-management-preprod.bsstag.com`)
- **Index version:** 1.14 working tree (`run5merge_2026-09-16T18:02:57Z`) — phase 2, not in released v1.6
- **Probed:** 2026-09-18 — 3 attempts, subject run `TR-9062`
- **Run file:** `tests/live/runs/tm/assign_test_run_test_cases_v2.json`
- **Related:** `findings/create_test_run_v2.md`, `findings/get_test_run_test_cases_v2` (undeclared `execution_id`)

## Summary

**There is no way to make this capability assign anything through `invokeCapability` as currently declared.** One targeting field returns `200 {success:true}` and silently does nothing; the other is unusable in both directions because its declared type is wrong.

The verdict is DRIFT rather than BLOCKED because the capability *can* be invoked — it returns 200. That is arguably the worse outcome: a BLOCKED capability announces its own failure, whereas this one reports success while doing nothing.

## Drift 1 — a 200 that assigns nothing

Built exactly as declared: flat body, top-level

```json
"assign_to": [
  {"test_case_id": "TC-54457", "assignee": "ing@bsstag.com"},
  {"test_case_id": "TC-54458", "assignee": "ing@bsstag.com"}
]
```

→ **`200 {success: true}`** on the first attempt.

Re-reading `get_test_run_test_cases_v2` **immediately** and again **~15 s later**: both targeted rows still `assignee: null`. Nothing changed. The two untargeted rows were also correctly untouched, so this is not a blanket-update problem — it is a **no-op**.

The assignee value is not the likely culprit: `ing@bsstag.com` (TM user id 2522) is the same account already recorded as `created_by` on these very rows, so it plainly resolves.

## Drift 2 — the `execution_id` catch-22

The contract declares `execution_id` as an **integer**. Neither available value can be sent:

| value tried | blocked by | message |
| --- | --- | --- |
| `latest_result_id` as an integer (2150387252 / 2150387254) | **server**, 400 | *"The property '#/assign_to/0/execution_id' of type integer did not match the following type: string"* |
| the row's hex `execution_id` string (`babec147…d43`) | **`invokeCapability`, client-side** | *"'assign_to.execution_id' must be a number"* |

So **the type the server requires (string) is unsendable because the contract declares an integer, and the type the contract permits (integer) is rejected by the server.** The declared type closes the only working path.

Two further points make this worse:

- The server's 400 confirms the field is addressed at `#/assign_to/0/execution_id` — more evidence that `invokeCapability` re-nests flat fields under the declared `json_path`, consistent with `create_test_run_v2`'s findings.
- The only string-shaped `execution_id` a row actually has is the **hex field returned by `get_test_run_test_cases_v2`, which is itself undeclared there** (one of eight undeclared fields on that capability). So the working value is not merely blocked — it is undocumented.

## What this means for addressing a row

Neither id works:

| field | client-side | server-side | effect |
| --- | --- | --- | --- |
| `test_case_id` (`TC-NNN`) | passes | accepted, 200 | **silent no-op** |
| `execution_id` | blocks a string | rejects an integer | unreachable |

`latest_result_id` — which `get_test_run_test_cases_v2` declares, returns, and whose guidance says "use it when you need to fetch or amend that case's recorded result" — is **not accepted by this capability in any form tested.**

## Severity

An agent cannot assign test-run rows through this capability. Worse, it receives `{success: true}` and will report the assignment as done. Any workflow built on it will silently fail to route work to people — and the failure is invisible without an independent re-read.

## Environment handling — done correctly

The probe hit a **burst of null-body 500s** on its initial before-state read. Rather than reporting a crash, it confirmed the burst was **environment-wide** with two control calls to other capabilities (`get_test_run_v2`, `get_test_runs_v1`) in the same window, then retried unchanged and proceeded. Recorded in `setup[]`, not as a capability finding.

This is exactly the standard adopted after a `minify=true` "crash" in this same batch was retracted on re-test — a 2-of-2 reproduction on this environment is not evidence without a control.

## State left behind

`TR-9062` is **unchanged**: four rows, all `untested`, all `assignee: null`. Since nothing persisted, the four following write probes inherit the original state.

## Index actions proposed

1. **Correct `execution_id` to a string.** This is the single change that would make row-level targeting reachable at all — the server already tells us the required type in its own 400.
2. **Declare the row-level `execution_id` hex field on `get_test_run_test_cases_v2`**, since it is the value this capability needs and is currently undocumented.
3. **Investigate the `test_case_id` no-op as a product bug.** Either it should assign, or it should reject the field rather than returning `success: true`. A write path that reports success and does nothing is the most dangerous failure mode in this whole suite.
4. **Document which id addresses a row** across the test-run family — this suite has now found `latest_result_id`, the hex `execution_id`, and `test_case_id` all in play, with different capabilities wanting different ones and the contract not saying so.

## What this evidence cannot settle

No backend source or logs were consulted, so **why** `test_case_id` is accepted-and-ignored is unknown — it could be an unimplemented branch, a silently-dropped strong parameter (as seen on `update_test_case_v2`'s `is_shared`), or a permissions filter. What is established is the request/response evidence above plus two independent storage re-reads confirming no change.
