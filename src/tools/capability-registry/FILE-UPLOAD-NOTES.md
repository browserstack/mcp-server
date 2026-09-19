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
| `upload_test_case_attachments_v1` | `attachments` | `array<string/binary>`, required |
| `upload_generic_attachments` | `files` | `array<string/binary>`, 1..10, required |
| `upload_a_i_attachments` | `files` | `array<string/binary>`, 1..10, required |
| `import_dataset_c_s_v` | `file` | `string/binary`, required |

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

`import_dataset_c_s_v` states the problem in its own published intent: *"Import a CSV
dataset — NOT SUPPORTED in this profile"*.

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

1. **Refuse at bind, and stop publishing what cannot work.** Small, stops a real failure
   today — four capabilities that burn an approval and 400. Independent of everything else.
2. **Report the silent drop** in the build log. A few lines beside the existing counters.
3. **Carry `content_type` + `item_type: file` + `accepts`.** Producer-side only; the server
   ignores fields it does not know, so this can land before any runtime work and makes the
   refusal in (1) accurate instead of heuristic.
4. **Onboarding page + pre-signed pattern** documented, so no further products build into
   this hole.
5. **stdio-only multipart** with §5.3/§5.4 — only if a product genuinely cannot offer
   pre-signed URLs.
