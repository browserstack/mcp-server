---
name: app-automate
description: Run mobile app test suites on real devices in BrowserStack App Automate, Appium via the SDK or pre-built Espresso and XCUITest by upload, then debug failures with root-cause analysis, Appium and device logs
---

# BrowserStack App Automate: run mobile app tests and debug failures

Load this skill when the user has a mobile test suite or a failed mobile build: "run my Appium tests on real devices", "run the Espresso suite", "test this IPA with XCUITest", "why did the iOS regression fail", "take a screenshot of the app on a Pixel 8".

**Governing rule: two different run paths, one debug path.** Appium projects go through SDK setup. Compiled Espresso or XCUITest suites go through upload and run. Debugging is the same for both and uses the `app-automate` session type, which has its own log types.

## Part A: Run

### Path 1: Appium project

1. Detect language (java, nodejs, python, ruby, csharp) and runner; confirm in one line.
2. `setupBrowserStackAppAutomateTests` takes `appPath` as a local .apk or .ipa path, which it uploads, or a `bs://` id from an earlier upload. Ask the user which they have; never invent a `bs://` id.
3. Devices only when named, up to three, each with `platform`, `deviceName`, `osVersion`, exact names.
4. Apply the returned SDK instructions with approval, then run the suite with the project's normal command.

### Path 2: Espresso or XCUITest suite

1. Upload the app and the test suite first. `help-asset-upload` with `asset_type` `espresso-app` and `espresso-test-suite` (or the `xcuitest-` pair) returns curl commands the user runs in their own shell. Each returns a `bs://` id.
2. `runAppTestsOnBrowserStack` with `detectedAutomationFramework`, both ids, a `project` name, and devices if named.
3. A 422 means an id is invalid or of the wrong kind. Re-check the uploads; never resend the same ids.

### Screenshot on a device

`takeAppScreenshot` starts a device session with an uploaded app and returns a screenshot. With a bad id it fails after a timeout with a generic driver error, so confirm the id first.

### After the run

`listBuildId` with project and build name, then `fetchBuildInsights` for counts, categories, flags, quality gate and the dashboard link. `listSessions` with `sessionType: app-automate` lists each session's device, OS version, status, dashboard and video links.

## Part B: Debug a failure

### Step 1: Find the failed tests

`listTestIds` with the build id, `status: failed`, `includeFailureDetail: true`. Read the flaky, always-failing and new-failure flags before anything else.

### Step 2: Root cause first

`fetchRCA` with up to three test ids as **numbers**: `listTestIds` returns them as strings, so convert `"4430179170"` to `4430179170` or the call is rejected. It returns the cause, a failure type, log evidence, evidence strength and a proposed fix. It reads Appium, device and network logs for you.

### Step 3: Logs, for `sessionType: app-automate` only

| Use | Why |
|---|---|
| `appiumLogs` | driver errors, filtered to failures |
| `deviceLogs` | OS-level log around the failure |
| `crashLogs` | present only when the app crashed; "none" is normal |
| `video` | the session recording link |
| rejected | `sessionLogs`, `consoleLogs`, `networkLogs` are Automate-only; the tool refuses them for this type |

One `logTypes` entry per call. `fetchAutomationScreenshots` returns captures only when taken; "none found" is normal.

### Step 4: Broken locators

`fetchSelfHealedSelectors` with the session id and `sessionType: app-automate` returns healed pairs when self-healing fired; empty is common. With pairs, `prepareSelfHealingPlan` returns an edit plan with code context and modifies nothing. Show the diff with the cause; apply only on a yes.

### Step 5: Classify

| Cause | Evidence | Next |
|---|---|---|
| Test logic or missing wait | AUTOMATION_BUG, element not found after an action | propose the RCA fix, usually an explicit wait |
| Stale or broken locator | stale element reference in Appium log | healed pair if any, else an accessibility id |
| App crash | crash log present | the app is wrong; show the crash |
| Environment | WebDriverAgent or capability error before the first step | report "did not start"; name the capability or app build |
| Auth or quota | 401, 403, plan text | stop; reconnect or check the plan |

## Result card

- **Suite or test**: framework and the app, or the test name and device
- **Result**: counts and quality gate, or the cause in one sentence with its type
- **Evidence**: the one Appium line or the crash
- **Link**: the observability or session URL
- **Next**: at most two

## Never

- Never run the Espresso or XCUITest path without both uploads confirmed.
- Never pass a local path to `runAppTestsOnBrowserStack`; it takes `bs://` ids only.
- Never request Automate-only log types for this session type.
- Never apply a fix without a yes, and never ask for credentials.
