# The duplicated option ids are historical data, not a serializer bug

- **Product:** tm
- **Environment:** preprod (`test-management-preprod.bsstag.com`)
- **Status:** closed. No action for the product team; one note for whoever reads the old rows.

## The question

Every default dropdown in project PR-2005 returns each option value **twice**, in two disjoint
id ranges: priority 8 rows for 4 distinct values, status 10 for 5, case_type 22 for 11.

This sat open for most of the campaign because the obvious explanation kept failing. "The lower
id block is canonical" was **contradicted by evidence**: the fixture's known-good setup ids sit
in the lower block, yet `get_project_form_fields` returned an **upper-block** id for
case_type "Other". A dedicated hunt through `get_test_runs_form_fields` for a discriminator
— `entity_type`, `record_status`, a per-option count, `is_active` — found none.

## What settled it

Create a brand-new dropdown custom field with three options, then read it back.

`create_custom_field_definition` minted field **106131** with options **146665 / 146666 /
146667**. Read back through `get_project_form_fields` — the same capability that
shows the old rows doubled — the three new options came back **exactly once each**.

That is the whole argument. A serializer that doubles rows would have doubled these too. It
didn't, so the doubling is not in the read path. **The duplicate rows are real rows in
storage**, created historically, and only the old default-field options carry them.

## The corollary: both copies are live

Separately, `create_test_case_by_integer_id` was given the **upper** block deliberately — priority 318618,
case_type 318626, status 318632, instead of the fixture's lower-block ids. The write was
accepted and the response echoed those exact ids back with correctly matching names and
internal names. **No rejection, no silent substitution to a canonical copy.**

So the two blocks are not canonical-and-stale. They are both live and interchangeable, which is
why no discriminator field was ever going to be found — there is no distinction to encode.

## What this means for a caller

Nothing breaks. Either id works. But an agent that lists options and presents them to a user
will show every default value twice, and an agent that de-duplicates by **name** will silently
discard an id that some other part of the system may be using.

The only real cost is that de-duplication has to happen client-side, and the contract says
nothing about needing it.

## What was NOT established

Which block came first, or why the duplicates exist in the data. That needs someone with
database access to the project's history, and it does not affect correctness for any caller.

One narrow new fact worth recording: options on **newly created custom fields** do carry a
`record_status: "active"` discriminator, along with `created_at`/`updated_at`/`dataset_id`.
The old `default_fields` priority/status/case_type rows carry none of these, so the
discriminator is specific to custom-field options and cannot be used to sort out the legacy rows.
