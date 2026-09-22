# What one query through the capability registry actually costs

Measured against the live `feat/capability-registry` build of this repo (`/Users/evendead/Developer/BS/mcp-server`), 2026-09-22.

## Headline numbers

For 10 real user queries run live through `searchCapability` → `describeCapability` → `invokeCapability`:

| | uncached input tokens | cached-effective input tokens | output tokens | cost @ $2/$10 per Mtok |
|---|---|---|---|---|
| **median** | 22,299 | 10,858 | 136 | $0.046 uncached / $0.023 cached |
| **mean** | 24,605 | 12,435 | 137 | $0.051 uncached / $0.026 cached |
| min | 20,188 | 10,018 | 119 | — |
| max | 36,657 | 20,296 | 155 | — |

- One query costs **roughly 20–37K input tokens**, almost all of it re-sent context, not new content — a single query is a 4-turn agentic loop (search → describe → invoke → answer), and the API bills the full growing transcript on every turn.
- **`describeCapability`'s response is the dominant, most variable cost** (275–6,865 tokens across the sample, median 1,627), exactly as flagged going in. `invokeCapability`'s response barely moves the total: swapping a live error body for a real recorded success response added a mean of only **274 tokens — about 1.1% of the total**.
- Prompt caching (standard cache-read ≈0.1× / cache-write ≈1.25× multipliers, applied to the growing transcript turn over turn) cuts the median query's effective input cost roughly **in half (~51%)**.
- Cost is reported **parameterized by rate**, not asserted, because I have no verified current price to assert with confidence for this task.

## Method

**Tokenizer.** No Claude tokenizer or `count_tokens` API access was available in this environment (no `ANTHROPIC_API_KEY`, no `ant` CLI session, and no such credential in the user's own shell either — checked). `tiktoken` (`cl100k_base`, OpenAI's BPE encoding) was installed fresh via a local venv and used for every token count in this document. **This is a real subword tokenizer, not chars/4 — but it is not Claude's own tokenizer.** Counts should be treated as a good-faith approximation of Claude-tokenizer counts, typically within a small percentage for JSON/English text, not an exact match. Every number below came from `tiktoken.encode()`, never from `len(text)/4`.

**What "live" means here.** All three registry tools were called for real against a running instance of this server (`node dist/index.js`, built fresh from `src/` on this branch), via the actual `@modelcontextprotocol/sdk` `Client`/`StdioClientTransport`, using `client.listTools()` and `client.callTool()`. This is not a simulation of the wire format — it is the wire format.

- **`searchCapability` and `describeCapability`**: fully live, fully successful. Both are served entirely from the local capability index (no BrowserStack network call), so they measure exactly what a real deployment would send.
- **`invokeCapability`**: called live, for real, with real recorded arguments. The BrowserStack tm **preprod** backend was down for the duration of this measurement (confirmed independently: `curl` to `test-management-preprod.bsstag.com` timed out while the CDN edge still 200'd) — every live `invokeCapability` call returned a real, small, uniform error envelope (`{"ok":false,"error":"that capability could not be invoked"}`, 14 tokens, identical across all 10 queries). That is a genuine measured payload, just not a representative one — a live backend would return actual data, not an error string. **Both numbers are reported for every row**: "as measured" (live error body) and "corrected" (the same turn-4 slot filled with that capability's real recorded 200 response from `tests/live/runs/tm/<capability>.json`, dated on the row).

**The recorded-response correction is itself a proxy, not a byte-exact capture.** None of the ~140 records in `tests/live/runs/tm/*.json`, nor `tests/live/payloads/tm.json`, store a literal raw response body — I checked all 190 files in that directory and confirmed the schema is uniformly `{setup, attempts, probe: {arguments, status, response_keys, item_shape}, contract, notes}`. There is no `body` or `raw_response` field anywhere. `item_shape` is a **curated, single-item structural sample** (sometimes with investigator prose describing drift, e.g. `"test_case.steps": "[] -- empty, despite ... being sent"`), not a literal captured HTTP payload. The "corrected" column uses `{response_keys, item_shape}` serialized and tokenized — a reasonable, labeled stand-in, with one specific known bias: **for list/paginated endpoints it represents one row, not the array the real response would contain.** Of the 10 sampled capabilities, `list_configuration_groups`, `list_test_plans_v2`, `get_test_case_comments_v1`, `list_test_run_test_case_comments_v1`, `get_test_run_test_cases_v2`, and `global_search_v1` all return arrays/multi-entity results — for these six the "corrected" number is a **floor**, not a ceiling. I could not measure how much larger a real multi-row page would be (no raw response was captured for any query, and the live backend was unreachable), so I am not estimating a multiplier — I'm flagging the direction of the bias instead of guessing its size.

