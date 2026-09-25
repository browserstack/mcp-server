# Capabilities whose input is a file cannot be invoked at all

- **Product:** tm
- **Environment:** preprod
- **Owner:** us — this is a registry/transport gap, not a product defect.

## The gap

`invokeCapability` accepts JSON only: `path_params`, `query`, `body`. A capability whose
content-bearing input is a **`multipart/form-data` file part** has nowhere to put its bytes, so
the registry cannot describe it and an agent cannot call it.

`import_dataset_csv` is the confirmed case. `describeCapability` declares exactly **one**
input — the path param `project_id`. There is no body field at all, because the real input is a
file. Invoked anyway to verify rather than trust the documentation, it returns
`400 {"error":"No file uploaded"}` — precisely what the guidance predicts.

Only one attempt was spent. With zero declared fields for the file there is no alternative
payload shape to try; guessing an undeclared key would test a guess, not the contract.

## Scope

The registry already marks this one **QUARANTINE CANDIDATE** in its own guidance, which means
the problem is known. What is not established is how many others share it. Three
attachment-upload capabilities are queued and are near-certain to be identical:

- `link_attachments_to_test_case`
- `upload_generic_attachments`
- `upload_ai_attachments`

**Now probed, and the answer is more interesting than "all four are the same".**

| capability | reachable? | what happens |
| --- | --- | --- |
| `import_dataset_csv` | no — multipart | `400 {"error":"No file uploaded"}` — loud, honest |
| `upload_generic_attachments` | no — multipart | **`200 {"generic_attachment":[]}`** — silent false success |
| `upload_ai_attachments` | no — multipart, **same handler** | **`200 {"generic_attachment":[]}`** — silent false success |
| `link_attachments_to_test_case` | **yes — JSON** | reachable, but 500s unconditionally (a server bug, not a transport gap) |

Two corrections to the original framing:

**One of the four is not a transport casualty at all.** `link_attachments_to_test_case` takes
a JSON array of integer blob ids and is perfectly expressible here. It simply never works — its
handler calls an attach method the object does not have, and every well-formed request returns
a bare 500. That is a product bug in a well-specified endpoint, and it belongs with the product
team, not with this transport gap.

**The two genuine multipart cases fail worse than the CSV import.** Where
`import_dataset_csv` returns a loud `400 "No file uploaded"`, both uploads return
**`200` with an empty array**. An agent can read that as "succeeded, zero files" and move on.
A silent false success is materially more dangerous than a clear rejection, and it is the same
shape as the entitlement-gate defect recorded elsewhere in these findings: a refusal wearing a
success code.

## Why it matters beyond these four

An agent reaching for one of these gets a `400` telling it a file is missing, with **no way to
supply one**. The contract does not say the capability is uncallable; it simply describes an
endpoint that cannot be driven from here. That is worse than the capability being absent,
because discovery succeeds and only the final call fails.

This is the same shape as the destructive tier — discoverable, fully documented, never
invokable — but with a different cause and a different fix.

## Two options

1. **Quarantine them consistently.** Only `import_dataset_csv` carries a machine-readable
   marker. All three uploads carry accurate *prose* guidance describing the exact failure — better
   than a silent trap, but nothing a tool can act on. An agent reading only `mode: "write"` and the
   parameter list burns a live write attempt and, for the two uploads, misreads a 200 as success.
   The marker needs to be machine-readable so `searchCapability` can down-rank or exclude them.
2. **Add a documented base64 body escape hatch** to `invokeCapability`, if the underlying API
   accepts base64 in place of multipart. That needs checking per endpoint — it is an API
   question, not a registry one, and should not be assumed.

Option 1 is honest and cheap. Option 2 actually restores the capability, where the API allows.

## A second, separate defect on this capability

`import_dataset_csv` is marked `mode: "write"` and named as an import, but **even if it were
reachable it writes nothing**. Its declared 200 is a bare parse preview —
`{data: {success, headers, rows}}` — with no dataset object and no uuid. It parses a CSV and
returns what it saw.

The real CSV-import path is: parse client-side, then call `create_dataset`, which this campaign
exercised cleanly. So the name, the mode and the intent all point an agent at the wrong thing,
independently of the transport problem.

## Evidence

Project 379335744, 2026-09-22. Full trace in `tests/live/runs/tm/import_dataset_csv.json`.
The existing probe dataset was re-read afterwards and confirmed unchanged.
