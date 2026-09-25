# Setting a test case's `status` by name returns 200 and wipes the field

- **Product:** tm · **Capabilities:** `edit_test_case`, `edit_test_case_partial`, and the bulk edits
- **Environment:** **production**, 2026-09-23
- **Status:** for the product team. The index documents it now; the behaviour is still destructive.

## What was reported

> "Custom State for TCs not writable, every custom status value fails; for eg in TCM we have
> 'Inactive' as custom state but when marking the same state through MCP it says it isn't even
> valid. Only default states of TCs supported currently."

## What is actually happening

**Custom states are fully writable.** The report's conclusion is wrong, but it was reached
honestly, because the real behaviour is worse than a rejection.

Verified on a production project with two custom status values (`Yes`, `No`) alongside the five
built-ins:

| sent as | result | status after |
| --- | --- | --- |
| `40339183` — built-in *Draft*, by id | 200 | **Draft** ✅ |
| `40343472` — **custom** *Yes*, by id | 200 | **Yes** ✅ |
| `40343470` — **custom** *No*, by id | 200 | **No** ✅ |
| `"No"` — a **valid, existing** custom name | **200** | **null** ❌ |
| `"Inactive"` — a name that does not exist | **200** | **null** ❌ |

So custom values write perfectly **by id**. What fails is the **name** — and it does not fail
loudly. It answers `200`, reports no error, and sets the field to null, destroying whatever the
case had. A caller who sets a status by name and checks the response sees success; the case
silently loses its state.

## Why this is easy to walk into

`priority` and `case_type` **do** resolve display names, on the very same call:

| field | name accepted? | on failure |
| --- | --- | --- |
| `priority` | yes — `"High"` → High | — |
| `case_type` | yes — `"Functional"` → Functional | — |
| **`status`** | **no** | **200, field nulled** |

Two of the three descriptor fields take a name; the third takes a name, says nothing, and wipes
the value. Nothing in the request distinguishes them.

## Where the ids come from

`get_system_field_values` with `field_name=status`. Two things about that response are worth
knowing, because neither is obvious:

- the options are under `status.values[]`, and **the id is in `value`**, not `id`
- **custom options are the ones with no `colour`** — built-ins carry a colour token, custom ones
  omit the key entirely. That is the only structural marker distinguishing them.

## What the framework does and does not do

The capability index does **not** restrict status to built-in values — it declares
`type: integer` with no enum, so nothing on this surface was ever rejecting custom states. The
index's guidance already said the name is not resolved here. What it did not say, and now does,
is that the consequence is a silent null rather than an error.

## Suggested next step

Either resolve the name as `priority` and `case_type` already do, or reject an unresolvable
status with a 4xx. Returning 200 and nulling the field is the one option that loses data while
reporting success.