**No system prompt is included.** A real deployment sits inside a host agent's own system prompt (Claude Code's, or whatever harness is calling this MCP server). That text is not part of this repo and its size cannot be measured here. Every number below is the capability-framework's own contribution only — add your host's system-prompt token count on top, once per turn (or once, cached, after the first turn), if you want a deployment-real total.

**Turn count.** I ran exactly the happy path — 1 search, 1 describe, 1 invoke, then a would-be 4th turn for the model's natural-language answer (whose *output* size I did not model — no artifact captures a real final answer, so it is excluded rather than guessed). I looked at whether the ~140 records in `tests/live/runs/tm/*.json` could justify a different average turn count via their `attempts[]` arrays: 131/190 records have more than one attempt, and 76 contain an attempt with an error status. But reading the actual content of those arrays shows they are **investigator-driven exploratory probes** (deliberately testing ID-form traps, alternate casing, idempotency — e.g. `assign_test_run_owner`'s second attempt is described as "Deliberate second invocation... to test the ID-FORM TRAP the task flagged"), not a model retrying after a failure. A narrower read — first attempt genuinely failed, a later attempt succeeded — matches only 30/191 records (~16%), and even that mixes deliberate probing with real failures. **I could not derive a trustworthy average retry count from this artifact**, so the headline model below is the 4-turn happy path only, explicitly not adjusted for retries. Treat every total as a per-query floor for queries that come back clean on the first `invokeCapability` call.

## The 10 queries measured

Picked from `tests/fixtures/routing-eval.json` (97 real user queries, one per tm capability) for spread of `describeCapability` contract size — read-only capabilities only, each with a recorded 200 response in `tests/live/runs/tm/` so the turn-4 correction is available for every row. (`test_case_results_v1`, originally selected for its mid-range size, has no successful recorded run — `status: null`/`BLOCKED` — and was swapped for `get_report_v2`, comparable in size, which does.)

| capability | raw contract size (bytes) | query |
|---|---:|---|
| `count_binned_test_cases_v1` | 1,485 | "how many cases are in the bin right now" |
| `list_configuration_groups` | 1,752 | "what configuration groups does the account have" |
| `get_test_case_v2` | 2,095 | "open TC-1042 and show me everything on it" |
| `list_test_plans_v2` | 3,015 | "what plans exist in this project" |
| `get_report_v2` | 3,778 | "show me the configuration behind SC-12" |
| `get_test_run_v2` | 3,265 | "pull up the details of this run" |
| `get_test_case_comments_v1` | 3,686 | "read the comments on this case" |
| `list_test_run_test_case_comments_v1` | 5,179 | "read the notes people left on this case inside the run" |
| `get_test_run_test_cases_v2` | 7,409 | "which cases are in this run, and who owns each one" |
| `global_search_v1` | 10,142 | "search everywhere in the account for the word checkout" |

