# Tags can be created; the tag *listing* is what is broken

- **Product:** tm · **Capabilities:** `list_test_case_tags_v1`, plus the ~25 write capabilities that accept `tags`
- **Environment:** **production**, 2026-09-23
- **Status:** one index/mapping correction (done), one product defect (for the team).

## The question that prompted this

"Create a tag is blocked? We must be able to create a tag, right?"

**Correct — you can.** I had marked the *Create a tag* workflow blocked, and that was wrong. The
error was mine, and it came from trusting a workflow→capability mapping instead of testing the
workflow.

## There is no create-tag capability, and none is needed

No endpoint in the index creates a tag on its own. Tags are created **implicitly** by attaching a
new name to something — about 25 capabilities take a `tags` array, and `create_test_case_v2` says
so in as many words: *"Free-text tag names; created if new."*

Proven on production:

```
tag "mcp-newtag-123738" exists beforehand?   No   (project has 30 tags)
POST /test-cases  {"test_case": {..., "tags": ["mcp-newtag-123738"]}}   -> 200
```

The tag now exists, with a real id and creation timestamp:

```
search_group_tags     -> {"tags":[{"id":41829771,"name":"mcp-newtag-123738"}]}
search_test_case_tags -> found, created_at 2026-09-23T07:07:39Z
```

So the workflow works. What it does **not** have is a dedicated capability, which is why the
workflow sheet maps it to `verify_test_case_tags_v1` — a *check whether these names are in use*
read, not a create. That capability does 500, but it was never the thing that creates a tag.

**The mapping is the problem, not the capability.** A workflow whose only mapped capability is a
verifier will always look blocked when the verifier breaks, even though the workflow itself is
fine.

## The real defect: `list_test_case_tags_v1` under-reports and omits new tags

Measured on the same project immediately after the tag was created:

| | |
| --- | --- |
| `info.count` | **31** |
| distinct tags actually returned across page 1 and page 2 | **60** |
| pages overlap? | no — 30 + 30, zero intersection |
| newly created tag present? | **no**, on either page, re-checked over ~18s |

Two things wrong at once. The count is roughly **half** the number of rows the endpoint itself
serves, so a caller sizing a walk from `count` stops less than halfway. And a tag that demonstrably
exists — two other readers return it, one with an id — never appears in the listing at all.

The other tag readers are fine: `search_test_case_tags` and `search_group_tags` both find it
immediately. `list_tags_v3` is separately dead (500 on all five `entity_type` values, three
accounts).

That leaves the tag surface with **three of five readers broken or lying**, while creation works.

## What I corrected

- The *Create a tag* eval is back to its original **P1** — the workflow is exercisable today.
- The demotion rationale was rewritten so nobody re-applies it from the same bad inference.

## What the product team should look at

Why `list_test_case_tags_v1` reports a count that disagrees with its own pages, and why a tag
returned by both search endpoints is missing from the listing. A caller that lists tags to offer a
picker will silently omit recently created ones.
