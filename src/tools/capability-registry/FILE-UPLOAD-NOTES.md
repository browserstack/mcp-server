# File upload through the capability registry — findings and plan

Working notes. Not published anywhere yet; the Confluence onboarding page and the Jira
epic still say nothing about this.

**Decision taken (2026-09-15): capabilities that need a file are NOT listed on the remote
MCP server.** Rationale in §3.

---

## 1. What is broken today

Four tm capabilities are discoverable, invokable, and can never succeed:

| capability | part | shape |
| --- | --- | --- |
| `link_attachments_to_test_case` | `attachments` | `array<string/binary>`, required |
| `upload_generic_attachments` | `files` | `array<string/binary>`, 1..10, required |
| `upload_ai_attachments` | `files` | `array<string/binary>`, 1..10, required |
| `import_dataset_csv` | `file` | `string/binary`, required |

Measured against `1.5.0-beta.16`, invoking one:

```
POST https://tm.example/api/v1/projects/1/folder/2/test-cases/3/attachments
headers: Content-Type: application/json
body   : (none)
→ 400
```

It passes validation (there is nothing to validate — the index publishes no body params),
**consumes a human approval** because `mode` is `write`, reaches the product, and fails.
That is worse than absent: the existing design already excludes irreversible deletes from
the catalogue on the grounds that "a capability nobody can invoke is only search noise",
and this additionally costs the user a confirmation.

`import_dataset_csv` states the problem in its own published intent: *"Import a CSV
dataset — NOT SUPPORTED in this profile"*.

> **Correction, 2026-09-24.** The table above says `link_attachments_to_test_case` takes
> `attachments` as `array<string/binary>` — multipart. **It does not.** The live probes
> established, and the index's own guidance now records, that its body is ordinary JSON and
> `attachments` is a list of INTEGER blob ids from a prior generic upload: *"Despite the
> name and the published spec this is NOT a multipart file upload."* The published spec is
> what this table was read from, and the spec is wrong.
>
> It still belongs on the disabled list, for a different reason: **it is permanently
> broken.** A well-formed request returns a bare 500 — the handler calls an attach method
> the object it holds does not have, so it raises before anything is stored, and *"there is
> no request that makes it succeed"*. So three of the four are withheld for multipart and
> this one for a defect. The flag does not distinguish, which is the point of not carrying
> a reason — but the record should.
>
> Worth noting what this means for the other three: **`upload_generic_attachments` and
> `upload_ai_attachments` answer 200 with `generic_attachment: []` when called with no
> files.** They do not error. A call from this surface looks like it succeeded and uploads
> nothing, which is a stronger argument for withholding them than the 400 described above.

## 2. Why — two independent gaps

**Producer.** `scripts/capability-registry/registry/build.py:440` reads request bodies:

```python
for media, entry in content.items():
    if "json" not in media:
        continue          # multipart skipped, schema stays {}
    ...
```

No match ⇒ empty `properties` ⇒ `return []`. The multipart body is discarded **silently**:
no warning, no counter, nothing in the build log. Same failure mode as `guidance: 0`
shipping unnoticed for a release.

**Consumer.** `src/tools/capability-registry/egress.ts` hardcodes
`"Content-Type": "application/json"` (line 99) and `JSON.stringify`s the body (line 152).
There is no multipart path, and `Transport` has no parameter that could carry bytes.

## 3. Why these are not listed on the remote MCP

The same tool surface runs in two places:

| deployment | shares the user's filesystem |
| --- | --- |
| stdio (`node dist/index.js`, npx) | yes |
| `mcp.browserstack.com` — stateless Streamable HTTP | **no** |

An agent cannot supply bytes — a 2 MB file is ~2.7 MB of base64, ~700k tokens through the
model's context — so the only workable argument is a **path**. On the remote server a path
resolves against *BrowserStack's* filesystem, not the user's. That is not a clean "file not
found": it is a file-read-and-exfiltrate primitive on a shared multi-tenant host, reachable
by a model that guesses `/etc/passwd` or `/proc/self/environ`.

It also breaks the guarantee every other capability keeps. "Nothing is minted" means an
agent can only reach what the user's own credentials already grant. A filepath upload is
the first thing on this surface that reaches data the credentials have nothing to do with:
the local disk.

**Therefore: file-bearing capabilities are registered on stdio only.** On remote they are
not listed at all, rather than listed-and-refused — consistent with how destructive deletes
are handled.

## 4. What OpenAPI already gives us

Everything except the bytes. All three harness specs are OpenAPI 3.0.1, with **zero**
`in: formData` parameters and **zero** binary parameters — so in 3.x a file can only live
in the request body, and the part name is the property key. No ambiguity to resolve.

```yaml
requestBody:
  required: true
  content:
    multipart/form-data:            # the content type IS the key
      schema:
        properties:
          files:                    # ← the part name
            type: array
            items: {type: string, format: binary}   # ← format: binary = file
            minItems: 1
            maxItems: 10
        required: [files]
      encoding:
        files:
          contentType: image/*, application/pdf, application/*, text/*
```

