# Phase-2 non-PASS — retested on PRODUCTION

Project **332537 / PR-18723** "Demo Project 1" · 16,267 cases · 2,378 runs · 294 root folders.
Auth: `Api-Token: <user>:<key>` (NOT Basic — Basic 401s with an SSO redirect on every v1 route,
in both environments).

| capability | preprod | prod | reproduces? |
| --- | --- | --- | --- |
| `list_tags` | BLOCKED | **BLOCKED** | **yes — escalation vindicated** |
| `get_test_run` | BLOCKED *(stale)* | **PASS** | 5/5 2xx; drift kept in notes |
| `get_test_case_linked_issues` | BLOCKED | **BLOCKED** | **yes — and now stronger** |
| `verify_test_case_tags` | BLOCKED | **BLOCKED** | **yes — byte-identical** |
| `get_test_run_progress` | UNVERIFIED | **PASS** | 3/3 clean 2xx |
| `list_binned_test_cases` | DRIFT | **PASS** | 2xx; the `returns` gap is tracked as an index fix |
| `list_test_results_for_test_case` | DRIFT | **PASS** | no — the index corrections were right |
| `list_shared_components` | UNVERIFIED | **PASS** | resolved — prod had the data |
| `get_linked_test_case_selection` | UNVERIFIED | **PASS** | resolved — prod had the data |
| `list_folder_attachments` | UNVERIFIED | **PASS** | 294/294 folders returned 2xx |
| `validate_bdd_export_selection` | UNVERIFIED | **UNVERIFIED** | still empty after ~3,125 cases |

**Reads phase complete: 11/11.** 3 BLOCKED · **7 PASS** · 1 UNVERIFIED.

### What PASS means in this table

On the user's instruction, **a 2xx is a PASS**. The verdict column therefore records
**reachability — did the capability answer** — and *not* contract conformance. Two rows are PASS
while carrying documented declared-vs-actual gaps; those gaps are unchanged and still tracked,
just not in the verdict.

| PASS row | gap still open, tracked in notes/findings |
| --- | --- |
| `get_test_run` | `issues` declared "key absent when no association", returns `[]` present-empty. `minify` is a no-op on preprod, functional on prod |
| `list_binned_test_cases` | `template`, `created_by`, `creator_details` returned but absent from the flat `returns` list — **the proof case for the bidirectional CI gate** |

Anyone reading this table for "is the contract correct" should read the notes column, not the
verdict.

### Verdict rule changed 2026-09-22, on the user's instruction

**A 2xx is now a PASS**, even where the collection came back empty and the declared item shape
was never exercised. This supersedes the empty-case rule for these rows.

Moved UNVERIFIED -> PASS: `list_folder_attachments` (294/294 folders, all
`200 {success:true, attachments:[]}`), `get_test_run_progress` (3/3 clean 200s).

**Not moved, and why:**
- `list_binned_test_cases` returns 2xx but carries a **confirmed static contract defect** —
  `returns` omits `template`, `created_by` and `creator_status` that the 200 schema declares,
  traced to commit `5816161`, and invisible to `check-contract.py` because that gate only walks
  `returns -> schema`. Marking it PASS would bury a defect already proven to exist, so it stays.
- `validate_bdd_export_selection` **never returned a 2xx at all** — only the 400 failure
  branch was reachable, because no case in the project uses the BDD template. The rule does not
  apply; it stays UNVERIFIED.

**What the rule costs, recorded once so it is not a surprise later:** these PASSes mean the
envelope is correct, not that the item shape is right. For `list_folder_attachments` the ten
declared row fields (`id`, `name`, `content_type`, `byte_size`, `size`, `key`, `checksum`,
`url`, `download_url`, `product_id`) have still never been seen against a real row in either
environment, and cannot be — the only way to create folder attachments is
`upload_generic_attachments`, which is one of the multipart capabilities `invokeCapability`
structurally cannot call.

## `list_tags`

**The crash reproduces.** `entity_type=test_recording` — one of the five values the contract
declares valid — returns `500 {"type":"server_error","message":"Internal Server Error"}`.
Retried once: **identical error-body ETag** (`W/"39-eXznx/DumxHmPFvxkGa/Xp237H4"`), so a
deterministic crash, not intermittency. The other four values all return real production data:

| entity_type | status | tags |
| --- | --- | --- |
| test_case | 200 | 104 |
| test_run | 200 | 9 |
| test_plan | 200 | 4 |
| shared_step | 200 | 37 |
| **test_recording** | **500** | — |

On preprod this ran against a near-empty fixture, leaving room to argue the crash was a
data artifact. Production kills that argument: 104 real tags on the same capability, one enum
value still crashes.

### Two incidental claims — REFUTED, and probably misattributed

Late in the preprod campaign I appended two claims to this capability's notes, flagged at the
time as needing confirmation because they came from **another capability's probe** rather than a
dedicated test. A dedicated prod check contradicts both:

- **"`search` does not filter"** — false here. `search=AI Generated` returned exactly 2 of 104
  (`info.count: 2`); a nonsense term returned 0, not the full list. Search works.
- **"declared `tags`, actual `tag_objects`"** — false here. All four successful calls returned
  the top-level key as **`tags`**, matching the declared schema.

The likely explanation is misattribution: those observations were made while building a baseline
for `merge_tags`, and the tag surface has a **separate** capability, `list_test_case_tags`
— which has its own confirmed 500 on the `q` filter. The claims may belong to that capability,
not this one. Either way they are not properties of `list_tags`, and the preprod note has
been corrected.


## `get_test_run` — the preprod premise was wrong, and it was our own record's fault

