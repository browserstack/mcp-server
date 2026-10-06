# BrowserStack MCP Server — Tool Reference

This page lists every tool the BrowserStack MCP Server registers, in two layers:

1. **[Core tools](#-core-tools)** — five tools that find and run any BrowserStack capability from a catalog. This is the recommended path and the one the [BrowserStack MCP docs](https://www.browserstack.com/docs/browserstack-mcp-server/tools) describe.
2. **[Named tools](#-named-tools)** — the 46 product-specific tools that predate the core tools. They are still registered and supported, and remain in your client's tool list until they are deprecated in favour of the core tools. Prefer the core tools for new workflows.

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

### Prompt examples

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

---

## 🗂️ Named Tools

The 46 tools below are registered alongside the core tools. Each entry gives the tool name, what it does, and a prompt that triggers it.

### 🧾 Test Management

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

---

### ⚙️ BrowserStack SDK Setup / Automate Test

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

---

### 🔍 Observability

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

---

### 📱 App Live

 21. `runAppLiveSession` — Start a manual app testing session on a real device in the cloud.
  **Prompt example**

  ```text
  Open my app on iPhone 15 Pro Max with iOS 17. App path is /Users/xyz/app.ipa
  ```

---

### 💻 Live

 22. `runBrowserLiveSession` — Start a Live session for website testing on desktop or mobile browsers.
  **Prompt example**

  ```text
  Open www.google.com on the latest version of Microsoft Edge on Windows 11
  ```

---

### 📲 App Automate

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

---

### ♿ Accessibility

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

---

### 🎨 Percy Visual Testing

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

---

### 🤖 BrowserStack AI Agents

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


