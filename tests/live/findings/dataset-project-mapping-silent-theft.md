# Mapping a dataset to a claimed project silently unlinks the other dataset

- **Product:** tm
- **Environment:** preprod
- **Status:** for the product team.

## What happens

Custom field 106131 had two datasets: **31319** linked to PR-2005, and **31320** linked to
nothing. Mapping **31320 → PR-2005** — a project 31319 already owned — returned:

```
200 {success: true}
```

and **31319's `linked_project_count` dropped 1 → 0.** PR-2005 was reassigned. Neither response
mentioned it. The only way to discover it was to independently re-read the sibling dataset.

## Why this is worse than the documented behaviour

The capability's guidance warns that claiming an already-claimed project *"fails with a masked
400"* — i.e. it errors, just unhelpfully. That is not what happens. **There is no error to
mask.** The one-project-per-dataset-per-field rule is real, but it is enforced by **silent
last-writer-wins reassignment** rather than rejection.

So a caller following the documentation prepares to handle a 400 that will never arrive, and
receives a success code for an operation that quietly detached another object's configuration.

The blast radius is cross-object: the damage lands on a dataset the caller never named and may
not know exists.

## What is correct here

Worth stating, because it contrasts sharply with a sibling: `link_projects` and
`unlink_projects` are **genuinely additive deltas**, not a full replace. Linking a second
project left the first in place (count 1 → 2); unlinking one removed exactly that one. The docs
and the behaviour agree.

That matters because `edit_test_run.test_case_ids` is documented "additive … never removes" and
is in fact a destructive replace. Two capabilities, opposite documentation accuracy. There is no
consistent house rule a caller can rely on — each field has to be tested.

## Suggested next step

Either reject the conflicting mapping with a real, unmasked 4xx naming the dataset that
currently owns the project, or — if last-writer-wins is intended — return the displaced dataset
in the response so the caller knows what it took. A success code that silently reconfigures a
second object is the one option that cannot be handled correctly.

The guidance should be corrected regardless, since it currently describes an error path that
does not exist.

## Evidence

Custom field 106131, datasets 31319/31320, projects PR-2005 (379335744) and PR-2011
(379339429), 2026-09-22. Four write attempts, all 200 first try. Full trace in
`tests/live/runs/tm/update_custom_field_dataset_project_mapping.json`.

**State was restored**: 31320 → PR-2011 only, 31319 → PR-2005 as before. Verified by read.