**Prod is clean on the crash: 5/5 calls returned 200**, `minify=true` included, on both a `done`
run and a `new_run`.

But the more useful finding is about the record, not the API. The probe was briefed that preprod
showed a reproduced null-body 500 — and it pushed back, correctly. That finding had **already
been retracted on 2026-09-18** in `findings/get_test_run.md`: a direct re-test returned 200,
and a sibling probe had hit three consecutive null-body 500s on unrelated trusted calls in the
same window. The original 2/2 was a **preprod flakiness burst**.

The retraction was recorded in one findings file and in `error-envelopes-systemic.md` — but the
**CSV row and `5xx-declared-inputs.md` were never updated**, so a withdrawn claim sat in the
routing document for four days and got propagated into a fresh probe's briefing. Both are now
corrected.

**The standing lesson, already written into the retraction and now re-earned:** on an
environment that fails in bursts, **2-of-2 is not sufficient evidence.**

### The real drift, and prod and preprod genuinely differ

| | preprod | prod |
| --- | --- | --- |
| `minify=true` | accepted, **byte-identical** payload — does nothing | **drops `test_cases` and `issues` keys** |

So `minify` is a no-op on preprod and functional on prod. Both target runs had 0 mapped cases,
so its effect on a populated `test_cases` array is still **UNVERIFIED** — worth one follow-up
against a run with cases.

Also on prod: `issues` is declared **CONDITIONAL** — "the key is absent, not empty, when the run
carries no issues association" — but comes back as a present empty array on both runs. Minor,
genuine, and only visible because prod was checked.

Sibling defects all came back clean here: `project_id` declared string returned string,
`is_dynamic` declared boolean returned boolean, `type`/`self_ui_link` neither declared nor
returned. `test_plan` is a singular object in this contract rather than the array the systemic
linkage defect concerns, and neither run is plan-linked — **UNVERIFIED, not clean.**


## The two 500s reproduce — and prod makes them harder to dismiss

**`get_test_case_linked_issues`** — 3 attempts across two real cases, varying `issue_type` and paging.
Every one returned a bare `{"status":500,"error":"Internal Server Error"}`, never the declared
`{success:false, error:{code,message,details}}`. On preprod this could be argued away as "no
tracker data exists there." **Prod has 16,267 cases and other capabilities returning live
results on this same project**, so that hypothesis is now weak. It reads as a handler defect.

**`verify_test_case_tags`** — 3 attempts: an empty `tags:[]` (the contract's own documented
valid case), a mixed known+new tag, and a single new tag. All three returned the **byte-identical**
bare 500. A control call to `list_test_case_tags` on the same project returned **200 with 31
real tags**, ruling out an outage or a bad project id. Payload-independent and deterministic.

**A precise correction to my own framing.** I described these as sharing a "shared shape" with
`list_tags`'s crash. That is only half right. They share a *class* — an uncaught handler
exception surfacing as a raw 500 conforming to neither declared schema — but the literal bodies
differ: these two return `{"status":500,"error":"Internal Server Error"}`, while `list_tags`
returns `{"type":"server_error","message":"Internal Server Error"}`. **Not one shared error
renderer.** Likely separate causes, and the product team should not be told to look for a single
fix.

## `get_test_run_progress` — the flake judgement was right

3/3 clean 200s on prod, zero 500s. The preprod call — that its null-body 500s were environment
intermittency rather than a defect, and should **not** be routed — is vindicated.

`configurations` is still empty, and the probe did not take that at face value: it corroborated
via two other capabilities that **TR-5401273 has 0 test cases mapped despite `run_state: done`**.
So "done" reflects lifecycle, not execution content, on that run. The emptiness is honest data,
and the per-configuration item shape remains genuinely **unexercised on both environments** —
it would need a different run.

## `list_binned_test_cases` — the half-fix traced to its commit

This is the most useful result of the batch, and it is not about prod at all.

The probe **confirmed the two declared sources disagree and found where**: the flat `returns`
array omits `template`, `created_by` and `creator_details`, while the expanded 200 schema
declares all three on each row. Traced to **commit `5816161`**, which added them to the response
schema's properties without touching `returns` in the same edit.

Then it confirmed the gate's blind spot **structurally**, not by inference: `scripts/check-contract.py`
walks `returns` entries looking for a backing schema property ("unbacked" detection) and **has no
check in the reverse direction** — schema properties missing from `returns`. So this defect is
invisible to the gate by construction. That is the concrete evidence behind the open
bidirectional-gate work item.

**The bin is empty on prod too** — and the probe checked two further large prod projects (36,154
and 945 cases) as well. Across both environments that is **8 projects, all with an empty bin**.
So the disputed item shape is unexercised anywhere, and the drift is **static, not environmental**.
Verdict moves DRIFT → UNVERIFIED on the item shape, with the contract defect standing on its own.

Two clean side results: archive and bin are **demonstrably separate stores** — the same project
has **86 archived** cases and **0 binned** simultaneously, with structurally different envelopes.
And `limit` **is** honored here (asked 5, got `page_size: 5`), unlike the `per_page` that was
ignored on `list_root_folders` on this same project — so that bug is per-capability, not
project-wide.


## `list_test_results_for_test_case` — PASS, and it validates the index corrections

Neither preprod defect reproduces, because **the index was already corrected for both** and prod
agrees with the corrected declaration.

- **`result_status` cut down to `{field_value}`** — confirmed on prod across 3 real results
  (Failed, Passed, Blocked) in 2 different runs. `id`/`internal_name`/`field_name`/`colour` are
  absent, exactly as the corrected declaration says. So prod is **not** the odd one out; both
  environments cut it down identically and the correction was right.
