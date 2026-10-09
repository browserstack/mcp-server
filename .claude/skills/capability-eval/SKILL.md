---
name: capability-eval
description: Run a product's end-to-end capability evals — seed the fixture, put each natural-language query to a fresh subagent through the MCP server, answer the questions it hands back, and score whether it reached the right capability, scoped the call and returned a right answer. Use this when someone wants to run the evals, measure routing or answer quality end to end, check whether an agent can find a capability from the words a customer uses, add eval cases, or re-record a baseline after the surface changes. Triggers on: run the evals, e2e eval, capability eval, routing eval runner, score the agent, eval baseline, re-record the baseline, does an agent reach this capability, tm-eval-e2e.
---

# Running capability evals end to end

Live probing asks "does this capability work". An eval asks **"would an agent ever reach it, and was the answer right"**. A capability can pass every probe and still be invisible to the words customers use.

**You are the master.** One subagent — a slave — answers each case. When a slave cannot proceed it hands a question back; you answer it and it resumes with its context intact. That conversation is the point: it is how a real caller behaves, and it is the only way to exercise a write, which cannot complete without someone saying yes.

**A number from a contaminated run is worse than no number**, because it looks like a measurement. Most of this skill is the discipline that keeps the number honest.

## Running unattended, with no memory of previous runs

In CI you are a fresh session: you do not know whether this eval ran yesterday, or a hundred times. **Never reason from having run before.** Every run establishes what it needs from the account itself, at the start of that run:

- **Seed every time.** `npm run seed:live` is idempotent and finds the fixture by name. When everything exists it is a handful of reads. Skipping it to save time is how a run meets a half-built fixture and reports routing failures.
- **Read the mutable state before you touch it.** The write case asserts on a *difference* measured inside this run — the comment ids on the scratch case before the slave is spawned, compared with after. That is deliberate: a text match would require knowing whether a previous run already left that sentence, which a fresh session cannot know. Any new mutating case must assert the same way.
- **Expect residue and do not treat it as failure.** The scratch case carries one comment per past run; tm has no comment delete. A read case that finds more than it expected has found history, not a bug.

The job must supply what a desktop session gets for free. Each of these, absent, produces a run that grades as total routing failure:

| | why |
| --- | --- |
| `--mcp-config` naming the eval server | a CI agent has no `~/.claude.json`, so the tools do not exist |
| `CLAUDE_CODE_OAUTH_TOKEN` | config-dir credentials are not on the agent |
| `--allowedTools` covering the five registry tools | headless with no permission mode refuses every call, silently enough to look like the agent declining |
| the account credentials as job env, not `.env` | `.env` is gitignored and will not be in the checkout |
| `--strict-mcp-config` | otherwise the agent's own servers leak in and the slave can answer from the wrong account |

The skill and the `capability-eval-case` agent type live in this repo, under `.claude/`, so the checkout carries them. If either moves back to `~/.claude/`, the job stops working and the reason will not be obvious from the transcript.

**Emit a machine-readable result.** An unattended run that only writes prose cannot gate anything. Write the per-case verdicts to a file the job can archive, and exit non-zero on fail — but **not** on a hand-back, which is a pass.

## 0. What exists

| | state |
| --- | --- |
| `tests/fixtures/tm-eval-e2e.json` | 10 cases, tm, carrying setup / expects / validates / asserts |
| `tests/fixtures/routing-eval.json` | 77 query→capability pairs, tm — **no setup, no asserts**, so it scores routing only |
| `tests/fixtures/search-eval.json` | 198 ranking cases — a plain unit test, no model, runs in CI |
| `npm run seed:live` | builds the tm fixture, idempotent, writes `tests/live/.id-pool.json` |
| `capability-eval-case` | the slave agent type: the five registry tools and nothing else |
| `browserstack-eval` | an MCP server bound to the eval account |

## 1. The account decides everything

**Every entity a query names must actually exist on the account under test.** A query naming something absent returns empty, the slave rationalises the emptiness, and an eval full of those reports a healthy pass rate over nothing at all.