| needed | derived from |
| --- | --- |
| location | always `body` in 3.x |
| part name | the property key |
| is it a file | `format: binary` (3.0) / `contentMediaType` (3.1) — **handle both** |
| one or many | `type: array` vs `type: string` |
| how many | `minItems` / `maxItems` |
| accepted MIME | `encoding.<part>.contentType` |
| required | part in `schema.required`, and `requestBody.required` |

Audit across the harness: **4 multipart requests, all tm** (a11y 0, tra 0). **All 199
declared responses are `application/json`** — no binary downloads anywhere, so the download
direction already works unchanged.

One trap: one of the four reaches its body through `components/requestBodies/AttachmentsRequest`,
so a text search finds 3 and a deref finds 4. Any fix must deref.

## 5. Plan

### 5.1 Index — carry the content type

Absent ⇒ `application/json`, so every existing capability is byte-identical and nothing
needs regenerating.

```json
{
  "name": "upload_generic_attachments",
  "content_type": "multipart/form-data",
  "body": [
    { "name": "files", "type": "array", "item_type": "file", "required": true,
      "minItems": 1, "maxItems": 10,
      "accepts": ["image/*", "application/pdf", "text/*"] }
  ]
}
```

`build.py` stops skipping non-JSON media, emits `content_type`, maps `format: binary` to
`item_type: "file"`, and carries `encoding.<part>.contentType` as `accepts`. It must also
**count and report** what it cannot express, next to the existing withheld-key_facts and
missing-description counters — the silent drop is half the reason this went unnoticed.

Must handle a **mixed** body (`{file: binary, description: string}`). None of tm's four
have one, so a naive implementation passes today's specs and breaks on the first product
that sends a caption with its image.

### 5.2 `invokeCapability` — the argument

New optional argument, sibling to `path_params` / `query` / `body`:

```ts
files: z.record(z.array(z.string())).optional()
// { "files": ["/Users/me/shot.png", "/Users/me/log.txt"] }
```

Keyed by **part name**, values are **absolute local paths**. Not inside `body`, because
`body` is JSON the caller composes and these are not values — they are references the
server resolves. Keeping them separate also makes the refusals below trivial to write.

### 5.3 `invokeCapability` — the checks, in order

Every one of these happens **before** the write-consent gate, so a malformed upload never
costs an approval (the existing rule for parameter validation).

1. **Transport.** Not stdio ⇒ refuse: *"file upload is available only on the local MCP
   server"*. Decided at registration — on remote these capabilities are not registered at
   all, so this is the belt to that braces.
2. **Capability wants files?** `content_type` is not multipart but `files` was passed, or
   vice versa ⇒ refuse naming the mismatch.
3. **Arity** against `minItems` / `maxItems`.
4. **Path hygiene**, per path: must be absolute; must exist; must be a regular file (no
   directories, no globs, no device files); resolved realpath must not escape via symlink;
   refuse an explicit deny-list (`~/.ssh`, `~/.aws`, `.env`, anything under a `.git`
   directory).
5. **Size cap**, per file and in total.
6. **MIME** sniffed from content, checked against `accepts`. Sniffed, not taken from the
   extension — the extension is attacker-controlled in the sense that the model chose it.

### 5.4 Consent — this is the part that matters

`user_permission: granted` for *"attach a screenshot"* is **not** informed consent for
`~/.ssh/id_rsa`. The refusal that asks for approval must name, for every file: the
**resolved absolute path**, the **size**, and the **sniffed MIME type**. The human approves
those specific files, not the idea of an upload.

This is a stronger requirement than the existing write gate, which only needs
`change_summary` prose. Worth considering a distinct argument (`files_permission`) so that
a granted write cannot be replayed with a different file list.

### 5.5 Egress

`Transport` grows an optional `contentType`. For multipart the transport builds `FormData`
and **must not set `Content-Type`** — fetch has to generate the boundary itself; setting it
by hand is the classic way to break multipart. Scalar parts append as strings, file parts
as `Blob`/`File` read from disk.

The same switch handles `application/x-www-form-urlencoded`, `text/csv` and
`application/octet-stream` for free.

## 6. What to push products toward instead

**Three-step pre-signed URL**: request an upload URL → the client PUTs the bytes directly →
a capability confirms with the returned id. Bytes touch neither the model nor our server,
it works identically on stdio and remote, and **all three steps are ordinary JSON
capabilities needing no new machinery at all**. tm already has the shape of it in the
download direction (`get_report_attachment_url`).

So the honest framing for the onboarding page: *file upload is supported on the local
server only; for remote, expose a pre-signed URL flow.* A product team should know before
onboarding that shipping a multipart endpoint means their agent story is local-only.

## 7. Sequencing