- **`custom_fields` as an array** — confirmed, `[]` on all 3 real results, matching the corrected
  v2 declaration.

**The v1/v2 serializer split is real and environment-independent.** On the *same underlying rows*,
v1 returns the full `result_status` object while v2 returns only `field_value`. And
`configuration_id` is **entirely absent** (not null) on v1 rows while v2 returns it as an explicit
`null` — the same asymmetry, confirmed on both environments. v1's `custom_fields` is still
declared `object` and still returns `[]`; that correction was never applied to v1.

**An honest miss, recorded as such.** Despite real effort — 3 closed runs read, a case with 2
linked Jira issues, a 21-case and a 28-case run scanned — `attachments`, `step_result`, `dataset`
and a populated `configuration_id` **never appeared**. Every real result in this project is a
plain case-level manual submission. Those shapes remain unverified across the entire campaign,
in both environments, and the probe said so rather than claiming a confirmation.

**Count-vs-rows** matched exactly on every call, but with near-zero power: the endpoint scopes to
one case in one run and no case had more than one execution, so a second page was structurally
unreachable rather than skipped.

**Incidental:** `search_test_results` reproduced its documented "failures swallowed,
`info: null`" defect on prod across 4 attempts. Out of scope for this verdict, but it reproduces.


## The four empty-collection cases — two resolved, two genuinely still empty

This was the batch prod was supposed to fix, and it half did. What matters is that the two that
stayed UNVERIFIED did so **after a real search**, not a perfunctory one.

**`list_shared_components` → PASS.** The very first unfiltered call returned **21 populated
shared fields**, item shape matching the declared contract exactly. Five variations (baseline,
`field_type` filter, `pre_fetch`, text search, `folder_id=null`) all stayed contract-clean, and
filter semantics were verified by **diffing id sets rather than comparing counts** — which is the
right way, since equal counts can hide a wrong filter. Preprod had probed 6 projects and never
found one populated row.

**`get_linked_test_case_selection` → PASS**, and it got there by ignoring my hints. Both runs I
suggested have **zero cases mapped**, and all three case ids I supplied have `issues: []`. Rather
than reporting a dead end, it scanned project-wide for non-empty `issues` arrays and found two
genuine Jira linkages (`DDSP-20813`, `KAN-14`) with live tracker URLs, both returning populated
`selection.folders` maps matching the declared shape.

**`list_folder_attachments` → UNVERIFIED after 12 folders** across 4 branches — both folders I
flagged as likely, their children, the 1,168-case Automation subtree and several of its 36
subfolders including one named "Photo and Media Upload Functionality", and the largest leaf
folder found anywhere. Every one returned `{success:true, attachments:[]}`.

Useful side finding: this endpoint declares **zero query params** and **actively rejects**
`per_page` ("unknown query: per_page. accepted: none") rather than silently dropping it. So the
silent-ignore failure mode seen on `list_root_folders` does not apply here — strict rejection
is the better behaviour and worth noting as the contrast.

**`validate_bdd_export_selection` → UNVERIFIED after searching ~3,125 of 16,267 cases (~19%)**
— two flagged folders exhaustively, the entire 55-folder Automation subtree exhaustively, and a
9-page project-wide spread across the full id range. Prod's BDD template exists (id 502, the only
one of 58 templates with `step_type: test_case_bdd`), but **no case uses it**. The probe did not
seed one, correctly honouring read-only. The 400 failure branch matches preprod byte-for-byte;
the 200 success branch is unexercised on both environments and is not counted as evidence either
way.

**Process note:** the probe caught and fixed an inconsistency in its own output before
finalising — `contract.undeclared_returned` had listed fields its own notes said matched the
contract exactly. Corrected to `[]`.


## `list_binned_test_cases` — RESOLVED 2026-09-22, the user binned cases

The bin was empty across 8 projects in both environments, so the disputed item shape looked
unresolvable by live probing. The user then moved 6 cases into the bin on project 332537, and
that settled it immediately.

```
returned but NOT in the flat `returns` list : created_by, creator_details, template
declared in `returns` but absent from rows  : none
```

**The response schema is correct; the flat `returns` list is incomplete.** Commit `5816161`
added `template`, `created_by` and `creator_details` to the schema's properties and never
touched `returns`. That was previously inferred from reading the contract — it is now confirmed
against six real rows.

**This is the exact blind spot of the CI gate.** `scripts/check-contract.py` walks
`returns -> schema` looking for unbacked entries. A field present in the **schema** but missing
from **`returns`** passes silently. These three are the proof case for making the gate
bidirectional.

Verdict **DRIFT**, not PASS: this is a genuine `undeclared_returned` of three fields against
real data — not an empty-collection artifact, so the 2xx-is-PASS rule does not apply.

Everything else verified clean against real rows:

| check | result |
| --- | --- |
| paging | 6 total across 2 pages, `total_pages: 2`, both pages correct |
| `limit` honoured | asked 5, got `page_size: 5` (unlike `per_page` on `list_root_folders`) |
| count-vs-rows | `metadata.total` 6 == 6 rows collected |
| `priority`/`status` | wide v1 **objects** with `field_value`/`internal_name`/`colour`, as guidance promises |
| `updator_details` vs `owner_details` | genuinely differ on 2 rows — binned by a different person than the owner |


---

# Phase 1 (v1) BLOCKED/DRIFT — prod recheck

## Project entity — 9 capabilities: 1 PASS, 8 DRIFT

