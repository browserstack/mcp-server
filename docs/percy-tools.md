# Percy MCP Tools — Complete Reference

> 43 visual testing tools for AI agents

Percy MCP gives AI agents (Claude Code, Cursor, Windsurf, etc.) direct access to Percy's visual testing platform — query builds, analyze diffs, create builds, manage projects, and automate visual review workflows.

## Quick Start — Two Essential Commands

### Create a Build with Snapshots

```
Use percy_create_percy_build with project_name "my-app" and urls "http://localhost:3000"
```

This single command:
- Auto-creates the project if it doesn't exist
- Gets/creates a project token
- Auto-detects git branch and SHA
- Returns ready-to-run Percy CLI commands

### Check Visual Regression Status

```
Use percy_pr_visual_report with branch "feature-x"
```

Returns a complete visual regression report with risk-ranked snapshots and AI analysis.

---

## Tools by Category (43 tools)

### CREATE (6 tools)
- `percy_create_project` — Create a new Percy project
- `percy_create_percy_build` — **THE primary build creation tool** (URL scanning, screenshot upload, test wrapping, or build cloning)
- `percy_create_build` — Create an empty build (low-level)
- `percy_create_snapshot` — Create a snapshot with DOM resources (low-level)
- `percy_create_app_snapshot` — Create a snapshot for App/BYOS builds (low-level)
- `percy_create_comparison` — Create a comparison with device/browser tag (low-level)

### READ (17 tools)
- `percy_list_projects` — List projects in an organization
- `percy_list_builds` — List builds with filtering by branch, state, SHA
- `percy_get_build` — Get detailed build info including AI metrics
- `percy_get_build_items` — List snapshots filtered by category
- `percy_get_snapshot` — Get snapshot with all comparisons and screenshots
- `percy_get_comparison` — Get comparison with diff ratios and AI regions
- `percy_get_ai_analysis` — Get AI-powered visual diff analysis
- `percy_get_build_summary` — Get AI-generated natural language build summary
- `percy_get_ai_quota` — Check AI quota status
- `percy_get_rca` — Get Root Cause Analysis (DOM/CSS changes)
- `percy_get_suggestions` — Get build failure diagnostics and fix steps
- `percy_get_network_logs` — Get parsed network request logs
- `percy_get_build_logs` — Download and filter build logs
- `percy_get_usage_stats` — Get screenshot usage and quota limits
- `percy_auth_status` — Check authentication status
- `percy_analyze_logs_realtime` — Analyze raw log data without a stored build
- `percy_pr_visual_report` — **THE primary read tool** (complete visual regression report)

### UPDATE (12 tools)
- `percy_approve_build` — Approve, reject, or request changes on a build
- `percy_manage_project_settings` — View or update project settings
- `percy_manage_browser_targets` — List, add, or remove browser targets
- `percy_manage_tokens` — List or rotate project tokens
- `percy_manage_webhooks` — Create, update, list, or delete webhooks
- `percy_manage_ignored_regions` — Create, list, save, or delete ignored regions
- `percy_manage_comments` — List, create, or close comment threads
- `percy_manage_variants` — List, create, or update A/B testing variants
- `percy_manage_visual_monitoring` — Create, update, or list Visual Monitoring projects
- `percy_trigger_ai_recompute` — Re-run AI analysis with a custom prompt
- `percy_suggest_prompt` — Get AI-generated prompt suggestion for diff regions
- `percy_branchline_operations` — Sync, merge, or unmerge branch baselines

### FINALIZE / UPLOAD (5 tools)
- `percy_finalize_build` — Finalize a build after all snapshots are complete
- `percy_finalize_snapshot` — Finalize a snapshot after resources are uploaded
- `percy_finalize_comparison` — Finalize a comparison after tiles are uploaded
- `percy_upload_resource` — Upload a resource (CSS, JS, image, HTML) to a build
- `percy_upload_tile` — Upload a screenshot tile (PNG/JPEG) to a comparison

### WORKFLOWS (3 composites)
- `percy_auto_triage` — Auto-categorize all visual changes (Critical/Review/Noise)
- `percy_debug_failed_build` — Diagnose a build failure with actionable fix commands
- `percy_diff_explain` — Explain visual changes in plain English (summary/detailed/full_rca)

---

## Table of Contents

