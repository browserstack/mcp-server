# L3 protocol E2E

L3 answers one question: is each tool registered, validated and wired the way an AI client calls it?

```text
 MCP Client ◄── InMemoryTransport ──► BrowserStackMcpServer (real code)
                                              │
                                     MSW (axios + fetch)
                                     unknown URL = FAIL
 profiles: local-US, remote-US  ·  region rows: EU account
```

Run it with `npm run test:e2e`. It needs no network and no credentials.

## Files

| File                             | What it does                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `tools.e2e.test.ts`              | Runs every case row in both profiles, and the region rows on an EU account.                      |
| `meta.e2e.test.ts`               | Reports each tool in `tools/list` that has no row for a kind. Writes `reports/l3-coverage.json`. |
| `schema-portability.e2e.test.ts` | Checks that each tool schema is portable to common AI clients.                                   |
| `cases/<group>.ts`               | One `ToolSpec` for each tool.                                                                    |
| `harness/`                       | Server start, MSW, case expansion and the runner.                                                |

The annotations audit is a unit test: `tests/tools/annotations-audit.test.ts`.

## Kinds

| Kind           | Mock             | Expect                                               | Default               |
| -------------- | ---------------- | ---------------------------------------------------- | --------------------- |
| `happy`        | 200              | Result OK. Remote text inside the untrusted markers. | none, write it        |
| `bad-input`    | none             | Validation error. No HTTP call.                      | built from the schema |
| `auth`         | 401 on every URL | Clear error. No access key in the text.              | yes                   |
| `server-error` | 500 on every URL | Clear error. No stack trace.                         | yes                   |
| `region`       | the happy mocks  | Every call goes to an EU host.                       | none, write it        |

If a kind does not apply, set it to `"n/a: <reason>"`. Every row also checks that the access key is not in the text and that no URL was left without a mock.

## Add a tool

1. Add a `ToolSpec` to the file of its group in `cases/`. Write the URL patterns so that they match the US and EU hosts.
2. Run `npx vitest run --project e2e`.
3. Make sure the meta report shows no gap for the tool.

If a row fails because of a real bug in `src`, do not weaken the case. Add the kind to `knownIssues` with the ticket. The row then runs as an expected failure, and it turns red when the bug is fixed.

```typescript
{
  tool: "listTestCases",
  args: { project_identifier: "PR-1" },
  http: [TM_PROBE, { method: "GET", url: tm("/api/v2/projects/PR-1/test-cases"), body: { … } }],
  happy: { isError: false, untrusted: ["Remote title 7c1"] },
  region: { hosts: [EU_HOST] },
}
```

## Rollout

```text
 PR 1 harness + meta → PR 2–3 tool cases, META_BLOCKS = true → PR 4 registry flow × 7 · fake timers
```