| capability | preprod | prod | reproduces? |
| --- | --- | --- | --- |
| `get_projects_basic` | DRIFT | **PASS** | **no — preprod-only regression** |
| `get_projects_minify` | DRIFT | DRIFT | yes |
| `list_projects` | DRIFT | DRIFT | yes |
| `search_project_entities` | DRIFT | DRIFT | yes |
| `list_entity_filter_details` | DRIFT | DRIFT | yes — both open issues confirmed |
| `get_issues_count_info` | DRIFT | DRIFT | yes — **positional array, now with real data** |
| `get_closed_test_runs_info` | DRIFT | DRIFT | yes — **positional array, now with real data** |
| `get_test_case_count_trend` | DRIFT | DRIFT | yes, but a **different** drift than briefed |
| `get_test_case_type_split` | DRIFT | DRIFT | yes, but a **different** drift than briefed |

### CORRECTION 1 — the positional-array family is 2, not 3 of 4

I briefed this probe that three of four analytics/trend reads return 2-element positional
arrays where objects are declared. **That framing was wrong for two of them**, and the probe
said so rather than forcing the finding:

- **Genuinely positional** — `get_issues_count_info` and `get_closed_test_runs_info`.
  Both confirmed on prod with real non-zero data (`["Oct",7]`, `["Feb",10]`, June:1, August:1)
  where preprod's series were all-zero. The bug is real and now well evidenced.
- **NOT positional** — `get_test_case_count_trend` returns a genuine object map keyed by
  case-type name, and `get_test_case_type_split` returns a clean `{name,y,value,field}`
  object array. Both match their schemas on shape.

Their real drifts are different and were only visible at prod volume:

- `get_test_case_count_trend`: `data.Total` is **missing the required `field` key**, and
  `Total.value` is `[null]` — wrong-typed. Found across ~45 real case-type keys.
- `get_test_case_type_split`: the guidance claims **"`y` and `value` are the same count
  under two names"**. Prod disproves it decisively at scale — Functional `y=10113` vs
  `value=9379`; API `y=1` vs `value=851218`. `value` is an internal field-config id, not a
  count. A caller trusting the guidance and reading `value` as a count gets nonsense.

Also worth recording as a **non**-finding: the duplicate case-type rows seen on preprod do
**not** reproduce systemically — only 2 of 45 prod case-type names repeat, and those look like
genuine user-created junk types rather than a capability bug.

### CORRECTION 2 — the silently-ignored filter does not spread

The v2 projects listing on this account ignores `query`/`search`/`name`/`filter` entirely. I
asked how far that spread. **It does not.** All three v1 project listings filter correctly at
89k-project scale, verified with a real substring match plus a nonsense-string zero control:
`get_projects_basic.q[query]`, `list_projects.q` and `search_project_entities.q[query]`
all genuinely narrow. `get_projects_minify` has no filter param at all. The defect is
**isolated to the v2 listing**.

### `list_entity_filter_details` — both open issues confirmed, and precisely distinguished

- Filed under `entity=project` while being a filter-resolution capability, so `entity=filter`
  search and `describeEntity` both omit it. A **registry property**, identical on both
  environments.
- The `entity=test-plans` block is a **pure client-side `invokeCapability` schema rejection** —
  `{"ok":false,"error":"'entity' must be one of: test-cases, trtc, test-runs"}`, no HTTP layer
  involved. The handler-level 400 the contract describes is real per guidance but
  **structurally unreachable**, because the schema block always fires first. That distinction
  matters for who owns the fix: this one is ours.

### Count-vs-rows: clean on prod

Paged twice on all four listings — stable `info.count`, disjoint non-repeating rows,
`len(rows) == page_size` throughout. **No count-vs-rows contradiction on any of the nine**,
unlike the five preprod capabilities that showed it.


## Test plan entity — 6 capabilities: 2 PASS (reclassified), 4 DRIFT

| capability | preprod | prod | outcome |
| --- | --- | --- | --- |
| `list_archived_test_plans` | BLOCKED | **PASS** | **account limitation, not a defect** |
| `get_archived_test_plan_count` | BLOCKED | **PASS** | **account limitation, not a defect** |
| `list_test_plans_by_integer_id` | DRIFT | DRIFT | reproduces |
| `get_test_plan_by_integer_id` | DRIFT | DRIFT | reproduces |
| `list_test_plan_test_runs_by_integer_id` | DRIFT | DRIFT | reproduces |
| `get_test_plan_execution_trend` | DRIFT | DRIFT | reproduces, now with real volume |

### The feature flag was an account limitation — 4 capabilities reclassify

Both archived-plan reads return clean 200s on prod where preprod gave
`404 {"success":false,"errors":"Feature not available"}`. The group archive flag is **off on the
preprod test account and on for this prod account**. These were never product defects.

The same flag gates `bulk_archive_test_plans` and `bulk_restore_archived_test_plans`, which were
BLOCKED for the identical reason — they should reclassify the same way, though they were not
retested here and that is an expectation, not a measurement.

Item shape remains **unexercised anywhere**: this project has 0 archived plans, so no archived
row has ever been seen live in either environment.

### RETRACTION — the plan-linkage defect is preprod-only, not systemic

**I was wrong about this, repeatedly and confidently.** I described `list_test_runs_by_integer_id` returning
`test_plans: []` for every run as "proven systemic across two probes and two days" and told a
later probe it was "environment-independent — the strongest possible statement of the defect."

**It does not reproduce on prod.** The probe found plan 182865 linked to run TR-5217429 via
`list_test_plan_test_runs_by_integer_id`, then located that same run two pages into
`list_test_runs_by_integer_id(include_test_plan=true)` and found it correctly carrying
`test_plans: [{"id":182865,"name":"Testing parikshit"}]`. **The two readers agree on prod.**