- [Setup](#setup)
- [CREATE Tools](#create-tools)
- [READ Tools](#read-tools)
- [UPDATE Tools](#update-tools)
- [FINALIZE / UPLOAD Tools](#finalize--upload-tools)
- [WORKFLOW Tools](#workflow-tools)
- [Quick Reference — Common Prompts](#quick-reference--common-prompts)

---

## Setup

Add this to your MCP client configuration (e.g., `.claude/settings.json` or `mcp.json`):

```json
{
  "mcpServers": {
    "browserstack-percy": {
      "command": "npx",
      "args": ["-y", "@anthropic/browserstack-mcp"],
      "env": {
        "PERCY_TOKEN": "<your-percy-write-token>",
        "PERCY_FULL_ACCESS_TOKEN": "<your-percy-full-access-token>",
        "PERCY_ORG_TOKEN": "<your-percy-org-token>"
      }
    }
  }
}
```

### Token Types

| Token | Env Var | Scope | Used For |
|-------|---------|-------|----------|
| Write-only token | `PERCY_TOKEN` | Single project | Creating builds, uploading snapshots, finalizing |
| Full-access token | `PERCY_FULL_ACCESS_TOKEN` | Single project | Querying builds, approvals, AI analysis, diagnostics |
| Org token | `PERCY_ORG_TOKEN` | Organization-wide | Listing projects across org, usage stats, cross-project queries |

### Verify Setup

In Claude Code, type `/mcp` to see connected servers, then ask:

> "Check my Percy authentication"

This calls `percy_auth_status` and reports which tokens are valid and their scope.

---

## CREATE Tools

### `percy_create_project`

**Description:** Create a new Percy project. Auto-creates if it doesn't exist, returns project token.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Project name (e.g. 'my-web-app') |
| type | enum | No | Project type: `web` or `automate` (default: web) |

**Example prompt:**
> "Create a Percy project called my-web-app"

**Example tool call:**
```json
{
  "tool": "percy_create_project",
  "params": {
    "name": "my-web-app",
    "type": "web"
  }
}
```

**Example output:**
```
## Project Created
**Name:** my-web-app
**Project ID:** 12345
**Type:** web
**Token:** ****a1b2 (write)

The project is ready. Use percy_create_percy_build to start a build.
```

---

### `percy_create_percy_build`

**Description:** Create a complete Percy build with snapshots. Supports URL scanning, screenshot upload, test wrapping, or build cloning. **The primary build creation tool.**

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_name | string | Yes | Percy project name (auto-creates if doesn't exist) |
| urls | string | No | Comma-separated URLs to snapshot, e.g. 'http://localhost:3000,http://localhost:3000/about' |
| screenshots_dir | string | No | Directory path containing PNG/JPG screenshots to upload |
| screenshot_files | string | No | Comma-separated file paths to PNG/JPG screenshots |
| test_command | string | No | Test command to wrap with Percy, e.g. 'npx cypress run' or 'npm test' |
| clone_build_id | string | No | Build ID to clone snapshots from |
| branch | string | No | Git branch (auto-detected from git if not provided) |
| commit_sha | string | No | Git commit SHA (auto-detected from git if not provided) |
| widths | string | No | Comma-separated viewport widths, e.g. '375,768,1280' (default: 375,1280) |
| snapshot_names | string | No | Comma-separated snapshot names (for screenshots — defaults to filename) |
| test_case | string | No | Test case name to associate snapshots with |
| type | enum | No | Project type: `web`, `app`, or `automate` (default: web) |

**5 Modes of Operation:**

1. **URL Snapshots** — Provide `urls` to snapshot live pages:
   > "Create a Percy build for my-app snapshotting http://localhost:3000 and http://localhost:3000/about"

2. **Screenshot Upload from Directory** — Provide `screenshots_dir`:
   > "Create a Percy build for my-app uploading screenshots from ./screenshots/"

3. **Screenshot Upload from Files** — Provide `screenshot_files`:
   > "Create a Percy build for my-app with screenshots login.png and dashboard.png"

4. **Test Command Wrapping** — Provide `test_command`:
   > "Create a Percy build for my-app running 'npx cypress run'"

5. **Build Cloning** — Provide `clone_build_id`:
   > "Create a Percy build for my-app cloning build 67890"

**Example tool call — URL snapshots:**
```json
{
  "tool": "percy_create_percy_build",
  "params": {
    "project_name": "my-web-app",
    "urls": "http://localhost:3000,http://localhost:3000/about",
    "widths": "375,768,1280"
  }
}
```

**Example output:**
```
## Percy Build Created
**Project:** my-web-app (auto-created)
**Build ID:** 67890
**Branch:** feature-login (auto-detected)
**SHA:** abc123def456 (auto-detected)

### Snapshots
1. Homepage — 375px, 768px, 1280px
2. About — 375px, 768px, 1280px

Build finalized and processing. Check status with percy_get_build.
```

**Example tool call — screenshot upload:**
```json
{
  "tool": "percy_create_percy_build",
  "params": {
    "project_name": "my-mobile-app",
    "screenshots_dir": "./screenshots/",
    "type": "app"
  }
}
```

**Example tool call — test command:**
```json
{
  "tool": "percy_create_percy_build",
  "params": {
    "project_name": "my-web-app",
    "test_command": "npx cypress run"
  }
}
```

---

Now continues the low-level build creation tools (used by `percy_create_percy_build` internally, or for advanced custom workflows):

---

## READ Tools

### `percy_auth_status`

**Description:** Check Percy authentication status — shows which tokens are configured, validates them, and reports project/org scope.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | — | — | No parameters required |

**Example prompt:**
> "Check my Percy authentication"

**Example tool call:**
```json
{
  "tool": "percy_auth_status",
  "params": {}
}
```

**Example output:**
```
## Percy Authentication Status

PERCY_TOKEN: Configured (project-scoped)
  Project: my-web-app (ID: 12345)
  Role: write

PERCY_FULL_ACCESS_TOKEN: Configured (project-scoped)
  Project: my-web-app (ID: 12345)
  Role: full_access

PERCY_ORG_TOKEN: Not configured
  Tip: Set PERCY_ORG_TOKEN to list projects across your organization.
```

---

### `percy_list_projects`

**Description:** List Percy projects in an organization. Returns project names, types, and settings.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| org_id | string | No | Percy organization ID. If not provided, uses token scope. |
| search | string | No | Filter projects by name (substring match) |
| limit | number | No | Max results (default 10, max 50) |

**Example prompt:**
> "List all my Percy projects"

**Example tool call:**
```json
{
  "tool": "percy_list_projects",
  "params": {
    "search": "web-app",
    "limit": 5
  }
}
```

**Example output:**
```
## Percy Projects (3 found)

1. **my-web-app** (ID: 12345)
   Type: web | Branches: main, develop
   Last build: #142 — 2 days ago

2. **mobile-app** (ID: 12346)
   Type: app | Branches: main
   Last build: #89 — 1 week ago

3. **design-system** (ID: 12347)
   Type: web | Branches: main, feature/tokens
   Last build: #231 — 3 hours ago
```

---

### `percy_list_builds`

**Description:** List Percy builds for a project with filtering by branch, state, SHA. Returns build numbers, states, review status, and AI metrics.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | No | Percy project ID. If not provided, uses PERCY_TOKEN scope. |
| branch | string | No | Filter by branch name |
| state | string | No | Filter by state: pending, processing, finished, failed |
| sha | string | No | Filter by commit SHA |
| limit | number | No | Max results (default 10, max 30) |

**Example prompt:**
> "Show me recent Percy builds on the develop branch"

**Example tool call:**
```json
{
  "tool": "percy_list_builds",
  "params": {
    "branch": "develop",
    "state": "finished",
    "limit": 5
  }
}
```

**Example output:**
```
## Percy Builds — develop branch (5 shown)

| # | State | Review | Changed | SHA | Age |
|---|-------|--------|---------|-----|-----|
| 142 | finished | approved | 3 snapshots | abc1234 | 2h ago |
| 141 | finished | unreviewed | 12 snapshots | def5678 | 1d ago |
| 140 | finished | approved | 0 snapshots | ghi9012 | 2d ago |
| 139 | failed | — | — | jkl3456 | 3d ago |
| 138 | finished | changes_requested | 7 snapshots | mno7890 | 4d ago |
```

---

### `percy_get_build`

**Description:** Get detailed Percy build information including state, review status, snapshot counts, AI analysis metrics, and build summary.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |

**Example prompt:**
> "Show me details for Percy build 12345"

**Example tool call:**
```json
{
  "tool": "percy_get_build",
  "params": {
    "build_id": "12345"
  }
}
```

**Example output:**
```
## Build #142 — FINISHED
**Branch:** develop | **SHA:** abc1234
**Review:** unreviewed | **Approved by:** —
**Created:** 2024-01-15 10:30 UTC

### Snapshot Counts
- Total: 45
- Changed: 3
- New: 1
- Removed: 0
- Unchanged: 41

### AI Analysis
- Comparisons analyzed: 8/8
- Auto-approved by AI: 5
- Flagged for review: 3
- Diff reduction: 62%
```

---

### `percy_get_build_items`

**Description:** List snapshots in a Percy build filtered by category (changed/new/removed/unchanged/failed). Returns snapshot names with diff ratios and AI flags.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |
| category | string | No | Filter category: changed, new, removed, unchanged, failed |
| sort_by | string | No | Sort field (e.g. diff-ratio, name) |
| limit | number | No | Max results (default 20, max 100) |

**Example prompt:**
> "Show me all changed snapshots in build 12345, sorted by diff ratio"

**Example tool call:**
```json
{
  "tool": "percy_get_build_items",
  "params": {
    "build_id": "12345",
    "category": "changed",
    "sort_by": "diff-ratio",
    "limit": 10
  }
}
```

**Example output:**
```
## Build #142 — Changed Snapshots (3 of 3)

1. **Homepage — Desktop** (snapshot: 99001)
   Diff ratio: 0.42 (42%) | AI: flagged_for_review
   Comparisons: Chrome 1280px, Firefox 1280px

2. **Checkout — Mobile** (snapshot: 99002)
   Diff ratio: 0.08 (8%) | AI: auto_approved
   Comparisons: Chrome 375px

3. **Settings Page** (snapshot: 99003)
   Diff ratio: 0.003 (0.3%) | AI: auto_approved
   Comparisons: Chrome 1280px, Chrome 768px
```

---

### `percy_get_snapshot`

**Description:** Get a Percy snapshot with all its comparisons, screenshots, and diff data across browsers and widths.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| snapshot_id | string | Yes | Percy snapshot ID |

**Example prompt:**
> "Get details for snapshot 99001"

**Example tool call:**
```json
{
  "tool": "percy_get_snapshot",
  "params": {
    "snapshot_id": "99001"
  }
}
```

**Example output:**
```
## Snapshot: Homepage — Desktop

**Build:** #142 (ID: 12345)
**Widths:** 1280, 768

### Comparisons

1. **Chrome @ 1280px** (comparison: 55001)
   Diff ratio: 0.42 | State: finished
   Base screenshot: https://percy.io/...
   Head screenshot: https://percy.io/...

2. **Firefox @ 1280px** (comparison: 55002)
   Diff ratio: 0.38 | State: finished
   Base screenshot: https://percy.io/...
   Head screenshot: https://percy.io/...
```

---

### `percy_get_comparison`

**Description:** Get detailed Percy comparison data including diff ratios, AI analysis regions, screenshot URLs, and browser info.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | Yes | Percy comparison ID |
| include_images | boolean | No | Include screenshot image URLs in response (default false) |

**Example prompt:**
> "Show me comparison 55001 with screenshot URLs"

**Example tool call:**
```json
{
  "tool": "percy_get_comparison",
  "params": {
    "comparison_id": "55001",
    "include_images": true
  }
}
```

**Example output:**
```
## Comparison: Chrome @ 1280px

**Snapshot:** Homepage — Desktop (99001)
**Diff ratio:** 0.42 (42%)
**State:** finished

### AI Analysis Regions
1. Region at (120, 340, 400, 200): "Hero banner image replaced"
   Classification: intentional_change
2. Region at (0, 0, 1280, 60): "Navigation bar color shifted"
   Classification: potential_bug

### Screenshots
- Base: https://percy.io/screenshots/base/...
- Head: https://percy.io/screenshots/head/...
- Diff: https://percy.io/screenshots/diff/...
```

---

## UPDATE Tools

### `percy_approve_build`

**Description:** Approve, request changes, unapprove, or reject a Percy build. Requires a user token (PERCY_TOKEN). request_changes works at snapshot level only.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID to review |
| action | enum | Yes | Review action: `approve`, `request_changes`, `unapprove`, `reject` |
| snapshot_ids | string | No | Comma-separated snapshot IDs (required for request_changes) |
| reason | string | No | Optional reason for the review action |

**Example prompt — approve:**
> "Approve Percy build 12345"

**Example tool call — approve:**
```json
{
  "tool": "percy_approve_build",
  "params": {
    "build_id": "12345",
    "action": "approve"
  }
}
```

**Example output — approve:**
```
## Build #142 — APPROVED
Build approved successfully.
```

**Example prompt — request changes:**
> "Request changes on snapshots 99001 and 99002 in build 12345"

**Example tool call — request changes:**
```json
{
  "tool": "percy_approve_build",
  "params": {
    "build_id": "12345",
    "action": "request_changes",
    "snapshot_ids": "99001,99002",
    "reason": "Hero banner has wrong color and checkout button is misaligned"
  }
}
```

**Example output — request changes:**
```
## Build #142 — CHANGES REQUESTED
Requested changes on 2 snapshots:
- Homepage — Desktop (99001)
- Checkout — Mobile (99002)
Reason: Hero banner has wrong color and checkout button is misaligned
```

**Example prompt — reject:**
> "Reject Percy build 12345 because of broken layout"

**Example tool call — reject:**
```json
{
  "tool": "percy_approve_build",
  "params": {
    "build_id": "12345",
    "action": "reject",
    "reason": "Layout is completely broken on mobile viewports"
  }
}
```

**Example output — reject:**
```
## Build #142 — REJECTED
Reason: Layout is completely broken on mobile viewports
```

---

## Low-Level Build Creation (CREATE continued)

These low-level tools are used together for custom build workflows. For most use cases, prefer `percy_create_percy_build` above.

**Web build workflow:**
1. `percy_create_build` — start a build
2. `percy_create_snapshot` — declare a snapshot with resources
3. `percy_upload_resource` — upload missing resources
4. `percy_finalize_snapshot` — mark snapshot complete
5. `percy_finalize_build` — mark build complete

**App/BYOS build workflow:**
1. `percy_create_build` — start a build
2. `percy_create_app_snapshot` — create a snapshot (no resources needed)
3. `percy_create_comparison` — define device/browser tag
4. `percy_upload_tile` — upload screenshot image
5. `percy_finalize_comparison` — mark comparison complete

### `percy_create_build`

**Description:** Create an empty Percy build (low-level). Use `percy_create_percy_build` for full automation.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | Yes | Percy project ID |
| branch | string | Yes | Git branch name |
| commit_sha | string | Yes | Git commit SHA |
| commit_message | string | No | Git commit message |
| pull_request_number | string | No | Pull request number |
| type | string | No | Project type: web, app, automate, generic |

**Example prompt:**
> "Create a Percy build for branch feature-login on project 12345"

**Example tool call:**
```json
{
  "tool": "percy_create_build",
  "params": {
    "project_id": "12345",
    "branch": "feature-login",
    "commit_sha": "abc123def456",
    "commit_message": "Add login page redesign",
    "pull_request_number": "42"
  }
}
```

**Example output:**
```
## Build Created
**Build ID:** 67890
**Build number:** #143
**Project:** my-web-app (12345)
**Branch:** feature-login
**State:** pending

Next steps:
1. Create snapshots with percy_create_snapshot
2. Upload missing resources with percy_upload_resource
3. Finalize each snapshot with percy_finalize_snapshot
4. Finalize the build with percy_finalize_build
```

---

### `percy_create_snapshot`

**Description:** Create a snapshot in a Percy build with DOM resources (low-level). Returns missing resource list for upload.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |
| name | string | Yes | Snapshot name |
| widths | string | No | Comma-separated viewport widths, e.g. '375,768,1280' |
| enable_javascript | boolean | No | Enable JavaScript execution during rendering |
| resources | string | No | JSON array of resources: `[{"id":"sha","resource-url":"url","is-root":true}]` |

**Example prompt:**
> "Create a snapshot called 'Homepage' in build 67890 at mobile and desktop widths"

**Example tool call:**
```json
{
  "tool": "percy_create_snapshot",
  "params": {
    "build_id": "67890",
    "name": "Homepage",
    "widths": "375,768,1280",
    "resources": "[{\"id\":\"sha256abc\",\"resource-url\":\"/index.html\",\"is-root\":true},{\"id\":\"sha256def\",\"resource-url\":\"/styles.css\",\"is-root\":false}]"
  }
}
```

**Example output:**
```
## Snapshot Created
**Snapshot ID:** 99010
**Name:** Homepage
**Widths:** 375, 768, 1280

### Missing Resources (need upload)
- sha256def — /styles.css

Upload missing resources with percy_upload_resource, then finalize with percy_finalize_snapshot.
```

---

### `percy_upload_resource`

**Description:** Upload a resource (CSS, JS, image, HTML) to a Percy build. Only upload resources the server doesn't have.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |
| sha | string | Yes | SHA-256 hash of the resource content |
| base64_content | string | Yes | Base64-encoded resource content |

**Example prompt:**
> "Upload the missing CSS resource to build 67890"

**Example tool call:**
```json
{
  "tool": "percy_upload_resource",
  "params": {
    "build_id": "67890",
    "sha": "sha256def",
    "base64_content": "Ym9keSB7IGJhY2tncm91bmQ6IHdoaXRlOyB9"
  }
}
```

**Example output:**
```
## Resource Uploaded
**SHA:** sha256def
**Build:** 67890
Upload successful.
```

---

### `percy_finalize_snapshot`

**Description:** Finalize a Percy snapshot after all resources are uploaded. Triggers rendering.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| snapshot_id | string | Yes | Percy snapshot ID |

**Example prompt:**
> "Finalize snapshot 99010"

**Example tool call:**
```json
{
  "tool": "percy_finalize_snapshot",
  "params": {
    "snapshot_id": "99010"
  }
}
```

**Example output:**
```
## Snapshot Finalized
**Snapshot ID:** 99010
**Name:** Homepage
Rendering triggered for 3 widths x 1 browser = 3 comparisons.
```

---

### `percy_finalize_build`

**Description:** Finalize a Percy build after all snapshots are complete. Triggers processing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |

**Example prompt:**
> "Finalize build 67890"

**Example tool call:**
```json
{
  "tool": "percy_finalize_build",
  "params": {
    "build_id": "67890"
  }
}
```

**Example output:**
```
## Build Finalized
**Build ID:** 67890
**Build number:** #143
State changed to: processing
Percy is now rendering and comparing snapshots. Check status with percy_get_build.
```

---

### `percy_create_app_snapshot`

**Description:** Create a snapshot for App Percy or BYOS builds (no resources needed). Returns snapshot ID.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |
| name | string | Yes | Snapshot name |
| test_case | string | No | Test case name |

**Example prompt:**
> "Create an app snapshot called 'Login Screen' in build 67890"

**Example tool call:**
```json
{
  "tool": "percy_create_app_snapshot",
  "params": {
    "build_id": "67890",
    "name": "Login Screen",
    "test_case": "login_flow_test"
  }
}
```

**Example output:**
```
## App Snapshot Created
**Snapshot ID:** 99020
**Name:** Login Screen
**Test case:** login_flow_test

Next: Create comparisons with percy_create_comparison.
```

---

### `percy_create_comparison`

**Description:** Create a comparison with device/browser tag and tile metadata for screenshot-based builds.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| snapshot_id | string | Yes | Percy snapshot ID |
| tag_name | string | Yes | Device/browser name, e.g. 'iPhone 13' |
| tag_width | number | Yes | Tag width in pixels |
| tag_height | number | Yes | Tag height in pixels |
| tag_os_name | string | No | OS name, e.g. 'iOS' |
| tag_os_version | string | No | OS version, e.g. '16.0' |
| tag_browser_name | string | No | Browser name, e.g. 'Safari' |
| tag_orientation | string | No | portrait or landscape |
| tiles | string | Yes | JSON array of tiles: `[{sha, status-bar-height?, nav-bar-height?}]` |

**Example prompt:**
> "Create an iPhone 13 comparison for snapshot 99020"

**Example tool call:**
```json
{
  "tool": "percy_create_comparison",
  "params": {
    "snapshot_id": "99020",
    "tag_name": "iPhone 13",
    "tag_width": 390,
    "tag_height": 844,
    "tag_os_name": "iOS",
    "tag_os_version": "16.0",
    "tag_orientation": "portrait",
    "tiles": "[{\"sha\":\"tile_sha_abc\",\"status-bar-height\":47,\"nav-bar-height\":34}]"
  }
}
```

**Example output:**
```
## Comparison Created
**Comparison ID:** 55010
**Device:** iPhone 13 (390x844, portrait)
**OS:** iOS 16.0

Missing tiles to upload:
- tile_sha_abc

Upload with percy_upload_tile, then finalize with percy_finalize_comparison.
```

---

### `percy_upload_tile`

**Description:** Upload a screenshot tile (PNG or JPEG) to a Percy comparison.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | Yes | Percy comparison ID |
| base64_content | string | Yes | Base64-encoded PNG or JPEG screenshot |

**Example prompt:**
> "Upload the screenshot tile for comparison 55010"

**Example tool call:**
```json
{
  "tool": "percy_upload_tile",
  "params": {
    "comparison_id": "55010",
    "base64_content": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

**Example output:**
```
## Tile Uploaded
**Comparison ID:** 55010
Upload successful.
```

---

### `percy_finalize_comparison`

**Description:** Finalize a Percy comparison after all tiles are uploaded. Triggers diff processing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | Yes | Percy comparison ID |

**Example prompt:**
> "Finalize comparison 55010"

**Example tool call:**
```json
{
  "tool": "percy_finalize_comparison",
  "params": {
    "comparison_id": "55010"
  }
}
```

**Example output:**
```
## Comparison Finalized
**Comparison ID:** 55010
Diff processing triggered. Check status with percy_get_comparison.
```

---

## READ Tools (continued) — AI Intelligence

### `percy_get_ai_analysis`

**Description:** Get Percy AI-powered visual diff analysis. Provides change types, descriptions, bug classifications, and diff reduction metrics per comparison or aggregated per build.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | No | Get AI analysis for a single comparison |
| build_id | string | No | Get aggregated AI analysis for an entire build |

> Note: Provide either `comparison_id` or `build_id`, not both.

**Example prompt:**
> "Show me the AI analysis for build 12345"

**Example tool call:**
```json
{
  "tool": "percy_get_ai_analysis",
  "params": {
    "build_id": "12345"
  }
}
```

**Example output:**
```
## AI Analysis — Build #142

### Summary
- Total comparisons: 8
- AI-analyzed: 8
- Auto-approved: 5
- Flagged for review: 3
- Diff reduction: 62%

### Flagged Changes
1. **Homepage — Chrome 1280px** (comparison: 55001)
   - "Navigation bar color shifted from #333 to #444" — potential_bug
   - "Hero image replaced with new campaign banner" — intentional_change

2. **Checkout — Chrome 375px** (comparison: 55003)
   - "Submit button moved 20px down" — potential_bug
```

---

### `percy_get_build_summary`

**Description:** Get AI-generated natural language summary of all visual changes in a Percy build.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |

**Example prompt:**
> "Summarize the visual changes in build 12345"

**Example tool call:**
```json
{
  "tool": "percy_get_build_summary",
  "params": {
    "build_id": "12345"
  }
}
```

**Example output:**
```
## AI Build Summary — Build #142

This build introduces visual changes across 3 snapshots. The most significant
change is a new hero banner on the Homepage that replaces the previous campaign
image. The navigation bar shows a subtle color shift that may be unintentional.
On mobile, the checkout button has shifted position which could affect the user
experience. 5 of 8 comparisons were auto-approved as expected visual noise.

**Recommendation:** Review the navigation color change and checkout button
position before approving.
```

---

### `percy_get_ai_quota`

**Description:** Check Percy AI quota status — daily regeneration quota and usage.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | — | — | No parameters required |

**Example prompt:**
> "How many AI regenerations do I have left today?"

**Example tool call:**
```json
{
  "tool": "percy_get_ai_quota",
  "params": {}
}
```

**Example output:**
```
## Percy AI Quota

Daily regeneration limit: 100
Used today: 23
Remaining: 77
Resets at: 00:00 UTC
```

---

### `percy_get_rca`

**Description:** Trigger and retrieve Percy Root Cause Analysis — maps visual diffs back to specific DOM/CSS changes with XPath paths and attribute diffs.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | Yes | Percy comparison ID |
| trigger_if_missing | boolean | No | Auto-trigger RCA if not yet run (default true) |

**Example prompt:**
> "What DOM changes caused the visual diff in comparison 55001?"

**Example tool call:**
```json
{
  "tool": "percy_get_rca",
  "params": {
    "comparison_id": "55001",
    "trigger_if_missing": true
  }
}
```

**Example output:**
```
## Root Cause Analysis — Comparison 55001

### DOM Changes Found: 3

1. **Element:** /html/body/nav/div[1]
   Attribute: style.background-color
   Base: #333333
   Head: #444444
   Impact: Navigation bar color change

2. **Element:** /html/body/main/section[1]/img
   Attribute: src
   Base: /images/campaign-old.jpg
   Head: /images/campaign-new.jpg
   Impact: Hero image replacement

3. **Element:** /html/body/main/section[1]/img
   Attribute: style.height
   Base: 400px
   Head: 450px
   Impact: Hero section height increase
```

---

### `percy_trigger_ai_recompute`

**Description:** Re-run Percy AI analysis on comparisons with a custom prompt. Use to customize what the AI ignores or highlights in visual diffs.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | No | Percy build ID (for bulk recompute) |
| comparison_id | string | No | Single comparison ID to recompute |
| prompt | string | No | Custom prompt for AI (max 400 chars), e.g. 'Ignore font rendering differences' |
| mode | enum | No | `ignore` = hide matching diffs, `unignore` = show matching diffs |

**Example prompt — ignore noise:**
> "Re-run AI analysis on build 12345 and ignore font rendering differences"

**Example tool call — ignore noise:**
```json
{
  "tool": "percy_trigger_ai_recompute",
  "params": {
    "build_id": "12345",
    "prompt": "Ignore font rendering and anti-aliasing differences",
    "mode": "ignore"
  }
}
```

**Example output — ignore noise:**
```
## AI Recompute Triggered
**Build:** 12345
**Prompt:** "Ignore font rendering and anti-aliasing differences"
**Mode:** ignore
**Comparisons queued:** 8

AI analysis will re-run on all comparisons. Check results with percy_get_ai_analysis.
```

**Example prompt — single comparison:**
> "Re-analyze comparison 55001 and highlight layout shifts"

**Example tool call — single comparison:**
```json
{
  "tool": "percy_trigger_ai_recompute",
  "params": {
    "comparison_id": "55001",
    "prompt": "Highlight any layout shifts or element repositioning",
    "mode": "unignore"
  }
}
```

**Example output — single comparison:**
```
## AI Recompute Triggered
**Comparison:** 55001
**Prompt:** "Highlight any layout shifts or element repositioning"
**Mode:** unignore
Recompute queued. Check results with percy_get_ai_analysis.
```

---

### `percy_suggest_prompt`

**Description:** Get an AI-generated prompt suggestion for specific diff regions. The AI analyzes the selected regions and suggests a prompt to ignore or highlight similar changes.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | Yes | Percy comparison ID |
| region_ids | string | Yes | Comma-separated region IDs to analyze |
| ignore_change | boolean | No | true = suggest ignore prompt, false = suggest show prompt (default true) |

**Example prompt:**
> "Suggest a prompt to ignore the font changes in comparison 55001"

**Example tool call:**
```json
{
  "tool": "percy_suggest_prompt",
  "params": {
    "comparison_id": "55001",
    "region_ids": "reg_001,reg_002",
    "ignore_change": true
  }
}
```

**Example output:**
```
## Suggested Prompt

Based on regions reg_001 and reg_002, here is a suggested ignore prompt:

"Ignore sub-pixel font rendering differences and text anti-aliasing
variations across browser versions"

Use this with percy_trigger_ai_recompute to apply.
```

---

## READ Tools (continued) — Diagnostics

### `percy_get_suggestions`

**Description:** Get Percy build failure suggestions — rule-engine-analyzed diagnostics with categorized issues, actionable fix steps, and documentation links.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |
| reference_type | string | No | Filter: build, snapshot, or comparison |
| reference_id | string | No | Specific snapshot or comparison ID |

**Example prompt:**
> "Why did build 12345 fail? Give me suggestions."

**Example tool call:**
```json
{
  "tool": "percy_get_suggestions",
  "params": {
    "build_id": "12345"
  }
}
```

**Example output:**
```
## Build Suggestions — Build #142

### Issue 1: Missing Resources (HIGH)
Category: resource_loading
3 snapshots have missing CSS resources that failed to load.

**Fix steps:**
1. Check that all CSS files are accessible from the Percy rendering environment
2. Ensure relative URLs are correct (Percy renders from a different origin)
3. Use percy_get_network_logs on affected comparisons to see specific failures

**Docs:** https://docs.percy.io/docs/debugging-missing-resources

### Issue 2: JavaScript Timeout (MEDIUM)
Category: rendering
2 snapshots timed out during JavaScript execution.

**Fix steps:**
1. Add `data-percy-loading` attributes to async-loaded content
2. Increase snapshot timeout if content loads slowly
3. Consider disabling JavaScript for static pages
```

---

### `percy_get_network_logs`

**Description:** Get parsed network request logs for a Percy comparison — shows per-URL status for base vs head, identifying which assets loaded, failed, or were cached.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | Yes | Percy comparison ID |

**Example prompt:**
> "Show me the network logs for comparison 55001"

**Example tool call:**
```json
{
  "tool": "percy_get_network_logs",
  "params": {
    "comparison_id": "55001"
  }
}
```

**Example output:**
```
## Network Logs — Comparison 55001

### Base Snapshot
| URL | Status | Size |
|-----|--------|------|
| /index.html | 200 | 12KB |
| /styles.css | 200 | 45KB |
| /app.js | 200 | 180KB |
| /images/hero.jpg | 200 | 320KB |

### Head Snapshot
| URL | Status | Size |
|-----|--------|------|
| /index.html | 200 | 13KB |
| /styles.css | 200 | 48KB |
| /app.js | 200 | 185KB |
| /images/hero-new.jpg | 404 | — |

### Differences
- /images/hero-new.jpg: FAILED (404) in head — missing resource
```

---

### `percy_get_build_logs`

**Description:** Download and filter Percy build logs (CLI, renderer, jackproxy). Shows raw log output for debugging rendering and asset issues.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |
| service | string | No | Filter by service: cli, renderer, jackproxy |
| reference_type | string | No | Reference scope: build, snapshot, comparison |
| reference_id | string | No | Specific snapshot or comparison ID |
| level | string | No | Filter by log level: error, warn, info, debug |

**Example prompt:**
> "Show me renderer error logs for build 12345"

**Example tool call:**
```json
{
  "tool": "percy_get_build_logs",
  "params": {
    "build_id": "12345",
    "service": "renderer",
    "level": "error"
  }
}
```

**Example output:**
```
## Build Logs — Build #142 (renderer/error)

[2024-01-15 10:31:42] ERROR renderer: Failed to load resource https://example.com/fonts/custom.woff2
  Status: 404 | Snapshot: Homepage — Desktop
[2024-01-15 10:31:43] ERROR renderer: JavaScript execution timeout after 30000ms
  Snapshot: Dashboard — Desktop
[2024-01-15 10:31:45] ERROR renderer: DOM snapshot exceeded 25MB limit
  Snapshot: Reports — Full Page
```

---

### `percy_analyze_logs_realtime`

**Description:** Analyze raw log data in real-time without a stored build. Pass CLI logs as JSON and get instant diagnostics with fix suggestions.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| logs | string | Yes | JSON array of log entries: `[{"message":"...","level":"error","meta":{}}]` |

**Example prompt:**
> "Analyze these Percy CLI logs and tell me what went wrong"

**Example tool call:**
```json
{
  "tool": "percy_analyze_logs_realtime",
  "params": {
    "logs": "[{\"message\":\"Snapshot command failed: page crashed\",\"level\":\"error\",\"meta\":{\"snapshot\":\"Homepage\"}},{\"message\":\"Asset discovery took 45000ms\",\"level\":\"warn\",\"meta\":{\"url\":\"https://example.com\"}}]"
  }
}
```

**Example output:**
```
## Real-Time Log Analysis

### Findings

1. **Page Crash** (CRITICAL)
   Log: "Snapshot command failed: page crashed"
   Snapshot: Homepage
   **Fix:** This usually indicates the page uses too much memory. Reduce DOM size
   or disable JavaScript with `enable_javascript: false`.

2. **Slow Asset Discovery** (WARNING)
   Log: "Asset discovery took 45000ms"
   URL: https://example.com
   **Fix:** Large pages slow down asset discovery. Use `discovery.networkIdleTimeout`
   to adjust, or add `data-percy-css` to inline critical styles.
```

---

## WORKFLOW Tools

These tools combine multiple API calls into high-level workflows.

### `percy_pr_visual_report`

**Description:** Get a complete visual regression report for a PR. Finds the Percy build by branch/SHA, ranks snapshots by risk, shows AI analysis, and recommends actions. The single best tool for checking visual status.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | No | Percy project ID (optional if PERCY_TOKEN is project-scoped) |
| branch | string | No | Git branch name to find the build |
| sha | string | No | Git commit SHA to find the build |
| build_id | string | No | Direct Percy build ID (skips search) |

> Note: Provide `branch`, `sha`, or `build_id` to identify the build.

**Example prompt:**
> "What's the visual status of my PR on branch feature-login?"

**Example tool call:**
```json
{
  "tool": "percy_pr_visual_report",
  "params": {
    "branch": "feature-login"
  }
}
```

**Example output:**
```
## Visual Regression Report — feature-login

**Build:** #143 (ID: 67890) | **State:** finished | **Review:** unreviewed
**Branch:** feature-login | **SHA:** abc123def456 | **PR:** #42

### Risk Summary
- CRITICAL: 1 snapshot
- REVIEW NEEDED: 2 snapshots
- AUTO-APPROVED: 5 snapshots
- NOISE: 0 snapshots

### Critical Changes (action required)
1. **Checkout — Mobile** (snapshot: 99002)
   Diff: 8% | AI: potential_bug
   "Submit button repositioned — may affect tap target"

### Review Needed
2. **Homepage — Desktop** (snapshot: 99001)
   Diff: 42% | AI: intentional_change
   "Hero banner replaced with new campaign image"

3. **Settings Page** (snapshot: 99003)
   Diff: 0.3% | AI: review_needed
   "Minor spacing change in form layout"

### Recommendation
Review the checkout mobile snapshot — the button repositioning may be a bug.
The homepage change appears intentional. Consider approving after verifying
the checkout fix.
```

---

### `percy_auto_triage`

**Description:** Automatically categorize all visual changes in a Percy build into Critical (bugs), Review Required, Auto-Approvable, and Noise. Helps prioritize visual review.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |
| noise_threshold | number | No | Diff ratio below this is noise (default 0.005 = 0.5%) |
| review_threshold | number | No | Diff ratio above this needs review (default 0.15 = 15%) |

**Example prompt:**
> "Categorize and triage the changes in build 12345"

**Example tool call:**
```json
{
  "tool": "percy_auto_triage",
  "params": {
    "build_id": "12345",
    "noise_threshold": 0.01,
    "review_threshold": 0.10
  }
}
```

**Example output:**
```
## Auto-Triage — Build #142

### Critical (1) — AI flagged as potential bugs
- **Checkout — Mobile** (snapshot: 99002) — 8% diff
  "Submit button repositioned outside expected bounds"

### Review Required (1) — High diff ratio
- **Homepage — Desktop** (snapshot: 99001) — 42% diff
  "Large visual change — hero section redesign"

### Auto-Approvable (1) — Low diff, AI-approved
- **Settings Page** (snapshot: 99003) — 0.3% diff
  "Minor spacing adjustment"

### Noise (0) — Below threshold

### Recommendation
1 critical issue needs attention. 1 snapshot can be auto-approved.
```

---

### `percy_debug_failed_build`

**Description:** Diagnose a Percy build failure. Cross-references error buckets, log analysis, failed snapshots, and network logs to provide actionable fix commands.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | Yes | Percy build ID |

**Example prompt:**
> "Why did Percy build 12345 fail?"

**Example tool call:**
```json
{
  "tool": "percy_debug_failed_build",
  "params": {
    "build_id": "12345"
  }
}
```

**Example output:**
```
## Build Failure Diagnosis — Build #142

**State:** failed | **Error:** render_timeout
**Failed snapshots:** 3 of 45

### Root Causes

1. **JavaScript Timeout** (3 snapshots)
   Snapshots: Dashboard, Reports — Full Page, Analytics
   The page JavaScript did not reach idle state within 30s.

   **Fix:**
   ```
   await percySnapshot('Dashboard', {
     enableJavaScript: true,
     discovery: { networkIdleTimeout: 500 }
   });
   ```

2. **Oversized DOM** (1 snapshot)
   Snapshot: Reports — Full Page
   DOM snapshot is 28MB (limit: 25MB).

   **Fix:** Paginate or lazy-load table rows. Use `domTransformation`
   to remove non-visible content before snapshotting.

### Network Issues
- /api/dashboard/data: Timeout (base OK, head failed)
- /api/reports/export: 500 Internal Server Error

### Suggested Next Steps
1. Fix JavaScript timeouts with explicit wait conditions
2. Reduce DOM size for Reports page
3. Mock or stub flaky API endpoints
```

---

### `percy_diff_explain`

**Description:** Explain visual changes in plain English. Supports depth levels: summary (AI descriptions), detailed (+ coordinates), full_rca (+ DOM/CSS changes with XPath).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | Yes | Percy comparison ID |
| depth | enum | No | Analysis depth: `summary`, `detailed`, `full_rca` (default: detailed) |

**Example prompt — summary:**
> "Give me a quick summary of what changed in comparison 55001"

**Example tool call — summary:**
```json
{
  "tool": "percy_diff_explain",
  "params": {
    "comparison_id": "55001",
    "depth": "summary"
  }
}
```

**Example output — summary:**
```
## Diff Explanation — Comparison 55001 (summary)

**Snapshot:** Homepage — Desktop | **Browser:** Chrome @ 1280px
**Diff ratio:** 42%

### Changes
1. Hero banner image replaced with new campaign creative
2. Navigation bar background color slightly darker
```

**Example prompt — full RCA:**
> "Explain the visual diff in comparison 55001 with full root cause analysis"

**Example tool call — full RCA:**
```json
{
  "tool": "percy_diff_explain",
  "params": {
    "comparison_id": "55001",
    "depth": "full_rca"
  }
}
```

**Example output — full RCA:**
```
## Diff Explanation — Comparison 55001 (full_rca)

**Snapshot:** Homepage — Desktop | **Browser:** Chrome @ 1280px
**Diff ratio:** 42%

### Change 1: Hero Banner Replacement
**Region:** (120, 340) to (520, 540)
**AI classification:** intentional_change
**Description:** Hero banner image replaced with new campaign creative

**DOM Changes:**
- /html/body/main/section[1]/img
  src: /images/campaign-old.jpg -> /images/campaign-new.jpg
  height: 400px -> 450px

### Change 2: Navigation Color Shift
**Region:** (0, 0) to (1280, 60)
**AI classification:** potential_bug
**Description:** Navigation bar background color slightly darker

**DOM Changes:**
- /html/body/nav/div[1]
  style.background-color: #333333 -> #444444
```

---

## UPDATE Tools (continued) — Project Management

### `percy_manage_project_settings`

**Description:** View or update Percy project settings including diff sensitivity, auto-approve branches, IntelliIgnore, and AI enablement. High-risk changes require confirmation.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | Yes | Percy project ID |
| settings | string | No | JSON string of attributes to update, e.g. `'{"diff-sensitivity":0.1,"auto-approve-branch-filter":"main"}'` |
| confirm_destructive | boolean | No | Set to true to confirm high-risk changes (auto-approve/approval-required branch filters) |

**Example prompt — view settings:**
> "Show me the settings for project 12345"

**Example tool call — view settings:**
```json
{
  "tool": "percy_manage_project_settings",
  "params": {
    "project_id": "12345"
  }
}
```

**Example output — view settings:**
```
## Project Settings — my-web-app (12345)

| Setting | Value |
|---------|-------|
| Diff sensitivity | 0.02 |
| Auto-approve branch filter | (none) |
| Approval-required branch filter | main |
| IntelliIgnore enabled | true |
| AI review enabled | true |
| Default widths | 375, 768, 1280 |
```

**Example prompt — update settings:**
> "Enable auto-approve for the develop branch on project 12345"

**Example tool call — update settings:**
```json
{
  "tool": "percy_manage_project_settings",
  "params": {
    "project_id": "12345",
    "settings": "{\"auto-approve-branch-filter\":\"develop\"}",
    "confirm_destructive": true
  }
}
```

**Example output — update settings:**
```
## Project Settings Updated — my-web-app (12345)

Changed:
- Auto-approve branch filter: (none) -> develop

WARNING: Builds on the "develop" branch will now be auto-approved.
```

---

### `percy_manage_browser_targets`

**Description:** List, add, or remove browser targets for a Percy project (Chrome, Firefox, Safari, Edge).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | Yes | Percy project ID |
| action | enum | No | Action to perform: `list`, `add`, `remove` (default: list) |
| browser_family | string | No | Browser family ID to add or project-browser-target ID to remove |

**Example prompt — list browsers:**
> "What browsers are configured for project 12345?"

**Example tool call — list:**
```json
{
  "tool": "percy_manage_browser_targets",
  "params": {
    "project_id": "12345",
    "action": "list"
  }
}
```

**Example output — list:**
```
## Browser Targets — my-web-app (12345)

| Browser | Family ID | Target ID |
|---------|-----------|-----------|
| Chrome | chrome | bt_001 |
| Firefox | firefox | bt_002 |

Available to add: Safari (safari), Edge (edge)
```

**Example prompt — add browser:**
> "Add Safari to project 12345"

**Example tool call — add:**
```json
{
  "tool": "percy_manage_browser_targets",
  "params": {
    "project_id": "12345",
    "action": "add",
    "browser_family": "safari"
  }
}
```

**Example output — add:**
```
## Browser Target Added
Safari added to my-web-app (12345).
New target ID: bt_003
```

**Example prompt — remove browser:**
> "Remove Firefox from project 12345"

**Example tool call — remove:**
```json
{
  "tool": "percy_manage_browser_targets",
  "params": {
    "project_id": "12345",
    "action": "remove",
    "browser_family": "bt_002"
  }
}
```

**Example output — remove:**
```
## Browser Target Removed
Firefox (bt_002) removed from my-web-app (12345).
```

---

### `percy_manage_tokens`

**Description:** List or rotate Percy project tokens. Token values are masked for security — only last 4 characters shown.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | Yes | Percy project ID |
| action | enum | No | Action to perform: `list`, `rotate` (default: list) |
| role | string | No | Token role for rotation (e.g., 'write', 'read') |

**Example prompt — list tokens:**
> "Show me the tokens for project 12345"

**Example tool call — list:**
```json
{
  "tool": "percy_manage_tokens",
  "params": {
    "project_id": "12345",
    "action": "list"
  }
}
```

**Example output — list:**
```
## Project Tokens — my-web-app (12345)

| Role | Token (masked) | Created |
|------|----------------|---------|
| write | ****a1b2 | 2024-01-01 |
| read | ****c3d4 | 2024-01-01 |
| full_access | ****e5f6 | 2024-01-01 |
```

**Example prompt — rotate token:**
> "Rotate the write token for project 12345"

**Example tool call — rotate:**
```json
{
  "tool": "percy_manage_tokens",
  "params": {
    "project_id": "12345",
    "action": "rotate",
    "role": "write"
  }
}
```

**Example output — rotate:**
```
## Token Rotated — my-web-app (12345)
Role: write
New token (masked): ****x7y8
Old token has been invalidated. Update your CI environment variables.
```

---

### `percy_manage_webhooks`

**Description:** Create, update, list, or delete webhooks for Percy build events.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | Yes | Percy project ID |
| action | enum | No | Action to perform: `list`, `create`, `update`, `delete` (default: list) |
| webhook_id | string | No | Webhook ID (required for update/delete) |
| url | string | No | Webhook URL (required for create) |
| events | string | No | Comma-separated event types, e.g. 'build:finished,build:failed' |
| description | string | No | Human-readable webhook description |

**Example prompt — list webhooks:**
> "Show me all webhooks for project 12345"

**Example tool call — list:**
```json
{
  "tool": "percy_manage_webhooks",
  "params": {
    "project_id": "12345",
    "action": "list"
  }
}
```

**Example output — list:**
```
## Webhooks — my-web-app (12345)

1. **Slack Notifications** (ID: wh_001)
   URL: https://hooks.slack.com/services/...
   Events: build:finished, build:failed
   Status: active

2. **CI Pipeline** (ID: wh_002)
   URL: https://ci.example.com/percy-webhook
   Events: build:finished
   Status: active
```

**Example prompt — create webhook:**
> "Create a webhook for build failures on project 12345"

**Example tool call — create:**
```json
{
  "tool": "percy_manage_webhooks",
  "params": {
    "project_id": "12345",
    "action": "create",
    "url": "https://hooks.slack.com/services/T00/B00/xxx",
    "events": "build:failed",
    "description": "Slack alert on build failure"
  }
}
```

**Example output — create:**
```
## Webhook Created
**ID:** wh_003
**URL:** https://hooks.slack.com/services/T00/B00/xxx
**Events:** build:failed
**Description:** Slack alert on build failure
```

**Example prompt — delete webhook:**
> "Delete webhook wh_002 from project 12345"

**Example tool call — delete:**
```json
{
  "tool": "percy_manage_webhooks",
  "params": {
    "project_id": "12345",
    "action": "delete",
    "webhook_id": "wh_002"
  }
}
```

**Example output — delete:**
```
## Webhook Deleted
Webhook wh_002 (CI Pipeline) has been removed.
```

---

### `percy_manage_ignored_regions`

**Description:** Create, list, save, or delete ignored regions on Percy comparisons. Supports bounding box, XPath, CSS selector, and fullpage types.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | No | Percy comparison ID (required for list/create) |
| action | enum | No | Action to perform: `list`, `create`, `save`, `delete` (default: list) |
| region_id | string | No | Region revision ID (required for delete) |
| type | string | No | Region type: raw, xpath, css, full_page |
| coordinates | string | No | JSON bounding box for raw type: `{"x":0,"y":0,"width":100,"height":100}` |
| selector | string | No | XPath or CSS selector string |

**Example prompt — list ignored regions:**
> "Show me ignored regions for comparison 55001"

**Example tool call — list:**
```json
{
  "tool": "percy_manage_ignored_regions",
  "params": {
    "comparison_id": "55001",
    "action": "list"
  }
}
```

**Example output — list:**
```
## Ignored Regions — Comparison 55001

1. **Dynamic banner** (ID: ir_001)
   Type: raw
   Coordinates: (0, 0, 1280, 100)

2. **Timestamp** (ID: ir_002)
   Type: css
   Selector: .footer-timestamp
```

**Example prompt — create bounding box region:**
> "Ignore the ad banner area at the top of comparison 55001"

**Example tool call — create raw region:**
```json
{
  "tool": "percy_manage_ignored_regions",
  "params": {
    "comparison_id": "55001",
    "action": "create",
    "type": "raw",
    "coordinates": "{\"x\":0,\"y\":0,\"width\":1280,\"height\":90}"
  }
}
```

**Example output — create raw region:**
```
## Ignored Region Created
**ID:** ir_003
**Type:** raw
**Coordinates:** (0, 0, 1280, 90)
This region will be excluded from future diff calculations.
```

**Example prompt — create CSS selector region:**
> "Ignore the dynamic timestamp element in comparison 55001"

**Example tool call — create CSS region:**
```json
{
  "tool": "percy_manage_ignored_regions",
  "params": {
    "comparison_id": "55001",
    "action": "create",
    "type": "css",
    "selector": ".dynamic-timestamp"
  }
}
```

**Example output — create CSS region:**
```
## Ignored Region Created
**ID:** ir_004
**Type:** css
**Selector:** .dynamic-timestamp
This region will be excluded from future diff calculations.
```

**Example prompt — delete region:**
> "Remove ignored region ir_001"

**Example tool call — delete:**
```json
{
  "tool": "percy_manage_ignored_regions",
  "params": {
    "action": "delete",
    "region_id": "ir_001"
  }
}
```

**Example output — delete:**
```
## Ignored Region Deleted
Region ir_001 has been removed. This area will be included in future diff calculations.
```

---

### `percy_manage_comments`

**Description:** List, create, or close comment threads on Percy snapshots.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| build_id | string | No | Percy build ID (required for list) |
| snapshot_id | string | No | Percy snapshot ID (required for create) |
| action | enum | No | Action to perform: `list`, `create`, `close` (default: list) |
| thread_id | string | No | Comment thread ID (required for close) |
| body | string | No | Comment body text (required for create) |

**Example prompt — list comments:**
> "Show me all comments on build 12345"

**Example tool call — list:**
```json
{
  "tool": "percy_manage_comments",
  "params": {
    "build_id": "12345",
    "action": "list"
  }
}
```

**Example output — list:**
```
## Comments — Build #142

1. **Thread on Homepage — Desktop** (thread: ct_001)
   Author: jane@example.com | Status: open
   "The hero image looks stretched on wide viewports"
   Replies: 2

2. **Thread on Checkout — Mobile** (thread: ct_002)
   Author: john@example.com | Status: open
   "Button alignment looks off — is this intentional?"
   Replies: 0
```

**Example prompt — create comment:**
> "Add a comment on snapshot 99001 about the color change"

**Example tool call — create:**
```json
{
  "tool": "percy_manage_comments",
  "params": {
    "snapshot_id": "99001",
    "action": "create",
    "body": "The navigation bar color change from #333 to #444 looks unintentional. Please verify this is correct."
  }
}
```

**Example output — create:**
```
## Comment Created
**Thread ID:** ct_003
**Snapshot:** Homepage — Desktop (99001)
**Body:** The navigation bar color change from #333 to #444 looks unintentional. Please verify this is correct.
```

**Example prompt — close thread:**
> "Close comment thread ct_001"

**Example tool call — close:**
```json
{
  "tool": "percy_manage_comments",
  "params": {
    "action": "close",
    "thread_id": "ct_001"
  }
}
```

**Example output — close:**
```
## Comment Thread Closed
Thread ct_001 on Homepage — Desktop has been resolved.
```

---

### `percy_get_usage_stats`

**Description:** Get Percy screenshot usage, quota limits, and AI comparison counts for an organization.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| org_id | string | Yes | Percy organization ID |
| product | string | No | Filter by product type (e.g., 'percy', 'app_percy') |

**Example prompt:**
> "How many Percy screenshots has our org used this month?"

**Example tool call:**
```json
{
  "tool": "percy_get_usage_stats",
  "params": {
    "org_id": "org_001",
    "product": "percy"
  }
}
```

**Example output:**
```
## Usage Stats — My Organization

### Screenshot Usage
- Used: 12,450 / 50,000
- Remaining: 37,550
- Usage: 24.9%

### AI Comparisons
- AI-analyzed: 8,200
- Auto-approved: 6,150 (75%)
- Flagged: 2,050

### Billing Period
- Start: 2024-01-01
- End: 2024-01-31
- Days remaining: 16
```

---

## UPDATE Tools (continued) — Advanced

### `percy_manage_visual_monitoring`

**Description:** Create, update, or list Visual Monitoring projects with URL lists, cron schedules, and auth configuration.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| org_id | string | No | Percy organization ID (required for list/create) |
| project_id | string | No | Visual Monitoring project ID (required for update) |
| action | enum | No | Action to perform: `list`, `create`, `update` (default: list) |
| urls | string | No | Comma-separated URLs to monitor, e.g. 'https://example.com,https://example.com/about' |
| cron | string | No | Cron expression for monitoring schedule, e.g. '0 */6 * * *' |
| schedule | boolean | No | Enable or disable the monitoring schedule |

**Example prompt — list monitoring projects:**
> "Show me all visual monitoring projects"

**Example tool call — list:**
```json
{
  "tool": "percy_manage_visual_monitoring",
  "params": {
    "org_id": "org_001",
    "action": "list"
  }
}
```

**Example output — list:**
```
## Visual Monitoring Projects

1. **Production Monitor** (ID: vm_001)
   URLs: https://example.com, https://example.com/pricing
   Schedule: Every 6 hours (0 */6 * * *)
   Status: active

2. **Staging Check** (ID: vm_002)
   URLs: https://staging.example.com
   Schedule: Daily at midnight (0 0 * * *)
   Status: paused
```

**Example prompt — create monitoring project:**
> "Set up visual monitoring for our homepage and pricing page every 6 hours"

**Example tool call — create:**
```json
{
  "tool": "percy_manage_visual_monitoring",
  "params": {
    "org_id": "org_001",
    "action": "create",
    "urls": "https://example.com,https://example.com/pricing",
    "cron": "0 */6 * * *",
    "schedule": true
  }
}
```

**Example output — create:**
```
## Visual Monitoring Project Created
**ID:** vm_003
**URLs:** https://example.com, https://example.com/pricing
**Schedule:** 0 */6 * * * (every 6 hours)
**Status:** active
First run will start within the next scheduled window.
```

**Example prompt — pause monitoring:**
> "Pause the visual monitoring for project vm_001"

**Example tool call — update:**
```json
{
  "tool": "percy_manage_visual_monitoring",
  "params": {
    "project_id": "vm_001",
    "action": "update",
    "schedule": false
  }
}
```

**Example output — update:**
```
## Visual Monitoring Updated
**Project:** vm_001
Schedule: disabled (paused)
```

---

### `percy_branchline_operations`

**Description:** Sync, merge, or unmerge Percy branch baselines. Sync copies approved baselines to target branches.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action | enum | Yes | Branchline operation to perform: `sync`, `merge`, `unmerge` |
| project_id | string | No | Percy project ID |
| build_id | string | No | Percy build ID |
| target_branch_filter | string | No | Target branch pattern for sync (e.g., 'main', 'release/*') |
| snapshot_ids | string | No | Comma-separated snapshot IDs to include |

**Example prompt — sync baselines:**
> "Sync approved baselines from build 12345 to the main branch"

**Example tool call — sync:**
```json
{
  "tool": "percy_branchline_operations",
  "params": {
    "action": "sync",
    "build_id": "12345",
    "target_branch_filter": "main"
  }
}
```

**Example output — sync:**
```
## Branchline Sync
**Build:** #142 (12345)
**Target:** main
**Snapshots synced:** 45

Approved baselines from build #142 have been copied to the main branch baseline.
```

**Example prompt — merge baselines:**
> "Merge baselines from build 12345"

**Example tool call — merge:**
```json
{
  "tool": "percy_branchline_operations",
  "params": {
    "action": "merge",
    "build_id": "12345"
  }
}
```

**Example output — merge:**
```
## Branchline Merge
**Build:** #142 (12345)
Baselines merged successfully. Future builds on this branch will use the
merged baseline as the comparison base.
```

**Example prompt — unmerge baselines:**
> "Unmerge baselines for build 12345"

**Example tool call — unmerge:**
```json
{
  "tool": "percy_branchline_operations",
  "params": {
    "action": "unmerge",
    "build_id": "12345"
  }
}
```

**Example output — unmerge:**
```
## Branchline Unmerge
**Build:** #142 (12345)
Baselines unmerged. The branch will revert to its previous baseline state.
```

---

### `percy_manage_variants`

**Description:** List, create, or update A/B testing variants for Percy snapshot comparisons.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| comparison_id | string | No | Percy comparison ID (required for list) |
| snapshot_id | string | No | Percy snapshot ID (required for create) |
| action | enum | No | Action to perform: `list`, `create`, `update` (default: list) |
| variant_id | string | No | Variant ID (required for update) |
| name | string | No | Variant name (required for create) |
| state | string | No | Variant state (for update) |

**Example prompt — list variants:**
> "Show me variants for comparison 55001"

**Example tool call — list:**
```json
{
  "tool": "percy_manage_variants",
  "params": {
    "comparison_id": "55001",
    "action": "list"
  }
}
```

**Example output — list:**
```
## Variants — Comparison 55001

1. **Variant A — Control** (ID: var_001)
   State: active

2. **Variant B — New CTA** (ID: var_002)
   State: active
```

**Example prompt — create variant:**
> "Create a variant called 'Dark Mode' for snapshot 99001"

**Example tool call — create:**
```json
{
  "tool": "percy_manage_variants",
  "params": {
    "snapshot_id": "99001",
    "action": "create",
    "name": "Dark Mode"
  }
}
```

**Example output — create:**
```
## Variant Created
**ID:** var_003
**Name:** Dark Mode
**Snapshot:** Homepage — Desktop (99001)
**State:** active
```

**Example prompt — update variant:**
> "Deactivate variant var_002"

**Example tool call — update:**
```json
{
  "tool": "percy_manage_variants",
  "params": {
    "action": "update",
    "variant_id": "var_002",
    "state": "inactive"
  }
}
```

**Example output — update:**
```
## Variant Updated
**ID:** var_002
**Name:** Variant B — New CTA
**State:** inactive
```

---

## Quick Reference — Common Prompts

| What you want to do | Say this | Tool called |
|---------------------|----------|-------------|
| **Create a build (recommended)** | "Create a Percy build for my-app snapshotting localhost:3000" | `percy_create_percy_build` |
| **Check PR visual status** | "What's the visual status of my PR on branch feature-x?" | `percy_pr_visual_report` |
| Create a project | "Create a Percy project called my-web-app" | `percy_create_project` |
| Check auth setup | "Check my Percy authentication" | `percy_auth_status` |
| List projects | "Show me my Percy projects" | `percy_list_projects` |
| List builds | "Show recent builds for project 12345" | `percy_list_builds` |
| Get build details | "Show me build 12345" | `percy_get_build` |
| List snapshots | "Show changed snapshots in build 12345" | `percy_get_build_items` |
| Get snapshot details | "Get details for snapshot 99001" | `percy_get_snapshot` |
| Get comparison details | "Show comparison 55001 with images" | `percy_get_comparison` |
| Triage all changes | "Categorize changes in build 12345" | `percy_auto_triage` |
| Approve a build | "Approve Percy build 12345" | `percy_approve_build` |
| Request changes | "Request changes on snapshot 99001 in build 12345" | `percy_approve_build` |
| Reject a build | "Reject build 12345 because of layout bugs" | `percy_approve_build` |
| Debug a failure | "Why did Percy build 12345 fail?" | `percy_debug_failed_build` |
| Explain a diff | "What changed in comparison 55001?" | `percy_diff_explain` |
| Get AI analysis | "Show AI analysis for build 12345" | `percy_get_ai_analysis` |
| Get build summary | "Summarize visual changes in build 12345" | `percy_get_build_summary` |
| Check AI quota | "How many AI regenerations do I have left?" | `percy_get_ai_quota` |
| Find root cause | "What DOM changes caused the diff in comparison 55001?" | `percy_get_rca` |
| Re-run AI with prompt | "Re-analyze build 12345, ignore font diffs" | `percy_trigger_ai_recompute` |
| Get prompt suggestion | "Suggest a prompt for regions in comparison 55001" | `percy_suggest_prompt` |
| View failure suggestions | "Give me fix suggestions for build 12345" | `percy_get_suggestions` |
| Check network logs | "Show network logs for comparison 55001" | `percy_get_network_logs` |
| View build logs | "Show renderer error logs for build 12345" | `percy_get_build_logs` |
| Analyze CLI logs | "Analyze these Percy logs" | `percy_analyze_logs_realtime` |
| Create a build (low-level) | "Create an empty Percy build for project 12345" | `percy_create_build` |
| Create a snapshot | "Create a snapshot called Homepage in build 67890" | `percy_create_snapshot` |
| Upload a resource | "Upload the missing CSS to build 67890" | `percy_upload_resource` |
| Finalize a snapshot | "Finalize snapshot 99010" | `percy_finalize_snapshot` |
| Finalize a build | "Finalize build 67890" | `percy_finalize_build` |
| Create app snapshot | "Create an app snapshot for Login Screen" | `percy_create_app_snapshot` |
| Create comparison | "Create an iPhone 13 comparison" | `percy_create_comparison` |
| Upload screenshot tile | "Upload the screenshot for comparison 55010" | `percy_upload_tile` |
| Finalize comparison | "Finalize comparison 55010" | `percy_finalize_comparison` |
| View project settings | "Show settings for project 12345" | `percy_manage_project_settings` |
| Update diff sensitivity | "Set diff sensitivity to 0.05 for project 12345" | `percy_manage_project_settings` |
| List browser targets | "What browsers are configured for project 12345?" | `percy_manage_browser_targets` |
| Add browser | "Add Firefox to project 12345" | `percy_manage_browser_targets` |
| List tokens | "Show tokens for project 12345" | `percy_manage_tokens` |
| Rotate token | "Rotate the write token for project 12345" | `percy_manage_tokens` |
| Manage webhooks | "Create a webhook for build failures" | `percy_manage_webhooks` |
| Ignore a region | "Ignore the ad banner in comparison 55001" | `percy_manage_ignored_regions` |
| Add a comment | "Comment on snapshot 99001 about the color change" | `percy_manage_comments` |
| Check usage | "How many screenshots have we used this month?" | `percy_get_usage_stats` |
| Set up monitoring | "Monitor our homepage every 6 hours" | `percy_manage_visual_monitoring` |
| Sync baselines | "Sync baselines from build 12345 to main" | `percy_branchline_operations` |
| Manage A/B variants | "Create a Dark Mode variant for snapshot 99001" | `percy_manage_variants` |