1. **Use a dedicated eval account.** On a shared one projects are transient — a 93,000-project account will have deleted your fixture by next week, and the failures will look like routing failures.
2. **Point an MCP server at it.** Slaves inherit *this session's* servers, so a server bound to the wrong account is the single most likely cause of a run where every case 404s. Check before you start: invoke a read against the fixture project and confirm it answers.
3. **Seed**: `npm run seed:live`, with `CAPABILITY_REGISTRY_BASE_URL_TM` and, for a production account, `TM_LIVE_ALLOW_PRODUCTION=1`. It is idempotent — it finds `__mcp-capability-fixture__` by name. **Run it twice on a fresh account**: the first pass could not read back folder ids on production, so case creation got an undefined folder and the pool came out half-built while still reporting CREATED.
4. **Resolve every `{{placeholder}}`** in the fixture from `tests/live/.id-pool.json`. Never hardcode an id into a case.
5. **Check the pool's `account` and `env`** match what you meant. They are recorded so a run against the wrong one is catchable rather than silent.

If the fixture cannot be seeded, stop and say so. A run against an unseeded account produces a number that means nothing, and someone will quote it.

## 2. Running a case

One slave per case, spawned as `capability-eval-case`, given **the query and nothing else** — no hint of which capability to use, no product named.

**Do not paste the setup ids into the query.** Put them where the case puts them: as the entities the query refers to by name or identifier. Context smuggled into the prompt changes what is being measured — a preamble of "In BrowserStack project PR-20" injects `browserstack` and `pr` as routing vocabulary, and `pr` is a tm alias, so the clash gate silently stops firing and every ambiguous case passes for the wrong reason.

**Do not name the product.** The slave should ask. Answering when asked is the master's job and takes one round trip; naming it up front removes the thing half these cases measure.

## 3. Answering a hand-back

A slave hands back for three reasons. Answer plainly, as the user would:

| it asks | you answer |
| --- | --- |
| which product | the product, and the project if it needs one |
| approval for a write | yes or no, plus anything the case says about scope |
| for an id nothing can resolve | the id from the pool, or decline and let the case fail honestly |

**Never tell a slave to skip asking.** The write gate is server-side: `invokeCapability` refuses a write without `user_permission: "granted"`. Instructing a slave not to ask does not remove the gate, it makes the slave assert `granted` without having been told — which is a forged approval, and exactly the failure mode that self-reported flags always decay into. The ask is the feature.

**Answering that ask is relaying, not granting.** A slave once refused the approval handed back to it — "I'm an agent, not the user, so my yes doesn't count" — and the write case could not complete. The slave's instinct is right in general, so the agent definition now addresses it directly; but the instinct only stays safe while the master's answer really is a relay. Your authority to say yes comes from the person who asked for the run and from the fixture declaring `setup.writes: true` on that case. It does not extend past either. Approve the write the case describes, to the scratch target the case names, and nothing else. If a slave asks to write something the fixture did not sanction, the answer is no and the case is a finding.

Unattended, the person is whoever configured the job, and their authorisation is standing rather than per-run — which is only acceptable because fixture writes are additive, bounded and aimed at a scratch object in a dedicated project. A write case that could not say that about itself does not belong in an unattended suite.

A hand-back is a successful outcome. Record it, answer it, and score the case on what the slave does next.

## 4. Scoring — four questions, not one

| | question | how |
| --- | --- | --- |
| **reached** | did it invoke `expects`? | the capability name appears in an `invokeCapability` call |
| **scoped** | did it satisfy `validates`? | read the path it took — one search not an enumeration, the given ids used rather than rediscovered, a required parameter actually supplied |
| **answered** | does the reply satisfy `asserts`? | check against the *response*, not the prose |
| **restraint** | when `expects` is `__ask_the_user__` | it asked and invoked nothing |

**Verify the asserts yourself.** A slave reporting its own success is evidence, not proof. Read the write back with your own `invokeCapability` call — a write that returned 200 once stored the literal string `[object Object]`, and the slave that made it reported success in good faith.

Score `PASS` only when every applicable check holds; otherwise `PARTIAL` with the failing check named, or `FAIL`.