What my preprod evidence actually supported was "reproduces reliably on preprod" — repetition
within one environment is not evidence about another. The finding stands, scoped to preprod.

A narrower gap **does** reproduce on both: `list_test_plan_test_runs_by_integer_id`'s own row-level
`test_plans` field is always empty, even on rows returned precisely because they are linked.

### NEW — `minify=true` zeroes real data on `list_test_plans_by_integer_id`

Not seen on preprod. Plan 182865 reports `test_runs_count: {active: 1}` normally and
**`{active: 0}` under `minify=true`** — falsely reporting zero runs on a plan with a genuinely
linked run. That is wrong data, not a slimmed payload, and a caller using minify for a plan
overview gets silently incorrect counts.

Note the contrast with `get_test_run`, where `minify` is a no-op on preprod and merely drops
keys on prod. Here it corrupts a value.

### Positional array — reproduces with far better evidence

`get_test_plan_execution_trend` declares `test_plans_execution_trend_graph` as a bare object;
it is actually an array of `{name, data}` series whose `data` entries are 2-element positional
`[date, count]` tuples. Confirmed on a real **16,432-item plan** across a 5-point, 2-series
trend — preprod only ever had a single datapoint.

### `q` filter hard-fails in every reachable shape

Nested `q:{query}` and `q:{tags}` both 400 with `"q should be a ActionController::Parameters"`;
bracket notation `q[query]` is rejected by the MCP tool's own schema before any HTTP call. So it
neither filters nor silently ignores — it fails, on both environments.

### Paging

`info.count` (69) is internally consistent across 3 real pages (30+30+9). The top-level
`count.{active,completed}=99` legitimately diverges per its own documented "not a page total"
caveat. The `include_sub_plans=true` desync reproduces exactly — a page mixes 24 top-level with
6 sub-plan rows while `info.count` still reports 69.


## Test case entity — 7 capabilities: 1 BLOCKED, 6 DRIFT

6 of 7 preprod verdicts reproduce exactly. The one that does not is the duplicate-option-id
doubling, and that absence is itself the answer.

### `get_test_case_detail` — the count IS broken, in BOTH environments, differently

This supersedes my earlier narrowing. I had said the undercount "looked specific to TC-54458's
data," keeping a threshold caveat. **Prod shows the field is broken here too — in the opposite
direction.**

| | preprod | prod |
| --- | --- | --- |
| observed | `test_run_results_count: 0` for a case with **14** real results | **`2`** for two cases with **1** real result each |
| direction | under-count | **over-count** |

Both cases in TR-4827350 were independently verified via two separate results-listing
capabilities to have exactly one result each, and both reported `2` — which is the **run-level
total leaking into each case's count**. That is a scope bug, and it **shows up at N=1**, which
kills the "only breaks above some threshold" hypothesis I had been preserving. A second case
(TC-1041803) reported `1` against 0 verified results — over-count again.

So the honest statement is: **`test_run_results_count` cannot be trusted in either
environment.** It is not a data artifact on one fixture case. Route it.

### `search_test_cases_by_folder` — genuinely dead, now beyond argument

11 exact-match invocations (by name, identifier and id) across three real folders — including
one with **972 cases** — every one returning `200 []`, against case data confirmed seconds
earlier by a working sibling. The contract self-declares it "DEPRECATED AND EFFECTIVELY DEAD…
queries the legacy local test-case table." The data-starvation hypothesis is dead with it.

### The duplicate option-id doubling does NOT reproduce — which confirms the conclusion

Every default option (Active, Functional, Not Automated) appears **exactly once** on prod. That
confirms what the preprod investigation concluded — the doubling was **historical data, not a
serializer bug** — and additionally localises it to the preprod account as migration residue.
The conclusion holds and is now sharper.

This project does have organic duplicate-name custom options ("Temp state" ×5, all
`is_default: 0`) — ordinary user junk, unrelated.

### The sort disagreement is settled — both directions work

Two preprod probes disagreed over whether `name-ASC` silently no-ops while `name-DESC` works.
On prod, against the full 16,267-row project, **both sort correctly** — strictly ascending and
strictly descending. Preprod's disagreement was an artifact of its tiny pool, not a defect.
`per_page` is also honoured here (5/20/50/100 all exact), and `info.count` held steady and
correct at **16,261** across every page size.

### Reproducing exactly

`test_case_steps` declared **object**, returned **array** — confirmed with real non-empty
content up to 13 items, on every capability exposing it. Sibling `steps` stays `[]` throughout.
`required[fields]` still silently nulls `assignee`/`owner`/`automation_state`. `field_name` is
present on five capabilities and absent on `get_system_field_values` — per-capability, not
entity-wide, exactly as preprod found.

### Two new findings only visible at prod scale

- **`search_project_entities_by_filter`'s `folder_id` filter is non-recursive.** It returns 972 for a
  folder whose true recursive total is 1,168. Invisible at preprod's 2-row scale.
- **`get_system_field_values` has unreliable paging metadata.** Non-final pages under-fill
  their declared `page_size` (26/30, 16/30 while claiming a next page), and q-filtered results
  disagree with their own `count` (declared 5, returned 1). A separate DRIFT from the
  duplicate-id question.


## Report entity — 3 capabilities, all DRIFT, all reproducing

### The shared serializer reaches the READ path — and the field exists in storage

The sharpest result here. `create_report_by_integer_id` and `update_report` were found on preprod to share one
serializer that drops the declared-**required** `data.mail_to` and adds 7 undeclared fields.
**`get_report_detail` does exactly the same** — same missing `mail_to`, same seven extras
(`updated_at`, `project_ids`, `included_projects`, `is_dynamic`, `grain`, `slack_notification`,
`slack_notification_supported`).

