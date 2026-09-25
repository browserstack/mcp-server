# `get_template` drops the two fields `create_template` refuses to work without

- **Product:** tm · **Capabilities:** `create_template`, `get_template`
- **Environment:** **production**, 2026-09-23
- **Status:** for the product team. The index now documents the workaround; the product still has a closed loop.

## The defect in one line

A template read does not return the fields a template create demands, so **read-a-template →
create-a-copy can never succeed**, and the error tells you nothing about which fields are missing.

## The evidence

`create_template` rejects any body whose field list omits system fields **17 and 18** (the
Review & Approve pair):

```
400 {"success": false,
     "message": "Error creating template from {…} templateFieldValidationError:
                 Non-removable System fields not present in template."}
```

`get_template` never returns those two fields. On **every** template in the workspace the
listing's `field_count` is exactly two higher than the number of entries the detail returns:

| template | `field_count` (listing) | entries returned (detail) | missing |
| --- | --- | --- | --- |
| Test Case Steps (system) | 16 | 14 | **2** |
| Test Case BDD (system) | 18 | 16 | **2** |

The decisive test: I created a template sending exactly 16 fields, ids
`1,2,3,4,8,9,10,11,12,13,14,15,16,19` **plus 17 and 18**. It succeeded — `201`, template
`1088008`. Reading that same template straight back returns **14** entries, and the two absent
from the response are precisely `17` and `18`. The read drops the fields the create required,
on a template whose contents are known exactly because they were just supplied.

## Why it is worse than a missing field

Three things compound:

1. **The only discovery path is the read.** Field ids cannot be guessed, and the capability's own
   guidance says so. The read is where a caller is meant to learn them — and it is the thing
   omitting them.
2. **The error names no field.** "Non-removable System fields not present" does not say which,
   how many, or where to find them. There is no per-field error list.
3. **The gap is invisible.** The detail response looks complete. Only comparing it against the
   listing's `field_count` reveals two entries missing, and nothing prompts a caller to do that.

I found `17` and `18` by noticing the id sequence returned by the read jumps `…16, 19`, and
guessing at the hole. That is not a discovery path anyone should need.

## A second, smaller inconsistency found alongside

The request and the response spell the same two concepts differently:

| concept | request (`linked_projects`) | response |
| --- | --- | --- |
| the project list | `link_projects` | `project_count` / linkage |
| future projects | `link_to_future_projects` | `future_projects_applicable` |

The request keys are not documented anywhere; I recovered them from the server's own error echo,
which helpfully returns the parsed body.

Also note the entries' `id`: in a **request** it is the *system field id*; in a **response** it
is the template-field *mapping row* id, with the system field id in a separate
`system_field_id`. Posting a read's entries back unchanged therefore fails twice over.

## Correction to an earlier note

This capability was previously recorded as BLOCKED by an entitlement gate — *"200 +
{success:false, This Feature is only for paid customers}"*. That is not what happens. With a
credential that lacks the permission it is a clean **403 `This action is not permitted for the
user`**; with a credential that has it, the capability works. The older note conflated a
permission gap with a plan gate.

## Suggested next step

Return the non-removable system fields from `get_template` — that alone closes the loop. Failing
that, name the missing fields in the 400.
