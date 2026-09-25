# The test-case and run rows differ between WORKSPACES, not between environments

- **Product:** tm
- **Capability:** `list_test_run_test_cases_by_integer_id` (and `bulk_set_test_case_assignee_in_run`,
  which returns the same row)
- **Scope:** per WORKSPACE. Originally recorded as preprod-vs-production; a third account proves that is wrong (see the correction below).
- **Status:** **BLOCKED** — for the product team. The index now describes the drift; nothing on
  the index side can resolve it. Filed as BLOCKED rather than DRIFT because the disagreement is
  between WORKSPACES, not between the contract and reality.

> **Read the correction at the bottom first.** The sections below were written when only one
> account per environment had been sampled and describe the split as preprod-vs-production. A
> third account disproved that: the axis is the workspace. The measurements are accurate; the
> axis named in them is not.

## The shape

One row, two field sets — originally attributed to the environment (see the correction):

| field | preprod | production |
| --- | --- | --- |
| `execution_eligible` (run-mapping row) | present on **123/123** rows sampled | **absent** from every row sampled |
| `review_status` (every test-case route) | absent | present |
| `reviewers` (every test-case route) | absent | present |
| `test_result_issues` (run detail) | present on **4/4** run details | **absent** from 4/4 |

Re-verified after the index fix, and the asymmetry is exact: against a schema declaring all
three, production comes back missing only `execution_eligible` and preprod comes back missing
only `review_status` and `reviewers`. **No environment returns the full declared set**, so the
schema declares the union and names the split.

**Correction, 2026-09-22.** An earlier version of this file said the `review_status` /
`reviewers` gap was "specific to the run-mapping row" because preprod returned them on the
project-level routes. That was wrong, and it was wrong in the direction that understates the
finding. Re-checked directly: preprod returns them on **no** test-case route — not the listing,
not the folder listing, not search, not the detail. They are a **production-only** pair across
the whole test-case family. The mapping row is not special; it was simply where the diff
happened to surface first.

Sampled 2026-09-22. Preprod: project 379335744, 10 runs, 123 rows. Production: project 332537,
8 runs (3 with rows) plus TR-5176433.

## Why it is worth recording

It was nearly written up as a dead field. `execution_eligible` is named in the `returns` list of
two capabilities and sat in the known-unbacked ledger. Production never returned it, and the
obvious conclusion from production alone was that `returns` promised a field the API does not
send — delete it.

Checking the second environment reversed that completely. It is not dead; it is *the other
environment's* field. And the exchange runs both ways: production's `review_status` / `reviewers`
are equally absent from preprod.

**Either environment on its own would have produced a confidently wrong contract**, and the two
wrong answers point in opposite directions. Nothing about a single-environment probe would have
revealed that.

## What the index now says

`execution_eligible` is declared on `V1TestRunTestCaseRow` with the asymmetry stated in its own
description, so a caller is told to treat it as absent unless observed rather than planning
around it. `review_status` and `reviewers` are inherited from `TestCase`, so production is
covered by the shared declaration.

## What the product team should confirm

Whether this is a rollout in progress — the review fields landing in production ahead of preprod
while `execution_eligible` goes the other way — or two independently flagged features. If it is
a rollout, the index description should be retired once both environments converge, and this
file is the record of what it looked like mid-flight.

## Standing lesson

A field's absence is only evidence about the environment it was absent from. Presence generalises;
absence does not.

## CORRECTION 2026-09-23 — this is not an environment split

This file originally said production returns `review_status`/`reviewers` while preprod returns
`execution_eligible`, and framed the difference as preprod vs prod. **That framing is wrong.**

A second PRODUCTION account (project 4067615) was tested on 2026-09-23 and
behaves like **preprod**, not like the other production account:

| | preprod fixture | prod acct A (332537) | prod acct B (4067615) |
| --- | --- | --- | --- |
| `execution_eligible` | present | absent | **present** |
| `review_status` / `reviewers` | absent | present | **absent** |

Two production accounts, opposite field sets. So the driver is the **workspace** — almost
certainly a feature flag on the review-approve capability — not the deployment. The original
conclusion happened to fit because only one production account had been sampled.

**What this changes:** the capability is not waiting on preprod and production converging. It is
waiting on a per-workspace flag, which means any given caller sees a stable shape and two callers
on different workspaces see different ones. The index declares the union and names the split,
which remains the right call — but the reason given for it was wrong, and a reader planning
around "it will settle when the environments converge" would have been misled.

**Standing lesson, sharpened.** The earlier version of this file already carried "a field's
absence is only evidence about the environment it was absent from". One account per environment
was still too small a sample to name the axis. Absence tells you about the *account you sampled*,
not the environment it happens to live in.
