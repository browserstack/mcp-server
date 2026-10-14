---
name: automate
description: Set up the BrowserStack SDK in a Playwright, Selenium, Cypress or WebdriverIO project, run the suite on real browsers in BrowserStack Automate, then debug failures with root-cause analysis, logs and self-healed selectors
---

# BrowserStack Automate: run web tests and debug failures

Load this skill when the user wants a web test suite on BrowserStack, or wants to know why a web test failed there: "run my Playwright tests on BrowserStack", "set up the SDK", "test on real Safari", "why did the login test fail", "the build is red", "fix the broken locator".

**Governing rule: the setup tool returns instructions, and the root-cause tool returns proposals. Neither changes anything.** Applying setup steps and code fixes is your job, in the user's project, with their approval.

## Part A: Set up and run

### Step 1: Detect, then confirm

Read the project for the language (nodejs, python, java, csharp, ruby), the browser framework (playwright, selenium, cypress, webdriverio) and the test runner (from the tool's list: jest, mocha, pytest, testng, junit5, nunit, cucumber and others). State what you found in one line and let the user correct it.

### Step 2: Devices

Only when the user names them, up to three. Each entry has `platform` (windows, macos, android, ios) and `osVersion`, plus `browser` and `browserVersion` for desktop or `deviceName` for mobile. Names must be exact, for example "iPhone 15 Pro Max" rather than "iPhone 15"; a near miss is rejected with a suggestion list. Choose from suggestions or ask.

### Step 3: Setup

`setupBrowserStackAutomateTests` with `projectName`, the three detected values and the devices. It returns nine steps: install the SDK, run the SDK setup command, add a package script, export credentials, write `browserstack.yml` with the validated platforms, run. Apply them in order. Credentials belong in environment variables or the yml placeholders; never commit a real key and never ask for one in chat.

### Step 4: Run and verify

Run the suite with the script the setup added. Then `getBuildId` with the project and build names from `browserstack.yml`. It is scoped to the current user; for a build a colleague or CI triggered, use `listBuildId`. Both need the full original build name. Then `fetchBuildInsights` for counts, failure categories, flaky and new-failure flags, the quality gate and the dashboard link.

## Part B: Debug a failure

### Step 1: Find the failed tests

`listTestIds` with the build id, `status: failed`, `includeFailureDetail: true`. Each row has the test id, session id, a one-line error, and flags for flaky, always-failing and new failure. Read the flags first: a new failure is a regression, an always-failing test is debt, a flaky one needs stabilising.

### Step 2: Root cause first

`fetchRCA` with up to three numeric test ids. It returns the cause in one sentence, a failure type (AUTOMATION_BUG, PRODUCT_BUG, ENVIRONMENT), the log evidence, an evidence strength, and a suggested fix marked as a proposal. For most failures this is the whole diagnosis. If RCA is unavailable, go to logs.

### Step 3: Logs, for `sessionType: automate` only

| Use | Why |
|---|---|
| `consoleLogs` | JavaScript errors, already filtered |
| `networkLogs` | failed requests only, with status and URL |
| `video` | the session recording link |
| never `sessionLogs` first | the raw driver log, often hundreds of thousands of characters even for a short test. Request it only by explicit user ask and summarise from the file, never into context |

One `logTypes` entry per `getFailureLogs` call. `fetchAutomationScreenshots` returns captures only when the SDK took them; "none found" is normal.

### Step 4: Broken locators

`fetchSelfHealedSelectors` with the session id returns healed locator pairs when self-healing fired, plus the test source and a link to it. An empty list is common. With pairs, `prepareSelfHealingPlan` returns an edit plan with the code context; it does not modify files. Find the exact call site, show the diff with the cause, apply only on a yes.

### Step 5: Classify

| Cause | Evidence | Next |
|---|---|---|
| Test logic | AUTOMATION_BUG, expected versus received | propose the RCA fix |
| Broken selector | element not found, stale element | healed pair if any, else a stable locator |
| Timing | timeout on element or navigation | explicit wait on the right condition |
| Product bug | PRODUCT_BUG, console error or 5xx at the step | the test is likely right; show the error |
| Environment | session never started, capability error | report "did not start"; name the capability |
| Auth or quota | 401, 403, plan text | stop; reconnect or check the plan |

## Result card

- **Suite or test**: framework and platforms, or the test name and browser
- **Result**: counts and quality gate, or the cause in one sentence with its type
- **Evidence**: the one line that proves it
- **Link**: the observability or session URL
- **Next**: at most two

## Never

- Never run setup on a project you have not read, or add platforms the user did not ask for.
- Never request `sessionLogs` before RCA and console logs.
- Never apply a fix without showing it and getting a yes.
- Never report an environment error as a test failure.
