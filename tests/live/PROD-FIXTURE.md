# Prod fixture — phase-2 non-PASS retest

**Environment: PRODUCTION.** `https://test-management.browserstack.com`

| | |
| --- | --- |
| project | **332537** (v1 integer) / **PR-18723** (v2 identifier) |
| name | **Demo Project 1** |
| scale | **16,267 test cases · 4,203 test runs · 30 folders** |
| account | the operator's own BrowserStack identity, not a test account — username deliberately not recorded here |

## Auth — the thing that cost an hour

The registry sends **`Api-Token: <username>:<access_key>`**, NOT HTTP Basic.
`curl -u` gets `401` plus an SSO redirect on every v1 route, in **both** prod and preprod, and
that 401 reads like a permissions problem when it is a header-shape problem. `src/tools/capability-registry/egress.ts`
documents the trap. The hand-written tools (`listFolders`, `listTestCases`, `listTestPlans`) use
Basic, which is why they 401 — not an environment or entitlement issue.

v2 routes additionally accept Basic, which is what made the first diagnosis look like
"v1 needs SSO". It does not.

## Rules for prod probes

1. **Never modify existing content.** 16k cases and 4.2k runs belong to other people's demos.
   Read freely; write only to objects this campaign creates.
2. **Name everything `__mcp-probe-prod-20260922-*`** so residue is identifiable and attributable.
3. **Scope writes to a folder this campaign creates.** Do not write into existing folders.
4. **Nothing here is cleanable.** The destructive tier is refused at the `invokeCapability`
   runtime layer, so anything created stays. Record every id in the cleanup ledger.
5. **Verify by reading back, never from the write response.** Six capabilities were caught
   misreporting their own result on preprod.
6. `q`/`search`/`name`/`filter` on the v2 project listing are **silently ignored** — all return
   the full 89,102 rows. Do not rely on filtering to find anything.

## What is being retested

The 19 phase-2 capabilities that did not PASS on preprod. The question is narrow: **do the
preprod defects reproduce on prod, or are they preprod-only?** A capability that passes here and
failed there is as interesting as the reverse — it would mean the index is right and preprod is
drifted.

## Verified prod ids (2026-09-22)

| thing | value |
| --- | --- |
| project | `332537` (v1) / `PR-18723` (v2) — "Demo Project 1" |
| scale | 16,267 cases · **2,378 test runs** · **294 root folders** |
| run, `done` but **EMPTY** | `TR-5401273` / uuid `75057293` — **0 cases mapped**, see correction below |
| run, `new_run` | `TR-5394831` / uuid `74986280` |
| folder for probing | `9697326` "MCP Testing" (3 cases, prior probe residue) |
| cases there | TC-838571 `32747791`, TC-838570 `32747562`, TC-838569 `32747539` |
| runs with **real results** | `TR-4827350` (1 Passed + 1 Failed, 2 cases) · `TR-3866741` (1 Blocked among 21) |

**`per_page` is ignored** on `list_root_folders` here — asked for 3, got 30 with `page_size: 30`.


## Correction — `run_state: done` does not mean the run has results

I recorded TR-5401273 as evidence that "prod HAS closed runs" and pointed several probes at it.
**It has zero test cases mapped**, confirmed independently by two probes via three different
capabilities. Nothing emptied it — no probe in this campaign has written to prod. The error was
mine: I inferred from `run_state: done` that the run had executed content. It does not.
**`done` reflects lifecycle, not execution.**

Use `TR-4827350` or `TR-3866741` instead — both found via `list_closed_test_runs`' progress
counts, and both have genuinely logged results.