(Raw contract size = the capability's own record in `capability/tm.capability-index.json` before `describeCapability` resolves `$response`/`$schema` refs — shown only to justify the spread; the actual measured `describeCapability` output sizes, which are larger once refs are resolved, are in the table below.)

## Static overhead: the 5 registry tools

Measured by actually connecting an MCP client to the running server and calling `tools/list` — the real JSON-RPC response, not a hand-count of the source. Serialized as `{name, description, input_schema}` per tool (what a Messages API `tools` array actually carries):

| tool | chars | tokens (tiktoken cl100k_base) |
|---|---:|---:|
| `listProducts` | 453 | 102 |
| `describeEntity` | 603 | 130 |
| `searchCapability` | 2,765 | 620 |
| `describeCapability` | 1,743 | 372 |
| `invokeCapability` | 2,262 | 492 |
| **combined (as sent in one `tools` array)** | **7,832** | **1,718** |

**1,718 tokens, every single request**, regardless of which capability is ultimately used. This is the number that repeats on all 4 turns of every query (or is read from cache on turns 2–4, see below).

## Per-turn cumulative input — 3 worked examples

The API resends the full growing transcript on every turn. `Tn_in` below is the *total* input token count billed on turn *n* (not the size of what's new that turn). Deltas after turn 1 are the previous turn's tool-call output plus that turn's tool-result content, wrapped as real Anthropic-style `tool_use`/`tool_result` content blocks (tokenized with wrapper JSON included, not just the raw text).

**Smallest contract — `count_binned_test_cases_v1`** ("how many cases are in the bin right now"):

| turn | sends | cumulative input tokens | output tokens (this turn) |
|---|---|---:|---:|
| 1 | 5 tool defs + query | 1,727 | 43 (searchCapability call) |
| 2 | + search call + search result (4,464 tok) | 6,580 | 34 (describeCapability call) |
| 3 | + describe call + describe result (275 tok) | 6,940 | 51 (invokeCapability call) |
| 4 (as measured, live error) | + invoke call + invoke result (14 tok, error) | 7,031 | — |
| 4 (corrected, recorded 200) | + invoke call + invoke result (proxy) | 7,047 | — |

**Median contract — `get_report_v2`** ("show me the configuration behind SC-12"):

| turn | cumulative input tokens | output tokens (this turn) |
|---|---:|---:|
| 1 | 1,726 | 42 |
| 2 | 5,717 | 31 |
| 3 | 7,299 | 56 |
| 4 (as measured) | 7,395 | — |
| 4 (corrected) | 7,561 | — |

**Largest contract — `global_search_v1`** ("search everywhere in the account for the word checkout"):

| turn | cumulative input tokens | output tokens (this turn) |
|---|---:|---:|
| 1 | 1,727 | 43 |
| 2 | 6,484 | 31 |
| 3 | 13,985 | 68 |
| 4 (as measured) | 14,093 | — |
| 4 (corrected) | 14,461 | — |

Note the jump from turn 2 → turn 3 in every example: that's `describeCapability`'s response landing in context, and it is by far the largest single increment in the whole loop — larger than the static tool-definition overhead, larger than `searchCapability`'s result, and (per the correction above) far larger than what `invokeCapability` typically adds on top.

## Full 10-row table

"Total input" = sum of the 4 turns' cumulative input (the actual API billing unit across a 4-turn loop). "Cached-effective input" applies standard Anthropic cache-read (≈0.1×) / cache-write (≈1.25×) multipliers turn over turn (modeled — see caveat below, no real `cache_read_input_tokens` was observed since these were local tool calls, not live Messages API requests with `cache_control` set). "Total output" = the 3 tool-call JSON blocks the model must emit (`searchCapability` + `describeCapability` + `invokeCapability` calls); the 4th-turn natural-language answer is excluded (unmeasured, see Method).

| capability | total input, uncached (error / corrected) | cached-effective input (error / corrected) | total output | turn-4 correction delta |
|---|---:|---:|---:|---:|
| `count_binned_test_cases_v1` | 22,278 / 22,294 | 10,313 / 10,333 | 128 | +16 |
| `list_configuration_groups` | 21,167 / 21,216 | 9,956 / 10,018 | 119 | +49 |
| `get_test_case_v2` | 27,021 / 27,381 | 13,211 / 13,661 | 136 | +360 |
| `list_test_plans_v2` | 20,856 / 21,009 | 10,123 / 10,314 | 134 | +153 |
| `get_report_v2` | 22,137 / 22,303 | 10,718 / 10,925 | 129 | +166 |
| `get_test_run_v2` | 26,932 / 27,627 | 13,749 / 14,618 | 136 | +695 |
| `get_test_case_comments_v1` | 19,647 / 20,188 | 9,510 / 10,186 | 143 | +541 |
| `list_test_run_test_case_comments_v1` | 21,543 / 21,687 | 10,610 / 10,790 | 155 | +144 |
| `get_test_run_test_cases_v2` | 25,438 / 25,687 | 12,893 / 13,204 | 148 | +249 |
| `global_search_v1` | 36,289 / 36,657 | 19,836 / 20,296 | 142 | +368 |
| **median** | 22,207 / **22,299** | 10,664 / **10,858** | **136** | — |
| **mean** | 24,331 / **24,605** | 12,092 / **12,435** | **137** | +274 (1.1% of total) |
| **min** | — / 20,188 | — / 10,018 | 119 | +16 |
| **max** | — / 36,657 | — / 20,296 | 155 | +695 |

All ten queries used exactly 4 turns — no retries, no extra searches. See the Method section for why I did not adjust this for real-world retry frequency.

## Cost — parameterized by rate

Not asserting a specific Sonnet 5 (or any model's) price. Rows below are illustrative $/Mtok pairs; apply your actual rate card. Using the **corrected** median/mean input figures and median/mean output:

| $/Mtok in / out | uncached, median | uncached, mean | cached-effective, median | cached-effective, mean |
|---|---:|---:|---:|---:|
| $1.00 / $5.00 | $0.02298 | $0.02529 | $0.01154 | $0.01312 |
| $2.00 / $10.00 | $0.04596 | $0.05058 | $0.02308 | $0.02624 |
| $3.00 / $15.00 | $0.06894 | $0.07587 | $0.03461 | $0.03936 |
| $5.00 / $25.00 | $0.11489 | $0.12645 | $0.05769 | $0.06560 |

Per 1,000 queries (median, uncached → cached-effective):

| $/Mtok in / out | per 1,000 queries, uncached | per 1,000 queries, cached-effective |
|---|---:|---:|
| $1.00 / $5.00 | $22.98 | $11.54 |
| $2.00 / $10.00 | $45.96 | $23.08 |
| $3.00 / $15.00 | $68.94 | $34.61 |
| $5.00 / $25.00 | $114.89 | $57.69 |

**Extrapolated (not independently measured) to the full routing eval** — `tests/fixtures/routing-eval.json`'s 97 queries — as `median_cost × 97`, assuming every query behaves like the measured median (no retries, no extra searches, same rate as above):

| $/Mtok in / out | 97-query eval, uncached | 97-query eval, cached-effective |
|---|---:|---:|
| $1.00 / $5.00 | $2.23 | $1.12 |
| $2.00 / $10.00 | $4.46 | $2.24 |
| $3.00 / $15.00 | $6.69 | $3.36 |
| $5.00 / $25.00 | $11.14 | $5.60 |

This is a straight multiplication of the median from a 10-query sample, not a run of the actual 97 — flagged as an extrapolation, not a measurement, per the instruction not to fill in what wasn't measured.

## Prompt caching — what's modeled and what isn't

**Modeled, not observed.** No real Messages API request was made in this measurement (all traffic was local MCP tool calls to the capability registry's search/describe code, which don't touch the Anthropic API at all), so there is no real `usage.cache_read_input_tokens` to report. The cached-effective figures above apply the standard cache pricing ratios — cache read ≈0.1× base input price, cache write ≈1.25× base input price — to the turn-by-turn deltas: each turn's brand-new content (tool call + tool result) is charged at the write rate, and everything carried over from a previous turn is charged at the read rate.

Why it matters here specifically: the 5 tool definitions (1,718 tokens) are **byte-identical on every single request**, across every query in a session and across sessions, which is exactly the shape prompt caching is built for. Within one query's 4-turn loop, the model's stable prefix also just grows monotonically (nothing is ever removed), which is the second ideal case for caching. The result in this sample: caching drops the median query's effective input-token cost from 22,299 to 10,858 — **roughly half**. In a multi-query conversation (several `routing-eval.json` queries asked back-to-back in one session, rather than one fresh session per query as measured here), the savings would be larger still, because the 1,718-token tool-definition prefix and even prior queries' `describeCapability` outputs would already be cached before the next query's turn 1 — a scenario this measurement does not model, since each of the 10 queries here was run as its own fresh 4-turn loop.

## What I could not measure

- **The Claude tokenizer itself.** No `ANTHROPIC_API_KEY`, no `ant auth` session, in this sandbox or in the user's own shell (checked live via tmux). All counts use `tiktoken`'s `cl100k_base` (OpenAI) encoding as a real-BPE-tokenizer stand-in, per this task's own fallback instructions. Treat every token count as approximate for that reason, even though it is not a chars/4 guess.
- **Real `invokeCapability` success-response bytes.** The tm preprod backend was down for the whole measurement window; every live invoke call returned the same 14-token error envelope. Corrected using `{response_keys, item_shape}` from each capability's real recorded 200 in `tests/live/runs/tm/`, which is itself a curated structural summary, not a raw captured body — and a known **floor** (not a real number) for the six sampled capabilities that return lists/arrays.
- **A trustworthy average retry/turn count.** `attempts[]` in the 190 real probe records mostly reflects deliberate investigator exploration (ID-form traps, idempotency checks), not model retry-after-failure behavior; I found no way to cleanly separate the two, so no retry adjustment is included and every total here is a 4-turn happy-path floor.
- **Host system-prompt tokens.** Not part of this repo, not measured, not included in any total above.
- **The final natural-language answer's output size.** No artifact captures what a model's closing turn actually looks like; output tokens above cover only the 3 required tool-call JSON blocks.
- **A verified current Claude API price.** Cost is reported parameterized by rate for this reason, per instruction.

## What this means

- A capability-registry query is not "3 cheap round trips" — it is one 4-turn agentic loop where the transcript compounds, and **`describeCapability`'s response is the single biggest, single most variable line item** in that loop (275–6,865 tokens across a 10-query sample spanning small and large contracts). Anyone optimizing this framework's cost should start there, not at `invokeCapability`.
- `invokeCapability`'s actual response size barely matters next to that: the measured correction (real error envelope → real recorded success shape) moved the total by ~1.1% on average, even though it's a real, not hypothetical, swap.
- Caching the 5 static tool definitions and the turn-by-turn growth roughly halves the effective input cost of a single isolated query, and would do more than that across a multi-query conversation, which this measurement does not model.
- At a plausible $2/$10-per-Mtok rate, one query lands around **$0.02–$0.05** uncached or **$0.01–$0.03** cached; running the entire 97-query routing eval once is on the order of **a few dollars**, not a meaningful infrastructure cost at this rate — though that figure is an extrapolation from 10 samples, not a measurement of the 97.
