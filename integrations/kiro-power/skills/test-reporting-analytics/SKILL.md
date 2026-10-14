---
name: test-reporting-analytics
description: Investigate builds, tests, unique errors, flakiness, quality gates and trends in BrowserStack Test Reporting & Analytics through the capability registry
---

# Investigate test results in Test Reporting & Analytics

Load this skill when the user says "build trends", "unique errors", "quality gate", "flaky over time", "compare two builds", "test health", "dashboard", "which tests always fail", or asks about a build beyond a single failure. For one failed test's cause, `automate` or `app-automate` is faster.

**Governing rule: resolve the project, then the build, then drill in. Reads only.** Test Reporting is almost entirely read-only analysis. Reach it through `searchCapability` → `describeCapability` → `invokeCapability` with `product: "tra"`. Two listing capabilities quietly subscribe the user to project notifications; avoid them (see below).

## Step 0: Product routing

Call `listProducts` with the user's request once per task. "Build run", "unique error", "quality gate" and "flaky" belong to Test Reporting only and route without a question. "Project", "report" and "dashboard" clash with Test Management; when the registry reports a clash, ask and resend with the user's words in `user_words` and the `routing_token`.

## Step 1: Resolve the project

- Named project: search "resolve a project by name", which points at `list_projects_lite_paginated` with `search`. It returns the numeric `id` (for integer-id capabilities) and `normalisedName` (for name-path capabilities). Keep both.
- No project named: `get_default_project` returns the group's most recently active project. Say which one you picked.
- Do not page through `list_projects`; pages are tiny and unfiltered.

## Step 2: Resolve the build

- Named build: search "list builds in a project", use `list_project_builds_by_project_id` with the numeric id and `unique_build_names`. Rows carry `build_id` (the Test Reporting id), status counts, `build_number` and an `observability_url`. Default window is the last 7 days; pass `date_range` in epoch milliseconds for older builds.
- "Latest build": the same capability with no filter, newest at the end of the page.
- Avoid `list_recent_runs` and `list_project_builds_by_name`: both subscribe the user to the project's email notifications as a side effect.

Named tools cover the common path without the registry: `getBuildId` (current user's builds), `listBuildId` (all users), `listTestIds` (tests in a build by status), `fetchBuildInsights` (counts, failure categories, smart tags, quality gate, dashboard link).

## Step 3: Drill in

| User wants | Search phrase | Returns |
|---|---|---|
| What changed between two runs | "compare two build runs" | newly failed, fixed, unchanged |
| Why the build is unstable | "read build run statistics" | stability, flaky, always-failing, new-failure, muted counts |
| The distinct errors behind the failures | "list unique errors", then "get unique error details" | error clusters with impacted tests and trend |
| Tests that look alike | "find similar errors" | runs sharing an error signature |
| One test's history | "get test details" | steps, platform, retries, earlier runs |
| Why the gate failed | "quality gate result for a build" | profile and rule verdicts |
| Trends over weeks | "testing trends" | flakiness, stability, performance cards |
| Self-healed locators across a build | "self-healing report" | healed pairs and review verdicts |

The reference file `references/workflows.md` lists all 58 product workflows by entity with the capability names behind each. Use it to put the user's request into the product's words before searching.

## Read the flags before you explain

`listTestIds` with `includeFailureDetail: true` and `fetchBuildInsights` return `is_flaky`, `is_always_failing`, `is_new_failure` and failure categories. Lead with them: a new failure after a passing history is a regression; an always-failing test is tech debt; a flaky one needs stabilising, not debugging. Then drill in only where the flags point.

## Result card

- **Build**: name, number, status, pass/fail counts
- **Finding**: one sentence, for example "3 of 5 failures share one unique error introduced in build 459"
- **Evidence**: the flag, count or error signature that supports it
- **Link**: the observability URL
- **Next**: at most two, for example "debug the top error" or "compare with the last green build"

## Never

- Never invoke `list_recent_runs` or `list_project_builds_by_name`; they change the user's subscriptions.
- Never page through every build or every test; filter by name, status or date.
- Never present a flaky test as a regression.
- Never paste a capability's raw JSON; summarise and link.