And the diagnosis is now precise: **`list_reports` DOES return `mail_to` on every row.** So
the field is in storage and populated — it is specifically the create/update/detail serializer
that drops it. That is a much more actionable statement than "a declared field is missing."

### The id-form trap is real, and worse than "be careful"

`list_schedules` resolved **SC-12541 → integer id 95008**. `list_reports` exposes only the
`SC-` identifier and no integer anywhere, and naively stripping the prefix gives **12541** —
nowhere near the real 95008. Only `list_schedules` pairs them. A caller who guesses does not get
an error; they silently read **a different report**. Confirmed for all three capabilities.

### NEW, prod-only — `tr_drilldown` returns 401

Not a preprod repeat: preprod returned a clean 200 with 30 rows for the identical
`tr_drilldown`/`active_runs` combination. On prod it **401s**, reproduced **4×** across two
different Test Run Summary reports and two widget types, through both `get_report_detail` and
`get_report_section`.

Every other section on the same reports succeeds, and `tc_activity_drilldown` on a Test Case
Activity report in the same project works fine (200, paginated, count matches rows). So it is
specific to `tr_drilldown`, not a broad permission failure. Cause undiagnosed and deliberately
not guessed at — reported as the shallowest failing path.

### Documented traps: three confirmed, one exonerated

| claim | verdict |
| --- | --- |
| `report_data` null means NOT COMPUTED, not "no data" | **confirmed** — naming sections populated every one with real figures (Passed 100, Failed 37) |
| `report_data_only="false"` is truthy and collapses the envelope | **confirmed** — the literal string still stripped `data`/`report_filters`/`project` |
| the SC-NNN → integer id trap | **confirmed**, see above |
| `is_print=true` forces all sections | **EXONERATED — it works.** Test Plan Summary went from 1 key bare to 12 with `is_print`. Mostly zero-valued, but genuinely computed: this project simply has little plan activity in the window. **Not** another silent no-op. |

`get_selected_report_testcases` reproduces preprod byte-for-byte: `selection_data` returns
**null** despite being declared non-nullable and required, and despite `report_filters` being
confirmed empty (the condition under which the docs promise an unfiltered selection tree).

Honestly recorded as still unverified: the item shape of a *populated* `selection_data`, and
`tr_drilldown` pagination on prod (blocked by the 401).


## Custom field + dataset — 3 DRIFT, 2 BLOCKED by a credential gap

### An access gap that needs you, not a code fix

`get_custom_field_dataset` and `list_workspace_fields` both return
**`403 "This action is not permitted for the user"`** with an SSO login_url, on every attempt —
two independently discovered id pairs, with and without `fetch_options`, and 9 attempts across
several modes with no variation.

**The whole v2 admin/workspace custom-field surface is gated the same way**
(`get_custom_field`, `list_custom_fields` too), while the **v1 project-form endpoints work
fine on the same project with the same credential**. A sibling succeeded in the same session,
so it is not transient.

The capability's own guidance predicts it: *"needs the field-view permission when role-based
access is on."* So this is a **role/permission gap on the probing credential, not an index
defect** — and it is a prerequisite before that surface can be verified at all. Scored BLOCKED
with `reproduces_preprod: unknown` rather than guessed either way.

What stays unverified because of it: the options-container question (array vs `{data, info}`,
and the undeclared `options.info` envelope), and whether `list_workspace_fields`'s `info`
shape still varies by mode.

### A third descriptor variant

`get_custom_field_values` returns
`{id, group_id, project_id, custom_field_id, dataset_id, option_value, is_default,
parent_option_id, record_status, created_at, updated_at}` — matching **neither** the
field-definition shape (A) nor the case-row shape (B). Found on real non-empty data: 120 values
on one field, 33 on another.

So the descriptor picture is now **three** shapes, not two, plus a thinned `automation_status`
sub-variant noted on `get_project_form_fields`.

### Confirmations worth having

**`get_project_form_fields`** still returns `system_fields` as an **object** against a
declared bare **array** and prose promising "three lists at top level" — the only capability in
this campaign where prose and schema are wrong *together*, now confirmed on prod.

**The default-option doubling does not reproduce** — a **third** independent confirmation that it
was preprod migration residue. Every `is_default:1` value appears exactly once across priority,
status, case_type, automation_state and automation_status. Organic duplicate *names* exist
(case_type "frsadas" ×3) and were correctly not counted as the same defect.

**`get_dataset`'s `created_by` drift is real implementation drift, not a data artifact** — checked
across **5 independent datasets and 7 creators** with zero variance: `browserstack_user_id` and
`group_id` declared and absent every time, undeclared `role` present every time. And the
`variables`/`rows` array shapes held cleanly at all 5 sites, confirming preprod's clean negative
against a far larger pool.

**The `get_system_field_values` paging bug does not spread** — `get_custom_field_values`
pages reliably across 33-row and 120-row fields, so that under-fill defect is specific to that
one capability rather than a shared helper.


## Version/history + tags — 4 DRIFT, 1 BLOCKED

### `get_test_case_history_diff` — a **fifth** category: a genuinely broken route

The most important check in the batch, and it goes the **opposite** way to the pattern seen
elsewhere this session. Four capabilities have reclassified from BLOCKED to account-limitation.
**This one does not.**

The prerequisite worked — three independent 2-revision cases were found and confirmed via
`list_test_case_histories`, all with real diffs. The diff call still **404s on prod**,
identically to preprod, with `{"success": false}` matching **neither** of its two documented
error shapes (the 422 plan-gate nor the structured 404). And this account has **full,
non-gated history access** (`plan_restriction: false` on every probe), so a tier gate is ruled
out.