**Record the diagnosis, not just the verdict.** "Reached the capability but listed every project first" and "never reached it" are different defects with different fixes. Classify misses: *vocabulary gap* (the customer's word is not an alias), *sibling shadowing* (a near-identical capability won), *scope drift* (it explored instead of using what it was given). The classification is the useful output; the percentage is the headline.

## 5. Reading the result honestly

- **The first run of a new eval measures the eval.** Expect it. Across four runs of the tm set, run 1 found a half-seeded fixture, run 2 found the prompt preamble suppressing the clash gate, run 3 found the gate ignoring context supplied outside the query, and run 4 found a real capability defect and a fixture defect. Only then did the number mean anything.
- **Separate harness failures from agent failures.** A server bound to the wrong account, an expired token, a tool the slave was not given — all produce transcripts that grade as routing failures. Count them separately and say how many you excluded.
- **A grader is code and can be wrong.** Scoring "did it invoke `expects`" marks a correct approval pause as a miss, because the write legitimately has not happened yet. When a result surprises you, read the transcript before reporting the number.
- **Re-record the baseline when the surface changes.** Withholding or renaming capabilities silently invalidates cases: 38 of the 198 search cases and 13 of the 77 routing cases already target capabilities no longer exposed.

## 6. What a case has to carry

A query paired with a capability measures routing and ignores whether the answer was right. A real case carries five things:

```
query        "give me the folder id of archived test cases"
setup        project: {{project.identifier}} — seeded, must exist
expects      list_root_folders
validates    scoped to the given project, not a global search
asserts      a folder named "Archived" is present in the response
```

- **query** — the customer's words, deliberately avoiding the product's own vocabulary, and **without the product named**.
- **setup** — the ids the query assumes, as `{{placeholders}}` into the pool. **An eval that lets the slave guess its own starting point measures its exploration strategy, not your capabilities.**
- **expects** — ground truth, held back. Use `__ask_the_user__` when the right behaviour is to ask.
- **validates** — what it should have scoped or checked. Separates arriving by reasoning from arriving by luck.
- **asserts** — on the response, verified by the master.

Include at least one case whose correct outcome is a **question rather than a call**. Without one, the suite cannot distinguish a confident wrong answer from a correct refusal.

## 7. Writes

Write cases need `setup.writes: true`, an assertion that approval was requested **before** the call, and a read-back proving the write landed.

Target `__scratch__`, never `__readonly__`. Pointed at a readonly case, a slave read the fixture project's own "contents are asserted against" warning and hesitated over *that* rather than over the write — so the case measured the warning label instead of the gate.

Prefer additive writes. tm exposes no comment delete, so a comment case leaves residue by design; say so in the case's `cleanup` rather than pretending it is clean. Never run a destructive case: the registry refuses destructive capabilities outright, and an eval is not the place to discover otherwise.

## 8. The trade this design makes

Slaves inherit this session's context — project instructions, global `CLAUDE.md`, everything. A headless runner with its own config dir does not, and that isolation is real: an earlier headless eval, run without it, answered a question about "the last report" by offering to check Obsidian logs and Jenkins builds.

Master/slave buys genuine multi-turn, which headless cannot have: a write that is never approved never happens, so a single-turn runner can only ever measure half of a write case. The cost is that isolation.

Watch for it rather than assume it away. A slave speculating about entities the product does not have — asked about reports, one volunteered "deployment report" and "capability index" before querying anything — is the signal. When it appears, ask the slave where the term came from; it can usually tell you, and it self-corrects once it queries the product. If leakage turns out to matter for a given suite, the answer is a hybrid: master/slave for the conversation, each slave spawned headless with a clean config dir.

## 9. Reporting

Report, in this order: how many cases ran, how many were excluded and why, the pass/partial/fail split, the miss classification, the diagnosis per failing case, and anything the run found that was not what it was looking for — a wrong contract, an inconsistent id format, a silent coercion. Those incidental findings are often worth more than the score.

Put the rate last. Someone will quote it out of context, and everything above is what makes it mean something.
