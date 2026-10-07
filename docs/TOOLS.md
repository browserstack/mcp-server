# BrowserStack MCP Server — Tool Reference

This page lists everything the BrowserStack MCP Server exposes, in three layers:

1. **[Core tools](#-core-tools)** — five tools that find and run any BrowserStack capability from a catalog. This is the recommended path and the one the [BrowserStack MCP docs](https://www.browserstack.com/docs/browserstack-mcp-server/tools) describe.
2. **[Named tools](#-named-tools)** — the 46 product-specific tools that predate the core tools. They are still registered and supported, and remain in your client's tool list until they are deprecated in favour of the core tools. Prefer the core tools for new workflows.
3. **[Test Management capabilities](#-test-management-capabilities)** — the 198 Test Management operations reachable through the core tools, grouped by the entity they act on.

Each group below is collapsed; click a heading to expand it.

> **Remote MCP note:** Tools marked _(not available in Remote MCP)_ rely on local file/process state and are disabled in the multi-tenant [Remote MCP Server](../README.md#-remote-mcp-server). They are available in the local (npx) setup.

> **File & app uploads:** tools that upload a local file/app (`uploadProductRequirementFile`, `takeAppScreenshot`, `runAppTestsOnBrowserStack`, `runAppLiveSession`) require the `MCP_UPLOAD_BASE_DIR` env var set to a directory containing those files; uploads are restricted to it.

---

## 🧭 Core Tools

Five core tools let your AI assistant find and run any BrowserStack workflow. Your assistant loads every tool an MCP server exposes at the start of each session, so one tool per workflow would fill your context window and slow down the whole session. Instead, your assistant uses the core tools to search a catalog of BrowserStack tools in plain language and run the one it needs.

| Tool | Description |
|------|-------------|
| `listProducts` | Lists the BrowserStack products in the catalog, with a short summary of what each product covers |
| `describeEntity` | Explains one entity: its aliases, ID format, parent and related entities, and the capabilities that act on it |
| `searchCapability` | Finds the capabilities that match a plain-language request, with everything your assistant needs to run each one |
| `describeCapability` | Returns the full details of one capability, such as its parameters, request body and response format |
| `invokeCapability` | Runs one capability and returns the product's response unchanged. Changes to data need your approval |

See [Core tools](https://www.browserstack.com/docs/browserstack-mcp-server/tools/core-tools) for parameters and how changes to data are approved.

The flow is always the same: **find it, read its contract, then call it.**

```text
searchCapability  →  describeCapability  →  invokeCapability
```

Two things worth knowing before you start:

- **`searchCapability` needs a product.** Call `listProducts` first if the task does not name one — asking is cheaper than guessing, and the tool will refuse a query that two products could both answer.
- **Writes ask first.** Anything that changes data needs your confirmation, and deletes are not reachable at all: they are withheld from this surface rather than refused after the fact, so they never appear in search results.

<details>
<summary><b>Prompt examples for the core tools</b></summary>

- `listProducts` — **Start here** when you do not already know which product the task belongs to.

  ```text
  What can you reach in BrowserStack Test Management?
  ```

- `describeEntity` — Read this before filtering or writing, because ids and field values usually have to be resolved first.

  ```text
  What is a shared step in Test Management, and how is it identified?
  ```

- `searchCapability` — Returns a shortlist, not the whole catalogue. Pass `query: "*"` to browse everything, with `offset` to page through it.

  ```text
  Find a way to move test cases between folders in bulk in project PR-53617
  ```

- `describeCapability` — Read this before invoking anything you have not called before.

  ```text
  Show me exactly what I need to send to create a shared step
  ```

- `invokeCapability` — Writes require explicit confirmation and a summary of what will change; destructive operations are not available through this surface.

  ```text
  Add the 'regression' tag to every test case in the Checkout folder of PR-53617
  ```

</details>

---

## 🗂️ Named Tools

The 46 tools below are registered alongside the core tools. Each entry gives the tool name, what it does, and a prompt that triggers it.

<details>
<summary><b>🧾 Test Management</b> — 15 tools</summary>

 1. `createProjectOrFolder` — Create a Test Management project and/or folders to organize test cases. Returns with Folder ID, Project ID and Test Management Link to access the TM Project Dashboard.
  **Prompt example**

  ```text
  Create a new Test Management project named 'Shopping App' with two folders - Login and Checkout
  ```


 2. `createTestCase` — Add a manual test case under a specific project/folder (uses project identifier like PR-xxxxx and a folder ID).
  **Prompt example**

  ```text
  Add a test case named 'Invalid Login Scenario' to the Login folder in the 'Shopping App' project with PR-53617, Folder ID: 117869
  ```

 3. `updateTestCase` — Update an existing test case. Any subset of fields may be changed (name, priority, status, steps, tags, etc.); only supplied fields are modified.
  **Prompt example**

  ```text
  Update test case TC-482 in the 'Shopping App' project and set its priority to high
  ```

 4. `listTestCases` — List test cases for a project, optionally scoped to a folder (supports filters like case_type, priority, and pagination).
  **Prompt example**

  ```text
  List all high-priority test cases in the 'Shopping App' project with project_identifier: PR-59457
  ```

 5. `listFolders` — List folders in a Test Management project (returns each folder's id, name, case counts, and sub-folder counts). Pass a parent_id to list sub-folders.
  **Prompt example**

  ```text
  List all folders in the 'Shopping App' project with project_identifier: PR-59457
  ```

 6. `listTestCaseTemplates` — List test-case templates with their numeric template_id, for use with `createTestCase` to apply a custom template.
  **Prompt example**

  ```text
  List the available test case templates in the 'Shopping App' project
  ```

 7. `createTestRun` — Create a test run (suite) for selected test cases in a project.
  **Prompt example**

  ```text
  Create a test run for the Login folder in the 'Shopping App' project and name it 'Release v1.0 Login Flow'
  ```

 8. `listTestRuns` — List test runs for a project (filter by dates, assignee, state).
  **Prompt example**

  ```text
  List all test runs from the 'Shopping App' project that were executed last week and are currently marked in-progress
  ```

 9. `updateTestRun` — Update a test run's name/state and/or add test cases to it.
  **Prompt example**

  ```text
  Update test run ID 1043 in the 'Shopping App' project and mark it as complete with the note 'Regression cycle done'
  ```

 10. `addTestResult` — Add a manual execution result (passed/failed/blocked/skipped) for a test case within a run.
  **Prompt example**

  ```text
  Mark the test case 'Invalid Login Scenario' as passed in test run ID 1043 of the 'Shopping App' project
  ```

 11. `createTestCasesFromFile` — Generate test cases in bulk from an uploaded file using the Test Case Generator AI Agent. _(not available in Remote MCP)_
  **Prompt example**

  ```text
  Upload test cases from '/Users/xyz/testcases.pdf' to the 'Shopping App' project in Test Management
  ```

 12. `listTestPlans` — List test plans (TP-*) in a project, with name, status, dates, and active/closed run counts. Supports pagination.
  **Prompt example**

  ```text
  List all test plans in the 'Shopping App' project with project_identifier: PR-59457
  ```

 13. `getTestPlan` — Fetch a test plan by identifier (TP-*) with its metadata, linked test runs, total test-case count, and status summary.
  **Prompt example**

  ```text
  Get the details of test plan TP-120 in the 'Shopping App' project
  ```

 14. `listSubTestPlans` — List sub-test-plans (STP-*) under a parent test plan (TP-*). Supports pagination.
  **Prompt example**

  ```text
  List sub-test-plans under test plan TP-120 in the 'Shopping App' project
  ```

 15. `getSubTestPlan` — Fetch a sub-test-plan (STP-*) under a parent plan, with its metadata and linked test runs.
  **Prompt example**

  ```text
  Get sub-test-plan STP-45 under test plan TP-120 in the 'Shopping App' project
  ```

</details>

<details>
<summary><b>⚙️ BrowserStack SDK Setup / Automate Test</b> — 3 tools</summary>

 16. `setupBrowserStackAutomateTests` — Integrate BrowserStack SDK and run web tests on BrowserStack. For visual testing/Percy, use the dedicated Percy tools.
  **Prompt example**

  ```text
  Run my Selenium-JUnit5 tests written in Java on Chrome and Firefox.
  ```

 17. `fetchAutomationScreenshots` — Fetch screenshots captured during a given Automate/App Automate session.
  **Prompt example**

  ```text
  Get screenshots from Automate session ID abc123xyz for my desktop test run
  ```

 18. `listSessions` — List the sessions in an Automate/App Automate build. Each record carries `sessionId`, `name`, `status`, `os`, `osVersion`, `browser`, `device`, `browserUrl` (dashboard link), and `videoUrl`, with optional `limit` / `offset` paging and a client-side `status` filter. Takes either the **hashed** build ID from the dashboard URL or the observability build id returned by `getBuildId` / `listBuildId` — an observability id is resolved to the hashed id automatically via the build's sessions. Returned `sessionId` values work with `getFailureLogs`, `fetchAutomationScreenshots`, and `fetchSelfHealedSelectors`.
  **Prompt example**

  ```text
  List sessions for Automate hashed build ID <hashed build id>
  ```

</details>

<details>
<summary><b>🔍 Observability</b> — 2 tools</summary>

 19. `getFailureLogs` — Retrieve error logs for Automate/App Automate sessions. App Automate log endpoints are build-scoped, so a hashed build ID is required there — pass one if you have it, otherwise it is resolved from the session automatically.
  **Prompt example**

  ```text
  Get the Appium logs for App Automate session ID <session id>
  ```

 20. `fetchBuildInsights` — Fetch insights about a BrowserStack build by combining build details and quality-gate results. Includes `hashed_id` (the hashed build id `listSessions` takes) and `session_type`, resolved through the build's sessions when the build ran on Automate / App Automate.
  **Prompt example**

  ```text
  Get the build insights for build UUID <your-build-uuid> on BrowserStack
  ```

</details>

<details>
<summary><b>📱 App Live</b> — 1 tool</summary>

 21. `runAppLiveSession` — Start a manual app testing session on a real device in the cloud.
  **Prompt example**

  ```text
  Open my app on iPhone 15 Pro Max with iOS 17. App path is /Users/xyz/app.ipa
  ```

</details>

<details>
<summary><b>💻 Live</b> — 1 tool</summary>

 22. `runBrowserLiveSession` — Start a Live session for website testing on desktop or mobile browsers.
  **Prompt example**

  ```text
  Open www.google.com on the latest version of Microsoft Edge on Windows 11
  ```

</details>

<details>
<summary><b>📲 App Automate</b> — 3 tools</summary>

 23. `takeAppScreenshot` — Launch the app on a specified device and capture a quick verification screenshot to confirm your app has launched.
  **Prompt example**

  ```text
  Take a screenshot of my app on Google Pixel 6 with Android 12 while testing on App Automate. App file path: /Users/xyz/app-debug.apk
  ```

 24. `runAppTestsOnBrowserStack` — Run pre-built native mobile test suites (Espresso/XCUITest) by direct upload of compiled .apk/.ipa test files.
  **Prompt example**

  ```text
  Run Espresso tests from /tests/checkout.zip on Galaxy S21 and Pixel 6 with Android 12. App path is /apps/beta-release.apk under project 'Checkout Flow'
  ```

 25. `setupBrowserStackAppAutomateTests` — Set up BrowserStack App Automate SDK integration for Appium-based mobile app testing.
  **Prompt example**

  ```text
  Set up my Appium test suite to run on BrowserStack App Automate
  ```

</details>

<details>
<summary><b>♿ Accessibility</b> — 5 tools</summary>

 26. `accessibilityExpert` — Ask the A11y Expert (WCAG 2.0/2.1/2.2, mobile/web usability, best practices).
  **Prompt example**

  ```text
  What WCAG guidelines apply to form field error messages on mobile web?
  ```

 27. `startAccessibilityScan` — Start a web accessibility scan and retrieve a local CSV report path.
  **Prompt example**

  ```text
  Run accessibility scan for "www.example.com"
  ```

 28. `createAccessibilityAuthConfig` — Create an authentication configuration (form-based or basic) for accessibility scans behind a login.
  **Prompt example**

  ```text
  Create a basic-auth accessibility config named 'site-login' for https://www.example.com with username testuser and password <password>
  ```

 29. `getAccessibilityAuthConfig` — Retrieve an existing accessibility authentication configuration by ID.
  **Prompt example**

  ```text
  Get accessibility auth config with ID <config-id>
  ```

 30. `fetchAccessibilityIssues` — Fetch accessibility issues from a completed scan, with pagination support.
  **Prompt example**

  ```text
  Fetch the accessibility issues for scan ID <scan-id> and scan run ID <scan-run-id>
  ```

</details>

<details>
<summary><b>🎨 Percy Visual Testing</b> — 7 tools</summary>

 31. `percyVisualTestIntegrationAgent` — Integrate Percy visual testing into a new project and demonstrate visual change detection with a step-by-step simulation.
  **Prompt example**

  ```text
  Integrate Percy for this project
  ```

 32. `expandPercyVisualTesting` — Set up or expand Percy visual testing coverage for existing projects (Percy Web Standalone and Percy Automate).
  **Prompt example**

  ```text
  Expand Percy coverage for this project
  ```

 33. `addPercySnapshotCommands` — Add Percy snapshot commands to the specified test files. _(not available in Remote MCP)_
  **Prompt example**

  ```text
  Add Percy snapshot commands to my Cypress test files
  ```

 34. `listTestFiles` — List all test files for a given set of directories. _(not available in Remote MCP)_
  **Prompt example**

  ```text
  List the test files under my ./tests directory
  ```

 35. `runPercyScan` — Run a Percy visual test scan. _(not available in Remote MCP)_
  **Prompt example**

  ```text
  Run this Percy build
  ```

 36. `fetchPercyChanges` — Retrieve and summarize visual changes detected by Percy AI between the latest and previous builds.
  **Prompt example**

  ```text
  Summarize the visual changes Percy detected in my latest build
  ```

 37. `managePercyBuildApproval` — Approve or reject a Percy build.
  **Prompt example**

  ```text
  Approve the latest Percy build
  ```

</details>

<details>
<summary><b>🤖 BrowserStack AI Agents</b> — 9 tools</summary>

 38. `uploadProductRequirementFile` — Upload a PRD/screenshot/PDF and get a file mapping ID (used with `createTestCasesFromFile`). _(not available in Remote MCP)_
  **Prompt example**

  ```text
  Upload PRD from /Users/xyz/Desktop/login-flow.pdf and use BrowserStack AI to generate test cases
  ```

 39. `createLCASteps` — Generate Low Code Automation (LCA) steps from a manual test case in Test Management.
  **Prompt example**

  ```text
  Convert the manual test case 'Add to Cart' in the 'Shopping App' project into LCA steps
  ```

 40. `fetchSelfHealedSelectors` — Retrieve AI self-healed selectors (plus test source) to fix flaky tests caused by DOM changes.
  **Prompt example**

  ```text
  Fetch and fix flaky test selectors in Automate session ID session_9482 using MCP
  ```

 41. `prepareSelfHealingPlan` — Build a self-healing edit plan that bundles locator pairs with test source for your LLM to apply. Does NOT modify files itself.
  **Prompt example**

  ```text
  Prepare a self-healing plan from the self-healed selectors for my build
  ```

 42. `fetchRCA` — Fetch AI Root Cause Analysis for your failed Automate/App-Automate tests (by numeric test ID). Suggests fixes only; never auto-applies.
  **Prompt example**

  ```text
  Fetch the root cause analysis for failed test IDs 101 and 102 on BrowserStack
  ```

 43. `getBuildId` — Get the BrowserStack build ID for a given project and build name, scoped to your builds.
  **Prompt example**

  ```text
  Get the build ID for build 'nightly-regression' in project 'Checkout Flow'
  ```

 44. `listBuildId` — Get the latest build ID for a project and build name, across all users (no user filter).
  **Prompt example**

  ```text
  Get the latest build ID for build 'nightly-regression' in project 'Checkout Flow'
  ```

 45. `listTestIds` — List the tests in a BrowserStack build (Automate or App Automate) with each test's `status` and `session_id`, optionally filtered by status (passed/failed/pending/skipped). The `session_id` feeds `getFailureLogs` and `fetchAutomationScreenshots` directly.
  **Prompt example**

  ```text
  List the failed test IDs from build UUID <your-build-uuid> on BrowserStack
  ```
 46. `askBrowserStackAI` *(Alpha, limited availability)* — Hand a multi-step task to BrowserStack's agent in plain language; it decides which calls to make and returns the answer plus the steps it took. Covers Test Management and Test Reporting & Analytics. Anything that would change data pauses for your confirmation in your own client; deletes are refused outright. Requires the account to be enrolled — otherwise it returns an entitlement error and nothing runs.
  **Prompt example**

  ```text
  Find all payment test cases in project Shopping App and add the 'regression' tag to them
  ```

</details>

---

## 🧩 Test Management Capabilities

The 198 Test Management operations below are what the core tools reach: `searchCapability` finds them, `describeCapability` returns each one's parameters and response shape, and `invokeCapability` runs it. 109 are reads and 89 are writes; writes ask for your confirmation before anything changes, and destructive operations are withheld from this surface entirely. Capability names are the handles `searchCapability` returns — pass one to `describeCapability` to see its full contract.

Listed from the live catalog on 2026-10-07 (`searchCapability` with `product: "tm"`, `query: "*"`). Grouped by the entity each capability acts on.

<details>
<summary><b>attachment</b> — 2 capabilities (2 read · 0 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `list_entity_attachments` | read | List the files attached to one test case, test result or test plan - use this to see what screenshots, logs or evidence are on the item and to get the URL for reading each file |
| `list_folder_attachments` | read | List the files attached to a folder itself. |

</details>

<details>
<summary><b>comment</b> — 4 capabilities (2 read · 2 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `list_test_case_comments` | read | Read the comments on a test case. |
| `list_test_run_test_case_comments` | read | List the comments left on a test case inside a specific test run — use this to read the discussion or review feedback on that execution, find who said what and when, or discover a comment's id |
| `create_test_case_comment` | write | Post a comment on a test case. |
| `create_test_run_test_case_comment` | write | Post a comment on a test case within a test run — use this to leave review feedback on an execution, ask the run owner a question, record why a result was marked as it was, or @mention a colleague |

</details>

<details>
<summary><b>configuration</b> — 3 capabilities (2 read · 1 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `list_configuration_groups` | read | List the account's configuration groups and their ids. |
| `list_configurations` | read | List the configurations a project's test runs can execute against — search by name or fetch specific ids, to resolve the configuration_id a run needs |
| `create_configuration` | write | Create a named configuration — an OS / browser / device combination that test runs track their per-case results against |

</details>

<details>
<summary><b>custom_field</b> — 17 capabilities (9 read · 8 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_custom_field` | read | Read one custom field by its numeric id — confirm its name, type, placeholder, default and whether it is mandatory, and pick up the ids of the datasets that hold its option values |
| `get_custom_field_dataset` | read | Read one dataset of a custom field — which projects it covers and, on request, the option values it holds |
| `get_custom_field_definition` | read | Read one custom field's stored definition together with its datasets and the projects each dataset is linked to — the call to make before any edit, since edits here are full replaces |
| `get_custom_field_values` | read | List the values one custom field offers inside a given project — the dropdown choices, or the users for a user field — so you can pick a valid value before writing it onto a test case or result |
| `get_project_form_fields` | read | Get the test-case form for one project — the custom fields it shows, the built-in system fields, and the pick lists behind the standard priority / state / type / automation-status dropdowns |
| `get_test_results_custom_fields` | read | List the custom fields a project shows on a test RESULT — the extra fields a tester fills when recording a pass or fail, with the ids and types needed to send values |
| `list_custom_field_dataset_options` | read | List the option values a dataset offers, with the numeric option id each one carries — the ids you need to rename, re-default or delete an option |
| `list_custom_fields` | read | Discover the test-case custom fields defined in this workspace — list each field with its name, type, required flag and linked-project count, and pick up the numeric field id needed before reading, editing or filling in a field |
| `list_workspace_fields` | read | Browse or search every field configured for the workspace — built-in system fields and user-defined custom fields together — to find a field's numeric id, type and how many projects it reaches |
| `create_custom_field` | write | Define a new test-case custom field — choose its type, name it, say whether filling it is mandatory, and optionally give a dropdown its choices and link it to the projects that should offer it |
| `create_custom_field_dataset` | write | Attach another option set and project scope to an existing custom field — the way to give one field different dropdown values in different projects |
| `create_custom_field_dataset_option` | write | Add one more choice to a dropdown-style custom field — a new value in an existing dataset, for every project that dataset covers |
| `create_custom_field_definition` | write | Define a new custom field for the workspace — pick its data type, whether it is mandatory, and (via datasets) which projects get it and what option values it offers |
| `update_custom_field` | write | Change an existing test-case custom field — rename it, make it mandatory or optional, adjust its placeholder or default value, replace a dropdown's choices, or change which projects offer it |
| `update_custom_field_dataset_option` | write | Rename one dropdown choice, or make it the default — the option id stays the same, so cases already holding this value follow the new label |
| `update_custom_field_dataset_project_mapping` | write | Change which projects a custom field's dataset applies to — link projects so they see the field, or unlink them, which deletes the values those projects already stored |
| `update_custom_field_definition` | write | Rename a custom field, or change whether it is mandatory, its placeholder or its boolean default — a full replace of the field's attributes, not a partial edit |

</details>

<details>
<summary><b>dataset</b> — 6 capabilities (4 read · 2 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_dataset` | read | Read one dataset in full — its columns, every row of data, tags and metadata — by dataset uuid |
| `get_dataset_variables` | read | List every dataset column defined anywhere in the project, each with the dataset it belongs to — use this to find which dataset holds a variable name you saw in a test case |
| `list_dataset_linked_test_cases` | read | List the test cases bound to a dataset — check what a dataset drives before you edit or delete it |
| `list_datasets` | read | Find datasets in a project — browse them or look one up by name or uuid to get the uuid the other dataset calls need |
| `create_dataset` | write | Create a dataset — a named table of columns (variables) and rows that drives data-driven execution, so one test case runs once per row with the row's values substituted in |
| `update_dataset` | write | Replace a dataset's contents — rename it, or write a new set of columns and rows over the existing table |

</details>

<details>
<summary><b>duplicate</b> — 4 capabilities (4 read · 0 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_dedupe_status` | read | Check whether duplicate detection has ever run for a project and where the latest scan got to — the only way to tell 'dedupe is off or has never run' from 'it ran and found nothing' |
| `get_duplicate` | read | Read one suggested duplicate pair — the two test cases side by side with their titles, descriptions, folders and owners, plus the confidence score and the model's reason — so a human can decide how to resolve it |
| `list_duplicates` | read | List the AI-suggested duplicate test-case pairs awaiting review in a project, highest-confidence first — optionally only those involving one test case, or only the caller's own |
| `search_duplicates` | read | Search the AI-suggested duplicate pairs with the full test-case filter grammar — narrow the review queue by folder, owner, tags, priority, status, custom fields or free text |

</details>

<details>
<summary><b>exploratory_session</b> — 11 capabilities (5 read · 6 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_exploratory_session` | read | Read one exploratory session in full — its charter, state, timings, assignee, tags, configurations, linked test plan, linked issues, custom fields and how many logs it holds — before reading its logs or changing it |
| `list_exploratory_session_defects` | read | List the defects and issues raised during an exploratory session — the external tracker tickets linked to the session and to its individual log entries — to review what the exploration found |
| `list_exploratory_session_form_fields` | read | List the form fields for authoring an exploratory session. |
| `list_exploratory_session_logs` | read | Read the observations recorded during an exploratory session — the timestamped notes, their pass/fail/bug status, elapsed time, linked defects and embedded screenshots — optionally narrowed to particular statuses |
| `list_exploratory_sessions` | read | Find exploratory testing sessions in a project — filter by state, assignee, creator, tags, configurations, linked test plan, date range or free text — to pick the session whose logs or defects you want to read next |
| `clone_exploratory_session` | write | Copy an existing exploratory session — its description, timebox, configurations and custom fields, plus its log entries, and optionally its tags, linked issues and owner — to re-run the same exploration |
| `close_exploratory_session` | write | Mark an exploratory testing session finished so it leaves the active listing and is archived as completed work |
| `create_exploratory_session` | write | Start a new exploratory testing session in a project — give it a charter, a timebox, an owner, tags, configurations and a folder — so that observations can be logged against it |
| `create_exploratory_session_log` | write | Record one observation during an exploratory session — a note about what was tried and what happened, its pass/fail/bug outcome, the time it took and any defects it raised |
| `update_exploratory_session` | write | Change fields on an existing exploratory session — retitle it, revise the charter, record the time spent, reassign it, move it to another folder, or replace its tags, configurations, attachments and linked issues |
| `update_exploratory_session_log` | write | Revise an observation already recorded in an exploratory session — correct the note, change its pass/fail/bug outcome, adjust the time spent or restate which defects it raised |

</details>

<details>
<summary><b>filter</b> — 3 capabilities (1 read · 2 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `list_filters` | read | List the saved filter views available in a project — yours and the project-wide ones — to find the filter_id to read, apply, update or delete |
| `create_filter` | write | Save a reusable named filter view on a project — the condition set behind a test case, test run, test plan or exploratory-session list — so the same selection can be reapplied later or shared with everyone on the project |
| `update_filter` | write | Rename a saved filter view, replace its conditions, or switch it between private and project-wide — resending name and entity on every call |

</details>

<details>
<summary><b>folder</b> — 13 capabilities (4 read · 9 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_folder_remove_summary` | read | Dry-run a folder deletion — count the test cases, subfolders and cross-product recordings that would be destroyed — before committing to it |
| `get_folder_tree` | read | Fetch a project's entire folder tree in one call — every root folder with its children nested under `contents` — to resolve a folder name to the integer id every other folder and test-case call needs |
| `list_folder_contents` | read | Open one folder — its immediate subfolders, the folder's own record, and optionally its ancestor breadcrumb — to walk the tree a level at a time or work out where a folder sits |
| `list_root_folders` | read | List a project's root folders, or search folders anywhere in the project by name — the paginated way in when the full tree is too big to pull at once |
| `copy_folder` | write | Duplicate a folder — its whole subtree of subfolders and every test case in them — into another folder, or to the root of any project you can reach; always runs as a background job |
| `create_folder` | write | Create a folder, or a sub folder under a parent. |
| `create_root_folder` | write | Create a top-level folder in a project — the first thing you need before test cases can be filed anywhere |
| `create_sub_folder` | write | Create a folder inside an existing folder — use this to build out a nested test-case tree one level at a time |
| `move_folder` | write | Move a folder and its contents under a different parent. |
| `move_folder_by_integer_id` | write | Move a folder — with everything under it — to a different parent, to the project root, or into another project; same-project moves complete immediately, cross-project ones run in the background |
| `rename_folder` | write | Rename a folder or change its description. |
| `rename_folder_by_integer_id` | write | Rename a folder or rewrite its notes — despite the name this is the general folder-edit call, and it changes whichever of the two fields you send |
| `reorder_folders` | write | Change the display order of sibling folders by dropping one or more of them between two named neighbours — ordering only, it never changes nesting |

</details>

<details>
<summary><b>issue</b> — 4 capabilities (1 read · 3 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_linked_test_case_selection` | read | Preview the test cases a tracker ticket would link. |
| `link_entities_to_jira_issue` | write | Link test cases or runs to a tracker ticket. |
| `unlink_test_case` | write | Unlink a test case from a tracker ticket. |
| `unlink_test_run` | write | Unlink a test run from a tracker ticket. |

</details>

<details>
<summary><b>project</b> — 21 capabilities (17 read · 4 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_active_test_runs_info` | read | Chart the result-status breakdown across the project's currently active test runs — how many results are passed / failed / blocked / untested right now |
| `get_automation_stats` | read | Get the project's automation coverage — what percentage of its test cases are automated, with the automated / manual / total counts behind it |
| `get_closed_test_runs_info` | read | Chart how many test runs were closed per month over the selected window — the project's throughput trend |
| `get_closed_test_runs_split` | read | Chart closed test runs per month split by result status — a stacked view of how each month's closed runs finished |
| `get_issues_count_info` | read | Chart how many defects/issues were linked from this project per period — the defect-discovery trend |
| `get_lcnc_user_test_config` | read | Get the caller's saved low-code test setup for a project. |
| `get_project_by_integer_id` | read | Get a project by INTEGER id (v1) — full detail + its PR-NNN identifier |
| `get_project_settings` | read | Read a project's configuration flags — review/approval gating, the custom test-case id prefix, time-tracking, Part 11 re-auth, Jira/Azure linking — and optionally the caller's own pending-review counts |
| `get_projects_basic` | read | Look up projects by name or by PR-NNN identifier, or page through them cheaply — the lean listing, and the only one with an identifier search; note the rows it returns do NOT include the identifier itself |
| `get_projects_minify` | read | Page through every project in the group as a flat dropdown list, 300 at a time — the fastest way to enumerate all projects, but it cannot search and it returns no pagination metadata |
| `get_test_case_count_trend` | read | Chart how the project's test case count grew month by month, broken down by case type — use this for 'how fast is the suite growing' |
| `get_test_case_type_split` | read | Chart how the project's test cases divide across case types (functional, regression, smoke, custom types…) — the current composition of the suite |
| `list_entity_filter_details` | read | Resolve a set of filter IDs you already hold into their display objects — turn priority/status/case-type/custom-field ids, folder ids and user ids into names, colours and folder paths so a saved filter can be rendered; it does NOT list the filter options available in a project |
| `list_project_users` | read | Find the users in this group — by name fragment, by exact email, or by id — and get the caller's own identity back alongside them; use this to resolve a person's name or email to the numeric user id that owner/assignee/reviewer filters and writes require |
| `list_projects` | read | List the group's projects with their PR-NNN identifiers, case/run counts and duplicate badge — the listing to use when you need each project's identifier; for a plain name lookup or a count, get_projects_basic is leaner |
| `search_all_projects` | read | Search every entity type across the account at once. |
| `search_project_entities` | read | Search and filter a project's test cases, test runs, or the test cases inside one run — the general-purpose finder: free text plus status / priority / type / owner / folder / tag / date filters, with an id-only count mode |
| `create_project` | write | Create a new project — the top-level container every folder, test case, run, plan and report lives under; returns both the integer id the v1 routes take and the PR-NNN identifier the v2 routes take |
| `edit_project` | write | Rename a project, or change its description or visibility. |
| `export_dashboard_analytics` | write | Queue a CSV export of the whole project dashboard (active + closed runs, issue counts, case-type split, automation stats) and get back an export id — the file itself is delivered out of band |
| `update_project_settings` | write | Turn a project's configuration flags on or off — review/approval gating, the custom test-case id prefix, test-case sharing, the manual-execution timer, Part 11 re-authentication, Jira/Azure linking and test-plan review |

</details>

<details>
<summary><b>report</b> — 13 capabilities (8 read · 5 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_exploratory_session_summary` | read | Get exploratory-session testing figures for a project directly — sessions, outcomes and top testers over a date range or a chosen set of sessions, with no saved report needed |
| `get_report` | read | Read one report's setup by its SC-NNN identifier — what it covers (type, time window, the runs/plans/sessions it is scoped to), whether it is on a schedule and when it next runs, who receives it, and whether a generated file exists; configuration only, no figures |
| `get_report_detail` | read | Read one saved report — its definition, resolved filters, and computed figures — the general-purpose report read |
| `get_report_section` | read | Fetch one report widget on its own — a single chart, table or drill-down slice from a saved report, without the report definition |
| `get_report_summary_by_type` | read | Render a saved report through one of four fixed renderers — run summary, run detail table, test plan detail table, or requirement traceability |
| `get_selected_report_testcases` | read | Read a report's saved test-case selection in the folder-keyed shape the editor uses — the value to round-trip back when editing the report |
| `list_reports` | read | Find a project's reports — search saved and scheduled reports by title or type, see which ones run on a recurring schedule and when each next fires, or pick up the SC-NNN identifier of a report you then want to read or download |
| `list_schedules` | read | List a project's reports — scheduled and unscheduled alike, with type, window, cadence and owner — the way to find a report_id |
| `create_report` | write | Set up a new report over a project's test data — either a one-off you will download, or a recurring daily/weekly/monthly schedule that emails chosen people; this saves the report's definition (type, window, scope, recipients) and hands back its SC-NNN identifier, it does not produce any figures |
| `create_report_by_integer_id` | write | Save a report definition over a project's runs, plans, cases, sessions or requirements — scheduled to email on a cadence, or unscheduled and read on demand |
| `download_report` | write | Kick off an async export of a report to CSV, PDF or XLSX — returns a job channel, not the file |
| `send_report_email_now` | write | Email an existing report to specific people right now, as a PDF/CSV/XLSX attachment, without changing its schedule |
| `update_report` | write | Rewrite a saved report — its type, window, filters, schedule or recipients — replacing the whole definition in one call |

</details>

<details>
<summary><b>result</b> — 7 capabilities (3 read · 4 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `list_test_results_for_test_case` | read | Read what was recorded for one test case in one test run — every execution logged against it, with status, notes, linked defects, custom fields and configuration |
| `list_test_results_for_test_case_by_integer_id` | read | Read the result history for one test case inside one test run — every attempt logged against that case with its status, author, note, attachments, linked defects and custom fields; the read for 'what happened when we executed this case?' |
| `search_test_results` | read | Find test results anywhere in the account without knowing the project, run or case — above all, list every result linked to a tracker issue (a Jira/ADO ticket key) to answer 'what testing covers this bug?', optionally narrowed by case priority |
| `bulk_set_test_result_status` | write | Move many test cases in a test run to one status in a single call — the bulk 'mark these passed' or 'reset the run to untested' action, which replaces each case's current outcome instead of adding a new one |
| `create_step_result` | write | Log the outcome of ONE step inside a test case's execution in a run — the per-step pass/fail you record while working through a manual test case, as opposed to the case's overall result |
| `create_test_result_for_test_case` | write | Create a new test result for a test case in a test run |
| `create_test_results_for_test_run` | write | Record the outcome of running test cases in a test run — pass/fail/blocked with notes, per-step results, linked defects and attachments — for one case or for many in a single call |

</details>

<details>
<summary><b>shared_field</b> — 3 capabilities (1 read · 2 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `list_shared_components` | read | List or search a project's shared fields. |
| `create_shared_component` | write | Create a reusable shared field - a step sequence, a Gherkin background block, or a precondition - that many test cases can then reference. |
| `update_shared_component` | write | Change an existing shared field - its title, rows, tags or collection - with the edit propagating to every test case that references it. |

</details>

<details>
<summary><b>shared_step</b> — 4 capabilities (2 read · 2 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_shared_step` | read | Read one shared step with its full ordered step/result rows — the block that every referencing test case renders, and the row ids those references point at |
| `get_shared_steps` | read | List a project's shared steps with how many steps each holds and how many test cases embed it — use this to find a shared_step_id and to size the blast radius before editing or deleting a block |
| `create_shared_step` | write | Create a reusable shared step block in a project — a titled set of step/result rows that many test cases can then embed by reference instead of copying |
| `update_shared_step` | write | Replace a shared step's title, folder and its whole ordered step list — the edit lands at once in every test case that embeds the block |

</details>

<details>
<summary><b>tag</b> — 6 capabilities (4 read · 2 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_test_case_tags` | read | List the tag names currently on one test case — to see what it is labelled with before filtering, grouping or re-tagging |
| `list_test_case_tags` | read | List a project's test-case tag vocabulary with usage counts — the set of tag names to pick from when tagging a case or filtering a list by tag |
| `search_group_tags` | read | Search the workspace-wide tag vocabulary for one entity type and get each tag's id — the only tag read here that returns ids, so it is where you resolve the source_id and target_id a tag merge needs |
| `search_test_case_tags` | read | Check whether a test-case tag name exists in a project, or complete a partial one, before tagging a case or building a tag filter |
| `bulk_edit_test_cases` | write | Bulk edit test cases with per-field add / remove / replace operations (PREFERRED bulk write). |
| `update_tag` | write | Rename a label across a project. |

</details>

<details>
<summary><b>template</b> — 4 capabilities (2 read · 2 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `list_templates` | read | List the workspace's test-case templates — start here to find a template's id before creating a test case from it or before editing the template itself. |
| `list_test_case_templates` | read | List the workspace's test-case (or test-result) templates with their ids — the lookup to run before creating a case from a template or editing a template's field layout |
| `create_template` | write | Create a new test-case template — define which description and property fields a test case gets and, optionally, which projects it applies to. |
| `update_template` | write | Rename a template, enable or disable it, make it the workspace default, or replace its description and property field layout. |

</details>

<details>
<summary><b>test_case</b> — 24 capabilities (10 read · 14 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `count_binned_test_cases` | read | Return just the number of test cases currently in a project's recycle bin — the cheap way to answer 'how many binned/deleted cases are there?' without pulling any rows into context (use list_binned_test_cases when you need the cases themselves) |
| `get_system_field_values` | read | List the option ids and display names a project defines for one system field (priority, status, case type, automation state) — resolve these before writing any of them. |
| `get_test_case` | read | Get one test case in full by its TC-NNN identifier. |
| `get_test_case_by_integer_id` | read | Read one test case by its INTEGER id inside a folder — the v1 lookup, and the way to translate an integer id into the TC-NNN identifier the v2 surface needs. |
| `get_test_case_detail` | read | Read one test case with its full slide-over detail — steps, custom fields, template, attachments and its linked runs, results and defects. |
| `list_archived_test_cases` | read | List the test cases that have been archived in a project — the source of the ids the bulk-retrieve (un-archive) call needs. |
| `list_binned_test_cases` | read | List the test cases sitting in a project's recycle bin (moved to bin / soft-deleted, awaiting purge) with who binned them and when — use this to find a case to restore or inspect; for just 'how many are in the bin' use count_binned_test_cases instead |
| `list_folder_test_cases` | read | List the test cases in one folder — the repository browser read, with optional extra columns and custom fields. |
| `list_test_cases` | read | List a project's test cases across every folder — the project-wide repository read. Requires all_folders=true. |
| `search_project_entities_by_filter` | read | Search for entities within a project (v2 - POST with body) |
| `bulk_archive_test_cases_by_project` | write | Bulk Archive Test Cases |
| `bulk_copy_test_cases` | write | Copy test cases into another folder or another project — by listing their ids, or by copying everything a filter matches — and clone cases in place. |
| `bulk_edit_test_cases_in_test_run` | write | Mark many of a test run's cases at once — set their result status, assign them, add a comment, link defects or set result custom fields. |
| `bulk_move_test_cases` | write | Move test cases into another folder, or into another project, by id or by filter. |
| `bulk_replace_test_case_fields` | write | Set the same field values — owner, priority, status, case type, tags, custom fields, review state — on many test cases at once from the project-wide search/filter view. |
| `create_bulk_test_cases` | write | Create several test cases in one folder in a single call (up to 10) — the call to use whenever you have more than one case to add. |
| `create_test_case` | write | Create a test case in a folder. |
| `create_test_case_by_integer_id` | write | Create one test case at the project level — the call to use to seed the FIRST case in a project that has no folders yet, via create_at_root. |
| `create_test_cases` | write | Create one test case in a folder — the normal single-case create. For more than one case, use the bulk create instead. |
| `edit_test_case` | write | Edit one test case through the full edit form — rename it, rewrite its steps, preconditions and expected result, retag it, or send it for review. |
| `edit_test_case_partial` | write | Change just the fields you name on one test case, leaving everything you omit untouched — the safe path for an inline single-field edit. |
| `move_test_case` | write | File one test case in a different folder — use this to reorganise the tree, move a case out of an inbox/triage folder, or put a case where a run or plan expects to find it |
| `reorder_test_cases_by_folder` | write | Change the manual order of test cases within a folder by dropping a block of them between two neighbours. |
| `update_test_case` | write | Change one existing test case — rename it, rewrite its steps, preconditions or description, set priority/status/type/owner, retag it, relink issues or put it into review — sending only the fields you want changed |

</details>

<details>
<summary><b>test_plan</b> — 18 capabilities (10 read · 8 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_archived_test_plan_count` | read | How many test plans in this project are archived — the badge number for the archived view; use the archived-plans listing when you need the plans themselves |
| `get_test_plan` | read | Read one test plan or sub-plan — dates, status, owner-facing description, tags, linked issues, how many runs and sub-plans it holds, and a first glimpse of the runs inside it |
| `get_test_plan_by_integer_id` | read | Read one test plan or sub-plan in full by its integer id — name, dates, status, owner, tags, custom fields, reviewers, progress rollup, and its TP-NNN / STP-NNN identifier |
| `get_test_plan_execution_trend` | read | Execution-trend chart series (results over time) for exactly ONE test plan or ONE test run — the Insights trend graph; scope it with test_plan_id or test_run_id, never both |
| `get_test_plan_linked_sessions_chart_data` | read | Chart data for the exploratory sessions linked to one test plan — the plan's sessions insight tile |
| `list_archived_test_plans` | read | Page through the test plans that have been ARCHIVED in a project — the place to find a plan to restore; archived plans do not appear in the normal plan listing at all |
| `list_test_plan_test_runs` | read | List the test runs that belong to a test plan, with each run's state, assignee and pass/fail progress — the read behind 'how is this release going?' and 'which runs are in this plan?' |
| `list_test_plan_test_runs_by_integer_id` | read | List the test runs linked to a test plan, with each run's state and progress — optionally including the runs that belong to its sub-plans |
| `list_test_plans` | read | List the test plans in a project — the read that turns a plan name the user said into the TP-NNN id every other plan call needs, and answers 'what plans do we have?' |
| `list_test_plans_by_integer_id` | read | Page through a project's test plans — filter by status, search and sort, and optionally include sub-plans; this is how you resolve a plan name a user mentioned to the integer id every other v1 plan route needs |
| `bulk_archive_test_plans` | write | Archive test plans in bulk — the reversible way to get plans out of the active listing; use this instead of delete whenever the user might want them back |
| `bulk_restore_archived_test_plans` | write | Restore archived test plans in bulk — puts them back into the normal plan listing; this is the undo for a bulk archive |
| `clone_test_plan` | write | Copy a test plan into a brand-new plan, bringing its test runs (and optionally its sub-plans) with it — the copy is built in the background, so this hands back a job id rather than the new plan |
| `create_sub_test_plan` | write | Break a test plan into a child plan — use this when a release plan needs per-team, per-phase or per-platform slices that each hold their own runs |
| `create_test_plan` | write | Create a test plan to group the test runs for a release, sprint or milestone — the TP-NNN it returns is what runs and sub-plans then hang off |
| `create_test_plan_by_integer_id` | write | Create a test plan to group test runs for a release or milestone — or create a SUB-plan under an existing plan by setting parent_plan_id |
| `update_test_plan` | write | Change an existing test plan or sub-plan — rename it, move its dates, retag it, relink issues, or start/complete it; note that attaching or detaching a test run is NOT done from the plan on v2, it is set on the run |
| `update_test_plan_by_integer_id` | write | Edit a test plan or sub-plan — rename it, change its dates, owner, tags, custom fields or reviewers, move its status forward, or replace the set of test runs it groups |

</details>

<details>
<summary><b>test_run</b> — 23 capabilities (11 read · 12 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `count_run_selection` | read | Ask how many test cases a folder/case selection will actually resolve to — including the multiplication by configurations — before committing it to a run create or edit |
| `get_test_run` | read | Look up one test run — its state, owner, tags, configurations, linked plan and per-status progress counts |
| `get_test_run_by_integer_id` | read | Get a test run by INTEGER id (v1) — full detail + its TR-NNN identifier |
| `get_test_run_detail` | read | Open a test run's detail view — its header, progress counts, linked defects and the dynamic-filter rule behind it. This does NOT return the run's test cases; list those separately |
| `get_test_run_progress` | read | Get pass/fail/untested progress of a test run broken down by result status — per configuration (browser/device) across the whole run, or for one configuration — to answer 'how far along is this run on each configuration?' |
| `get_test_runs_form_fields` | read | Discover the fields available when recording a test RESULT in this project — the built-in status options and, on request, the project's custom result fields — so a result can be submitted with valid values |
| `list_closed_test_runs` | read | List a project's finished (closed) test runs — the ones the default run listing leaves out — to report on completed cycles |
| `list_test_run_test_cases` | read | List the test cases inside a run with their latest result, assignee and configuration — the read to answer "what is still untested / failing in this run?" |
| `list_test_runs` | read | Find test runs in a project — filter by owner, lifecycle state, linked plan or date to locate a run, count how many there are, or collect the run ids you need before linking runs to a test plan |
| `list_test_runs_by_integer_id` | read | List a project's active test runs with their progress counts, owner and linked plan — the starting point for finding a run to read, execute or report on |
| `list_test_runs_selection` | read | Resolve a folder/case selection into the actual list of test cases it covers — use it to preview or page through what a run create or edit would pull in before committing it |
| `assign_test_run_owner` | write | Assign a owner to the test run |
| `assign_test_run_test_cases` | write | Hand specific test cases inside a run to the people who should execute them (or clear their assignee) |
| `bulk_set_test_case_assignee_in_run` | write | Set the assignee on many test cases inside a test run in one call — pick the rows explicitly, or select every row matching the current filter and deselect a few |
| `bulk_update_test_run_test_cases` | write | Change which test cases a run covers — bulk-add cases to it, or bulk-remove them, optionally per configuration |
| `clone_test_run` | write | Copy an existing run into a brand-new run — the usual way to re-execute just the failed or blocked cases from the last cycle |
| `clone_test_run_by_integer_id` | write | Copy an existing test run into a new one — optionally carrying over its cases, their assignees, tags and linked defects — to re-execute the same scope without rebuilding the selection |
| `close_test_run` | write | Close a test run — freeze its results, mark the cycle finished and drop it out of the default run listing |
| `create_test_run` | write | Create a test run in a project and load it with the test cases to be executed — the starting point for recording results, and what you make before assigning testers or linking the run to a plan |
| `create_test_run_by_integer_id` | write | Create a test run for a project |
| `edit_test_run` | write | Rewrite a test run through the full edit form — rename it, move its state on, change owner, tags, configurations or linked plan. NOT the way to add cases: the case selection you send becomes the run's entire membership, so add cases with bulk_update_test_run_test_cases (add_test_cases) instead |
| `replace_test_run` | write | Rewrite a test run from a complete payload — every metadata field you leave out is reset, so the run ends up as whatever this one body says. Use the partial update instead when you only mean to change some fields. |
| `update_test_run` | write | Change just the fields you name on a test run — rename it, move its state on, link or unlink a test plan, attach configurations or a dynamic filter — leaving everything you omit untouched |

</details>

<details>
<summary><b>user</b> — 3 capabilities (3 read · 0 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `list_group_users` | read | List or look up the people in this workspace — search by name, resolve an exact email, or read your own identity — to get the user id that owner and assignee fields take |
| `list_users` | read | List the account's active users, for assigning a case or run. |
| `search_project_users` | read | Find people by name and read their role, permissions and product access — the search behind owner and assignee pickers; note it searches the whole workspace, not just this project's members |

</details>

<details>
<summary><b>version</b> — 5 capabilities (4 read · 1 write)</summary>

| Capability | Mode | What it does |
|---|---|---|
| `get_test_case_histories` | read | See what changed on a test case, when, and who changed it — the revision trail, newest first, naming the fields touched in each edit; the read to answer 'what did this case look like before that edit?' or 'which revision should we roll back to?' |
| `get_test_case_history` | read | Read one revision of a test case in full — the per-field before/after for that single change and who made it; the follow-up read after finding a revision in the trail |
| `get_test_case_history_diff` | read | Compare two revisions of a test case field by field — what the name, description, preconditions, steps, status, priority, owner, tags, defects, attachments, reviewers and custom fields looked like in each |
| `list_test_case_histories` | read | List a test case's revision trail — who changed it, when, which fields moved, and the ids you need to view, diff or restore an earlier version |
| `restore_history` | write | Roll a test case back to an earlier revision — reapplies that snapshot's name, description, preconditions, steps, status, priority, owner, tags, defects, custom fields, attachments and reviewers to the live case |

</details>