1. ~~**Refuse at bind, and stop publishing what cannot work.**~~ **DONE 2026-09-24** — see §8.
   Small, stopped a real failure today — four capabilities that burn an approval and 400.
   Independent of everything else.
2. **Report the silent drop** in the build log. A few lines beside the existing counters.
3. **Carry `content_type` + `item_type: file` + `accepts`.** Producer-side only; the server
   ignores fields it does not know, so this can land before any runtime work and makes the
   refusal in (1) accurate instead of heuristic.
4. **Onboarding page + pre-signed pattern** documented, so no further products build into
   this hole.
5. **stdio-only multipart** with §5.3/§5.4 — only if a product genuinely cannot offer
   pre-signed URLs.

---

## 8. Step 1 as built (2026-09-24) — the `disabled` flag

Implemented as a general capability-index flag rather than a hardcoded list of four names,
because "cannot work on this surface" is not unique to file upload — it is the same shape
as the destructive tier, and the next case (an endpoint behind an entitlement nobody has, a
route withdrawn mid-release) should not need another code change.

**Contract.** `Capability.disabled?: boolean`. It **fails closed**: any truthy value hides
the capability, including a shape we did not expect. A flag whose only job is suppression
must never be ignored for arriving wrong.

**No reason is carried.** The first cut made this `boolean | string`, the string being the
explanation, quoted back in the refusal. It paid for itself nowhere: **one** consumer, on a
path the flag itself makes rare, at **1216 bytes** — four copies of one 49-word paragraph —
in an artifact that ships to public npm. Why a capability is withheld is documentation and
belongs here, beside the decision. The refusal says only that it is disabled.

**Enforcement is structural, not remembered.** The filter runs once, in the
`CapabilityRegistry` constructor, and rebuilds the product object without the disabled
entries. Nothing downstream checks the flag, because nothing downstream can see one. The
alternative — a guard at each read site — was rejected: there are four readers of
`bundle.capabilities` today (three in `search.ts`, one in `discovery.ts`) plus
`entities[*].capabilities[]`, and the cost of missing one is a capability hidden from
search and still invokable, which is precisely the failure the flag exists to prevent.

`entities[*].capabilities[]` is stripped too. `describeEntity` returns the entity doc
wholesale, so a name left there is a name the caller reads, looks up and cannot invoke —
advertising the capability in the one place that is not a search result.

**Two deliberate asymmetries.**

- *Uniqueness is still checked across disabled capabilities.* A name clash between a
  withheld capability and a live one is a broken artifact either way, and skipping the
  withheld half would mean un-setting the flag fails the load later, somewhere with far
  less context than the loader has.
- *`invokeCapability` says `capability_disabled`, not `unknown_capability`.* Reaching that
  branch means the caller already had the exact handle — from an older index, a doc, or a
  human — so no discovery is leaked by answering honestly, and knowing the absence is
  deliberate stops an agent hunting for a synonym that does not exist.

An entity whose capability list empties is **kept**. Its id convention, relations and key
facts remain true and are what a caller resolving an id needs; dropping entities would also
change what `listProducts` routes on. No tm entity empties today (attachment keeps 4 of 7,
dataset 7 of 8).

**Observability.** The startup log names the per-product count. Without it the flag is
undetectable from outside, since making these invisible is the entire point.

**Shipped.** tm index v1.38 marks the four capabilities in §1 `"disabled": true`. tm now
publishes **240** capabilities, not 244. Covered by
`tests/tools/capabilityRegistryDisabled.test.ts`, which tests both a fixture (the
mechanism) and the real artifact (that the flag is actually spelled right in what ships —
a misspelled flag costs nothing at load and silently publishes the capability).

**Still open:** steps 2-5. Nothing here carries `content_type`, reads multipart or moves
bytes; this only stops the surface offering what it cannot do.

### 8.1 The cost, measured — read this before adding the next one

Hiding a capability is not free, and the bill lands on search. Same artifact, flag cleared
versus set, top hit for the queries these four used to answer:

| query | with them listed | with them hidden |
| --- | --- | --- |
| "upload a file to a test case" | `link_attachments_to_test_case` | **`delete_test_case_attachment`** (destructive) |
| "import a csv dataset" | `import_dataset_csv` | `create_dataset` |

`weak` stays **false** in both cases, so search does not signal that it may not hold the
answer — other capabilities still score, and the shortlist looks as confident as ever. An
agent asked to upload a file is now pointed at a **delete**, which `invokeCapability` also
refuses. Two dead ends and no explanation.

The flag is still the right call here: an upload that 400s is worse than one that is
absent, and §1's approval cost is now avoided twice over (the refusal happens at lookup,
before the write-consent gate). But the honest accounting is that **hiding moves the
failure from invoke to search**, where it is quieter and harder to attribute. Before
disabling anything else, check what the queries it used to answer return instead.

The fix, when it is worth building, is §5's shape for search: a note on `searchCapability`
when a query matches withheld capabilities, so the surface can say "nothing here does
that" instead of offering the nearest wrong thing. Not built.