**The route is genuinely broken or unwired.** Not an entitlement artifact.

### CORRECTION TO MY OWN SPECULATION — the `q`-filter 500 was correctly attributed

I suggested the `list_test_case_tags` `q`-filter 500 might have been **misattributed**, after
a related claim about `list_tags`'s `search` turned out false on prod. **That speculation was
wrong**, and the probe checked rather than accepting it: `findings/5xx-declared-inputs.md` and
`findings/update_tag.md` both name this capability explicitly, by name *and* by its literal
route (`.../test-case/tags-v2?q=`). It was found while cross-checking against `list_tags` but
never conflated with it. **The routing was correct.**

What is true is that it **no longer reproduces** — real tag substrings, a non-matching string
and a wildcard edge case all returned clean 200s on prod. Either fixed since, or a
preprod-fixture artifact. The capability still scores DRIFT for a different, confirmed reason:
`tag_objects` is declared required and silently absent on the no-`q` response, on real 31-tag
data.

### `search_group_tags` — registry narrower than the API, proven client-side

The enum boundary is settled **unambiguously**. `entity_type: "test_plan"` is rejected with **no
`http_response` field at all** — no status, no server body — proving a pre-flight
`invokeCapability` rejection. The probe contrasted it in the same run against a deep-page probe
that *did* produce a real `http_response: {status:500}`, making the difference impossible to
mistake. describeCapability's guidance that the value is "not validated… forwarded to backing
service" is **false**. **This is our fix, not the product team's.**

**And `count`/`next` are badly wrong at real scale** — invisible on preprod's tiny pool.
`entity_type=test_case` has **10,681 distinct tags** (356 full pages), yet `info.count` reports a
constant **31** on every full page, and `info.next` is correct only on **page 1** — every
subsequent page with real data left reports `next: null`. A caller paging this listing stops
after one page believing it is done.

### Reproducing exactly

`user.email` declared and never returned; `origin_channel` returned and never declared —
though on prod it carries **varying** values (`"api"`, `"ui"`, `null` by edit origin) rather than
preprod's constant `"api"`; and `get_test_case_history` drops `version_name` for a
`history_id` the listing carries it for, confirmed by same-id diff on two ids.

The **enrichment rule** reproduces exactly on a real 4-revision case: the newest row's listing
entry already carries the full `modified` map, so the single-read adds nothing and is *worse*
(it drops `version_name`); a non-first row's listing entry carries only `modified_fields` names,
and the single-read supplies the genuine old/new values the listing withheld.

### A fixture correction

The three prescribed cases in folder 9697326 each have only **one** history row (`source:
create`) — the opposite of the "prod has richer trails" assumption in my briefing. Two probes
reported that honestly as unverifiable for the checks needing a trail; two searched the project
read-only and substituted real multi-revision cases (TC-829017, TC-1971433, TC-1064488,
TC-1064493). The right handling in both directions.


## Folder + attachment — 3 DRIFT, 1 BLOCKED

### The `group_id` contradiction is SETTLED — and it is a serializer defect

The unresolved contradiction is resolved, and my "two distinct group concepts" hypothesis was
wrong. Within a **single** `list_folder_contents` response for folder 40231630's 36 subfolders:

- `folders[].group_id` = integer **`1`** on every one — the real value
- `self.contents[].group_id` = string **`"2"`** for the same folders in the same response

Verified at multiple nesting depths across dozens of folders, always identical: the
`self.contents[]` value is a **hardcoded-looking string `"2"` regardless of the folder's actual
group**. So it is neither two legitimate concepts nor a mutation-vs-read split — **two reads
disagree with each other inside one response**, and one of them is simply wrong.

`list_root_folders` returns a plain integer matching its declared type. `get_folder_tree`
declares `group_id` and **never emits it** on any of 447 nodes.

### `per_page` is a footgun, not an outright ignore

More precise than my earlier note: on `list_root_folders`, `per_page` **alone** is silently
ignored and falls back to 30 — but send `p` **alongside** it and `per_page` works exactly as
asked (3→3, 100→100). A caller who omits the page number silently gets the wrong page size.

`get_folder_tree` has no paging at all (447 nodes in one shot). `list_folder_contents`
accepts only `p`; `per_page`/`limit` are rejected client-side.

### `list_test_case_attachments` — BLOCKED, and proven data-independent

The probe did the hard version of this. Rather than concluding from an empty result, it found
that `search_project_entities_by_filter` embeds an **undocumented `attachments[]`** on each case row,
used that to sample **203 real cases**, and found **156 (77%) carry real attachments** — PDFs
and PNGs with filenames, sizes and checksums. Attachment data here is *abundant*.

Then tested a 1-attachment case, a 4-attachment case and a confirmed-empty case: **all three
returned an identical bare `{"status":500,"error":"Internal Server Error"}`**. The block is
universal and data-independent, exactly as the contract's own guidance warns ("calls a
collection method on a plain array... raises before serialising").

### A second broken recursive count

`get_folder_tree` returns **`total_cases_count: 0` on all 447 nodes** — including flat leaf
folders with real direct cases (folder 9600935 has 2,052 cases, 0 subfolders, and still reports
0). Stronger than preprod's ambiguous finding: it is not "descendant-only", it is **never
populated**.

That joins `search_project_entities_by_filter`'s non-recursive `folder_id` filter (972 vs a true 1,168)
— **two independent ways the recursive-count concept is unreliable**, while
`list_root_folders` and `list_folder_contents` both report it correctly (972 / 1168 / 36 exact).

