---
name: test-management
description: Create and organise projects, folders, test cases, test runs, test plans and results in BrowserStack Test Management, through the capability registry, confirming before every write. Use when the user mentions test cases, test runs, test plans, folders, test results, Test Management, or ids like PR-, TC- or TR-.
---

# Work in BrowserStack Test Management

Load this skill when the user says "test case", "test run", "test plan", "folder", "test management", "record the result", "TM project", or names an id like `PR-12345`, `TC-98765`, `TR-5630768`.

**Governing rule: search, describe, then invoke; and every write is confirmed first.** Test Management is reached through three tools: `searchCapability` finds the operation in plain language, `describeCapability` returns its exact parameters, `invokeCapability` runs it. Writes return a permission request on the first call; put it to the user and resend with `user_permission: "granted"` and a one-line `change_summary` only after they say yes. Deletes are refused by the server; archive instead, and only on request.

## Step 0: Product routing

Call `listProducts` with the user's request as `query` once per task. "Project", "test run" and "report" exist in Test Management, Test Reporting and Load Testing, and the registry refuses to search while the product is ambiguous. If it reports a clash, ask the user which product they mean and resend the search with their words in `user_words` and the `routing_token`. If the user's wording already names Test Management (a `PR-`/`TC-`/`TR-` id, "test case", "test plan"), pass those words as `user_words` straight away.

## Step 1: Scope to a project

Every workflow is scoped to a project identifier of the form `PR-xxxxx`. If the user has not given one, search `list projects` and show names with ids; do not pick for them. Keep the identifier for the rest of the conversation.

## Step 2: Find the capability

`searchCapability` with `product: "tm"` and the user's goal in their own words, for example "create a test case in a folder", "add results to a run", "list test plans". Read `mode` on each result: `read` runs immediately, `write` needs the confirmation above. If the response says `weak_match`, use the `suggested_vocabulary` it returns and search again with the product's term; do not invoke an unconfirmed match.

The reference file `references/workflows.md` lists the product workflows grouped by entity, with the capability names behind each. Use it to turn a user request into the product's own words before searching, and to recognise when a request spans several workflows.

Named tools exist for the common path and skip the registry: `createProjectOrFolder`, `createTestCase`, `updateTestCase`, `listTestCases`, `listFolders`, `listTestCaseTemplates`, `createTestRun`, `listTestRuns`, `updateTestRun`, `addTestResult`, `listTestPlans`, `getTestPlan`, `listSubTestPlans`, `getSubTestPlan`. When one matches exactly it replaces search and describe. The ones that change data (`createProjectOrFolder`, `createTestCase`, `updateTestCase`, `createTestRun`, `updateTestRun`, `addTestResult`) need the same confirmation as a registry write.

## Step 3: Describe, then invoke

`describeCapability` with the chosen `name`. It lists path, query and body parameters with types and required flags. Build the call from that, not from memory. Then `invokeCapability` with `name`, `product: "tm"`, and the arguments under the spec's own names. When `completed` is false there is another page; fetch it with the capability's page parameter only if the user needs it.

## Common workflows, in product words

| User wants | Search phrase | Writes? |
|---|---|---|
| Set up a project with folders | "create a project", then "create a folder" | yes |
| Add a manual test case with steps | "create a test case" (needs folder id, title, steps, expected results) | yes |
| Find cases by tag, owner or folder | "find test cases" | no |
| Generate cases from a PRD | "generate test cases from a requirements document" (hosted server cannot read local files; the user uploads through the local server or the UI) | yes |
| Open a run for a set of cases | "create a test run" | yes |
| Record pass/fail | "add test results to a run" | yes |
| Close or reassign a run | "update a test run" | yes |
| Group runs for a release | "create a test plan" | yes |
| See what a plan contains | "get a test plan" | no |
| Bulk tag, move or archive | "bulk edit test cases", "bulk move test cases", "bulk archive test cases" | yes |

## Before any write

Show the user exactly what will be created or changed: project, folder, title, steps, run name, case list. Wait for an explicit yes, then invoke with permission granted or call the named tool. Report the identifier the product returns and the dashboard link.

## Result card

- **Did**: one line, for example "created TC-98765 in Login folder of PR-12345"
- **Where**: project and folder or run
- **Link**: the Test Management URL when returned
- **Next**: at most two, for example "add it to a run" or "create the next case"

## Never

- Never invoke a write without a confirmed `user_permission`.
- Never search two products and merge results when the registry reports a clash; ask.
- Never guess a project identifier.
- Never delete; the server refuses, and archiving is a user decision.
- Never paste the raw capability response; summarise.
