# Destructive tier of `tm`: uniformly unreachable through `invokeCapability`

## Sweep

All sixteen destructive-mode `tm` capabilities other than `delete_test_case_attachment`
(excluded by design — the blob purge is queued before the response renders, so a failed
probe would leave attachment survival genuinely unknown) were invoked once each with a
plausible, well-formed argument set built from probe-created objects. Full arguments and
verbatim responses are in `tests/live/runs/tm/_destructive-tier-sweep.json`.

Capabilities probed: `delete_custom_field_dataset_option`, `delete_custom_field_dataset`,
`delete_custom_field_definition`, `delete_dataset`, `delete_filter`,
`delete_folder_and_contents`, `delete_folder_and_subtree`, `delete_report_schedule`,
`delete_shared_step`, `delete_test_plan`, `delete_exploratory_session`,
`delete_exploratory_session_log`, `bulk_delete_test_cases`, `delete_test_run`,
`bulk_delete_test_results`, `delete_test_result`.

## The refusal mechanism, verbatim

Every one of the sixteen calls returned the identical envelope shape, with only the
capability name substituted:

```json
{"ok": false, "error": "<name> is a destructive operation and is not available through this surface"}
```

For example:
- `delete_filter` → `{"ok":false,"error":"delete_filter is a destructive operation and is not available through this surface"}`
- `bulk_delete_test_cases` → `{"ok":false,"error":"bulk_delete_test_cases is a destructive operation and is not available through this surface"}`
- `delete_folder_and_subtree` → `{"ok":false,"error":"delete_folder_and_subtree is a destructive operation and is not available through this surface"}`
- `delete_test_result` → `{"ok":false,"error":"delete_test_result is a destructive operation and is not available through this surface"}`

No wording, casing, punctuation or field-shape variance was observed across any of the
sixteen — nor across the three previously-confirmed cases (`delete_filter`,
`delete_custom_field_definition`, `delete_custom_field_dataset`, the last two
re-confirmed again in this sweep with byte-identical messages). This is a single template
parameterised only by `name`, applied at a layer common to all sixteen capabilities
regardless of entity (filter, custom field, dataset, folder, report, shared step, test
plan, exploratory session/log, test case, test run, test result) or HTTP verb the
underlying route would use.

The refusal fires **before binding**: it is returned for a folder id, a made-up test-plan
id, a run identifier, and a bulk id array alike, with no dependence on whether the ids are
real, well-formed, or nonsense — consistent with a check against the capability's declared
`mode` (`"destructive"`, visible on every one of these in `describeCapability`) that runs
before path/query/body parameters are ever validated or an HTTP call is attempted. Nothing
was destroyed by any of these sixteen calls, by the same logic already established for the
first three.

**Refusal is uniform. No capability in the destructive tier behaves differently, in wording
or in timing.** None reached the API.

## 17 capabilities, permanently unverifiable here

Between this sweep (16) and the excluded `delete_test_case_attachment` (1), **17 published
`tm` capabilities can be discovered via search and have their full contracts read via
`describeCapability` — parameters, response schemas, guidance, permission notes, example
payloads — but not one of them can ever be invoked through this surface.** Their contracts
are asserted, in detail, by documentation that describes side effects, permission gates,
response envelopes and edge-case status codes as if the endpoint were live and callable
(e.g. `delete_test_run`'s guidance says "Confirm with the user before calling," and
`delete_report_schedule`'s guidance walks through a 200 response body with paginated
listings) — none of which can ever be produced, because the call never leaves this layer.
No live evidence for any of the 17 contracts can ever exist through `invokeCapability`;
whether those documented shapes are accurate is permanently unverifiable by this tool.

## Intended safety rail, not a gap — but with a real discoverability cost

This reads as a deliberate, blanket safety rail rather than an accidental gap: it is
applied uniformly across every entity type and every delete-shaped operation in `tm`,
with a purpose-written message rather than a generic 403/500, and it fires deterministically
regardless of argument validity — the hallmarks of an intentional policy gate, not a bug
that happens to trip the same way sixteen times.

That said, the caller experience has a real gap in *advance* warning:

- `searchCapability` surfaces all 17 in listings alongside ordinary invokable capabilities.
- `describeCapability` documents each one in full — parameters, guidance, response schema —
  written in the same voice and level of operational detail as any live, callable
  capability (permission requirements, "requires tc_write," "confirm with the user before
  calling," worked 200/404/422 bodies). Nothing in that text states, or even hints, that the
  call is unreachable. Only the `mode: "destructive"` field distinguishes it structurally
  from a write or read capability — and that field says "this is destructive," not "this
  will always be refused."
- Only `invokeCapability`'s own static tool description carries the actual policy sentence
  ("Capabilities whose mode is 'destructive' (deletes) are refused outright") — a caller has
  to already know to read the *tool's* description, not the *capability's*, to learn this in
  advance. Nothing at the `describeCapability` layer for an individual capability says so.
- The practical result: a caller does the full discover → describe → build-arguments
  workflow, in good faith, on a documented contract — and only the final call fails, every
  time, for all 17. The index gives no per-capability advance warning; only prior knowledge
  of the platform-wide policy (or, as here, having hit it before) does.

## Practical consequence hitting this campaign now

Several objects created earlier in this probing campaign cannot be cleaned up as a direct
result of this tier being unreachable:

- **Custom field `106131`** and its **datasets `31319`/`31320`** — delete paths for these
  *are* present in the published profile (`delete_custom_field_definition`,
  `delete_custom_field_dataset`, both directly probed above) but are unconditionally
  refused by `invokeCapability`, so they are stuck: discoverable, describable, and
  permanently un-deletable through this surface.
- **Configuration `5189868`** and **project `379339429`/PR-2011** — no delete capability for
  either object type was among the 17 destructive-tier capabilities enumerated for this
  sweep (configurations and projects aren't covered by any of the sixteen probed here or by
  the excluded attachment delete). If a delete capability for configurations or projects
  exists in the profile at all, it fell outside this sweep's scope; what's confirmed is that
  none of the enumerated destructive capabilities reaches either object, so their delete
  paths are effectively absent from what's reachable here — the same practical dead end as
  the custom-field/dataset case, just via non-existence rather than refusal.

Either way — refused-but-present, or absent-from-the-reachable-set — the outcome for this
campaign is identical: these five probe-created objects have no cleanup path through
`invokeCapability`, and will need removal by some other route (or will remain as residue).

## Addendum — a third hand-written tool 401s

Separate from the destructive tier, three **hand-written** tools (not registry capabilities) have
now been observed returning **401** against TM hosts during this campaign: `listFolders`,
`listTestCases`, and now `listTestPlans`. Each time, the equivalent registry capability
(`describeCapability` + `invokeCapability`) worked immediately against the same project with the
same credentials.

That pattern is worth a look on its own: the hand-written tools appear to authenticate
differently from the capability registry, and they fail closed. It is not part of the
destructive-tier finding, but it is the third sighting and the probes keep tripping over it.