## Test run reads — 4 DRIFT, all reproducing, three new defects

### `get_test_run_detail` — the guidance was fixed, the contract was not

Still returns only a run header with zero case rows despite the name. Notably prod's
`intent`/`guidance` text **has already been corrected** to say "no per-case rows" — but the stale
`all_test_cases` entry was never removed from the `returns` list. A half-fix, in the same shape
as the `list_binned_test_cases` one.

**NEW:** within a single response, `overall_progress` and `overall_progress_by_status_id`
**contradict each other** — TR-5041503 carries real Failed/Blocked/Untested counts in the
by-status map while `overall_progress` collapses everything into `untested` and zeroes the rest.
Reproduced on 2 runs.

The status-bucket disagreement between readers is **UNVERIFIED, not confirmed** — the probe paged
90 of 2,378 runs and found no run with untested split across two status ids; where comparable,
the two readers agreed exactly. Reported honestly rather than forced.

### `list_test_run_test_cases_by_integer_id` — grain confirmed, correctness gap found

Case×configuration grain reproduces exactly: one case appeared **3×** with distinct
`mapping_id`s in a single run. `mapping_id` write-instability was correctly **not** re-tested —
out of scope for a read-only task.

**NEW:** `latest_status` is stuck at `"untested"` even on rows carrying a completed
`result_status` — a correctness gap, not a contract one. And `test_run_results_count` is null on
**every** executed row across 3 runs, more systemic than preprod's single sighting.

**NEW:** out-of-range `per_page` (9999 / 101 / "abc") **hard-errors** rather than the documented
silent fallback to 30. Preprod never actually tested an out-of-range value, so the documented
behaviour was never verified there.

### `get_test_runs_form_fields` — a third descriptor shape, and silent data loss

Misnaming confirmed: `links.self` points at `/test-case/status`.

**NEW, and preprod's fixture could never have seen it:** `total_count = 57` but
`values.length = 30` — **27 statuses silently dropped, with no pagination mechanism to reach
them.** A caller enumerating statuses gets just over half of them and no indication.

**NEW:** prod has 3 configured `custom_fields` where preprod's fixture had none, and the declared
schema is badly off — `field_type` values outside the declared enum, the declared `options` key
replaced by an undeclared `option_values`, `id` declared string and returned integer, and a
**third distinct descriptor shape** `{id, option_value, is_default, record_status, created_at,
updated_at, dataset_id}`.

**A preprod correlation refuted and refined:** preprod suggested `value_category` was absent on
whichever row is default. On prod the default row is a custom "Conditionally Passed" status that
**does** carry it — the real rule is that `value_category` is absent specifically for
`internal_name = 'untested'`.


## User / result / exploratory — 3 DRIFT. Phase-1 reads COMPLETE (47/47)

### The id-space question is answered, and the contract is NOT silent

I had flagged that `id` and `browserstack_user_id` are different id spaces and asked whether the
contract says which is which. **It does, explicitly**: describeCapability's own guidance states
*"`id` is the Test Management user id — the one owner and assignee fields take.
`browserstack_user_id` is the BrowserStack account id for the same person."* Confirmed live —
`id` 305420 and `browserstack_user_id` 10836602 for the same user — and it matches
`assign_test_run_owner`'s observed behaviour exactly. A rare case of the documentation being
right about a genuinely confusing thing.

### A preprod finding CORRECTED rather than confirmed

Prod does have exploratory sessions — **8 active, 2 closed** — so this was DRIFT, not UNVERIFIED.
Most preprod defects reproduce (`timeline` log-shaped instead of lifecycle-shaped, `folder_id`
declared and absent, `name`/`summary` declared and absent).

But **the expanded `test_plan` does NOT reproduce.** Preprod left that sub-point unverified
because both its sessions had `test_plan_id: null`. Prod supplies the missing case — session 819
is linked to a real plan and `test_plan` comes back **fully populated**
`{id, identifier, name, parent_plan_id}`. That part of the preprod finding should be withdrawn,
not carried forward.

`actual_duration` reproduces exactly and sharply: session 819 reports **7** while its 3 timeline
rows sum to 7+0+0; closed session 810 reports 4 against a 4 sum. Still a black-box observed
pattern — no server code was read — and recorded as such.

### The v1/v2 serializer split, now corroborated from both sides

v1 returns the **full** `result_status` object (`id`, `field_value`, `internal_name`,
`field_name`, `colour`, `value_category`) across 4 sampled prod rows — independently confirming
from the v1 side what the v2 recheck showed from the v2 side. `configuration_id` absent and
`custom_fields` returning `[]` both reproduce exactly.

One sub-point **does not** reproduce: `info.truncated` was undeclared-but-present on preprod and
is simply **absent** on prod — which is *closer* to the declared schema, not further.

### A permanent gap, honestly recorded

**`attachments`, `step_result`/`test_run_step_result` and `dataset` have never been found
populated anywhere, in either environment, across this entire campaign** — despite deliberate
hunting across closed runs, large runs, and every reachable result. Both "Blocked" candidate runs
turned out to be empty on re-check. No positive find, and none claimed.

### A second fixture-staleness finding — and a caching defect behind it

`PROD-FIXTURE.md`'s "Blocked" example is stale: TC-1041809 is **no longer mapped** into
TR-3866741 (now 16 untested cases), and the alternate candidate TR-1806940 is also empty.

The part worth routing: **`list_closed_test_runs` still serves cached 1-Blocked progress
aggregates for both runs** whose underlying cases are gone. The aggregate contradicts the
run's own contents.
