# Two readers report different ids for the same result status

- **Product:** tm
- **Environment:** preprod
- **Status:** for the product team. Confirmed on two status values with hard evidence.

## The finding

Write a result status, then read it back through two different capabilities, and they report
**different numeric ids for the same row**.

The cleanest case, tied to a single write on result **2150424086**:

| | id reported |
| --- | --- |
| id **sent** in the write | `318612` |
| `get_test_cases_for_v1_test_run` | `318612` |
| `get_test_results_for_test_case` | **`318639`** |

Both describe the same status — label "Blocked", colour `#818CF8`, on the same result row.

It is not confined to one value. The same split was seen for **"Passed"**: a step-result write
reported `318610` from the write response and from `get_test_cases_for_v1_test_run`, while
`get_test_results_for_test_case` reported `318637` for the identical row. And a result created
as `318612` read back as `318639` on a separate probe.

So the pairs observed so far are **318610 / 318637 (Passed)** and **318612 / 318639 (Blocked)**
— a consistent offset of 27 in both cases, which suggests two parallel id blocks rather than
random divergence.

## How this relates to the duplicate-option-id finding

It is the same *shape* as the settled duplicate-option finding but on a different surface. There,
every default dropdown option exists **twice in storage** with disjoint id ranges, proven to be
historical data rather than a serializer artifact, and both copies are live and interchangeable.

Here the duplication is not merely present in a listing — **two readers disagree about which id
belongs to one specific row**, which is a stronger and more actionable statement. A caller that
writes a status, reads it back through the "wrong" capability, and compares ids will conclude
the write did not take.

## Why it matters

Any client that round-trips a status id — writes it, reads it, compares — is broken depending
on which reader it happens to use. Comparing by **label** works; comparing by **id** does not.
Nothing in either contract warns of this, and both readers present their id as authoritative.

## What is not established

Which id is canonical, and whether the offset of 27 holds across every status value or is a
coincidence of the two sampled. That needs someone with database access, or a sweep across all
status values. No backend source was consulted here.

## Evidence

Project 379335744 (PR-2005), run TR-9120, result 2150424086, 2026-09-22. Traces in
`tests/live/runs/tm/bulk_edit_test_cases_in_test_run.json`, `create_step_result_v1.json`, and
`update_latest_test_result_for_test_case.json`.
