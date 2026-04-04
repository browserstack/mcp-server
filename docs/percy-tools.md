# Percy MCP Tools Documentation

> 27 visual testing tools for AI agents, built into `@browserstack/mcp-server`

Percy MCP tools give AI agents full programmatic access to Percy visual testing -- querying builds and snapshots, creating builds with screenshots, running AI-powered analysis, diagnosing failures, and approving changes. All tools return structured markdown suitable for LLM consumption.

---

## Quick Start

### Configuration

Add to your MCP config (`.mcp.json`, Claude Code settings, or Cursor MCP config):

```json
{
  "mcpServers": {
    "browserstack": {
      "command": "node",
      "args": ["path/to/mcp-server/dist/index.js"],
      "env": {
        "BROWSERSTACK_USERNAME": "your-username",
        "BROWSERSTACK_ACCESS_KEY": "your-access-key",
        "PERCY_TOKEN": "your-percy-project-token",
        "PERCY_ORG_TOKEN": "your-percy-org-token"
      }
    }
  }
}
```

### Authentication

Percy tools support three authentication paths, resolved in priority order:

1. **`PERCY_TOKEN`** (project-scoped) -- Full-access token tied to a specific Percy project. Required for build creation, snapshot uploads, and all project-level operations. Set this for most use cases.

2. **`PERCY_ORG_TOKEN`** (org-scoped) -- Token scoped to your Percy organization. Used for cross-project operations like `percy_list_projects`. Falls back as secondary for project operations when `PERCY_TOKEN` is not set.

3. **BrowserStack credentials fallback** -- If neither Percy token is set, the server attempts to fetch a token automatically via the BrowserStack API using `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY`.

**Token precedence by operation type:**
- Project operations (builds, snapshots, comparisons) --> `PERCY_TOKEN` > `PERCY_ORG_TOKEN` > BrowserStack fallback
- Org operations (list projects) --> `PERCY_ORG_TOKEN` > `PERCY_TOKEN` > BrowserStack fallback
- Auto scope --> `PERCY_TOKEN` > `PERCY_ORG_TOKEN` > BrowserStack fallback

Use `percy_auth_status` to verify which tokens are configured and valid.

---

## Tool Reference

### Core Query Tools

These tools read data from existing Percy builds, snapshots, and comparisons.

---

#### `percy_list_projects`

List Percy projects in an organization. Returns project names, types, and settings.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `org_id` | string | No | Percy organization ID. If not provided, uses token scope. |
| `search` | string | No | Filter projects by name (substring match). |
| `limit` | number | No | Max results (default 10, max 50). |

**Returns:** Markdown table with columns: #, Name, ID, Type, Default Branch.

**Example prompt:** "List all Percy projects that contain 'dashboard' in their name"

**Example output:**
```
## Percy Projects (3)

| # | Name | ID | Type | Default Branch |
|---|------|----|------|----------------|
| 1 | dashboard-web | 12345 | web | main |
| 2 | dashboard-mobile | 12346 | app | develop |
| 3 | dashboard-components | 12347 | web | main |
```

---

#### `percy_list_builds`

List Percy builds for a project with filtering by branch, state, or commit SHA. Returns build numbers, states, review status, and AI metrics.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | No | Percy project ID. If not provided, uses `PERCY_TOKEN` scope. |
| `branch` | string | No | Filter by branch name. |
| `state` | string | No | Filter by state: `pending`, `processing`, `finished`, `failed`. |
| `sha` | string | No | Filter by commit SHA. |
| `limit` | number | No | Max results (default 10, max 30). |

**Returns:** Markdown list of builds with formatted status lines (build number, state, branch, commit, review status).

**Example prompt:** "Show me the last 5 Percy builds on the main branch"

**Example output:**
```
## Percy Builds (5)

- Build #142 finished (approved) on main @ abc1234 (ID: 98765)
- Build #141 finished (changes_requested) on main @ def5678 (ID: 98764)
- Build #140 finished (approved) on main @ ghi9012 (ID: 98763)
- Build #139 failed on main @ jkl3456 (ID: 98762)
- Build #138 finished (approved) on main @ mno7890 (ID: 98761)
```

---

#### `percy_get_build`

Get detailed Percy build information including state, review status, snapshot counts, AI analysis metrics, and build summary.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |

**Returns:** Formatted build details including: build number, state, branch, commit SHA, snapshot counts (total/changed/new/removed), review state, AI details (comparisons analyzed, potential bugs, diff reduction), and browser configuration.

**Example prompt:** "Get details for Percy build 98765"

**Example output:**
```
## Build #142

**State:** finished | **Review:** approved
**Branch:** main | **SHA:** abc1234def5678
**Snapshots:** 48 total | 3 changed | 1 new | 0 removed

### AI Details
- Comparisons analyzed: 52
- Potential bugs: 0
- AI jobs completed: yes
- Summary status: completed
```

---

#### `percy_get_build_items`

List snapshots in a Percy build filtered by category. Returns snapshot names with diff ratios and AI flags.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |
| `category` | string | No | Filter category: `changed`, `new`, `removed`, `unchanged`, `failed`. |
| `sort_by` | string | No | Sort field (e.g., `diff-ratio`, `name`). |
| `limit` | number | No | Max results (default 20, max 100). |

**Returns:** Markdown table with columns: #, Snapshot Name, ID, Diff, AI Diff, Status.

**Example prompt:** "Show me all changed snapshots in build 98765, sorted by diff ratio"

**Example output:**
```
## Build Snapshots (changed) -- 3 items

| # | Snapshot Name | ID | Diff | AI Diff | Status |
|---|---------------|----|----- |---------|--------|
| 1 | Login Page | 55001 | 12.3% | 8.1% | unreviewed |
| 2 | Settings Panel | 55002 | 3.4% | 0.0% | unreviewed |
| 3 | Header Nav | 55003 | 0.8% | 0.2% | unreviewed |
```

---

#### `percy_get_snapshot`

Get a Percy snapshot with all its comparisons, screenshots, and diff data across browsers and widths.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshot_id` | string | **Yes** | Percy snapshot ID. |

**Returns:** Formatted snapshot header (name, state, review status) followed by detailed comparison data for each browser/width combination, including diff ratios, AI analysis regions, and screenshot references.

**Example prompt:** "Show me snapshot 55001 with all its comparison details"

**Example output:**
```
## Snapshot: Login Page

**State:** finished | **Review:** unreviewed

---

### Comparison Details

#### Chrome 1280px
**Diff:** 12.3% | **AI Diff:** 8.1%
Regions:
1. **Button color change** (style) -- Primary button changed from blue to green
2. ~~Font rendering~~ (ignored by AI)

#### Firefox 1280px
**Diff:** 11.8% | **AI Diff:** 7.9%
...
```

---

#### `percy_get_comparison`

Get detailed Percy comparison data including diff ratios, AI analysis regions, screenshot URLs, and browser info.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comparison_id` | string | **Yes** | Percy comparison ID. |
| `include_images` | boolean | No | Include screenshot image URLs in response (default `false`). |

**Returns:** Formatted comparison with diff metrics, browser/width info, and AI regions. When `include_images` is `true`, also includes URLs for base, head, diff, and AI diff screenshots.

**Example prompt:** "Get comparison 77001 with image URLs"

**Example output:**
```
## Comparison #77001 -- Chrome @ 1280px

**Diff:** 12.3% | **AI Diff:** 8.1%
**State:** finished

### Regions (2)
1. **Button color change** (style)
   Primary CTA button changed from #2563eb to #16a34a
2. ~~Subpixel shift~~ (ignored by AI)

### Screenshot URLs
- **Base:** https://percy.io/api/v1/screenshots/...
- **Head:** https://percy.io/api/v1/screenshots/...
- **Diff:** https://percy.io/api/v1/screenshots/...
- **AI Diff:** https://percy.io/api/v1/screenshots/...
```

---

### Build Approval

---

#### `percy_approve_build`

Approve, request changes, unapprove, or reject a Percy build. Requires a user token (`PERCY_TOKEN`). The `request_changes` action works at snapshot level only.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID to review. |
| `action` | enum | **Yes** | Review action: `approve`, `request_changes`, `unapprove`, `reject`. |
| `snapshot_ids` | string | No | Comma-separated snapshot IDs (required for `request_changes`). |
| `reason` | string | No | Optional reason for the review action. |

**Returns:** Confirmation message with the resulting review state.

**Example prompt:** "Approve Percy build 98765"

**Example output:**
```
Build #98765 approve successful. Review state: approved
```

**Example prompt:** "Request changes on snapshots 55001,55002 in build 98765"

**Example output:**
```
Build #98765 request_changes successful. Review state: changes_requested
```

---

### Build Creation -- Web Flow

Web builds use a multi-step protocol where the agent provides DOM snapshots (HTML + CSS + JS resources) and Percy renders them in cloud browsers.

**Protocol:**
1. **`percy_create_build`** -- Create a build container, get `build_id`
2. **`percy_create_snapshot`** -- Add a snapshot with resource references, get `snapshot_id` + list of missing resources
3. **`percy_upload_resource`** -- Upload only the resources Percy doesn't already have (deduplicated by SHA-256)
4. **`percy_finalize_snapshot`** -- Signal that all resources are uploaded, triggering rendering
5. **`percy_finalize_build`** -- Signal that all snapshots are complete, triggering processing and diffing

```
create_build --> create_snapshot (x N) --> upload_resource (x M) --> finalize_snapshot (x N) --> finalize_build
```

---

#### `percy_create_build`

Create a new Percy build for visual testing. Returns the build ID for subsequent snapshot uploads.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | **Yes** | Percy project ID. |
| `branch` | string | **Yes** | Git branch name. |
| `commit_sha` | string | **Yes** | Git commit SHA. |
| `commit_message` | string | No | Git commit message. |
| `pull_request_number` | string | No | Pull request number. |
| `type` | string | No | Project type: `web`, `app`, `automate`, `generic`. |

**Returns:** Build ID and finalize URL.

**Example prompt:** "Create a Percy build for project 12345 on branch feature/login with commit abc123"

**Example output:**
```
Build #99001 created. Finalize URL: /builds/99001/finalize
```

---

#### `percy_create_snapshot`

Create a snapshot in a Percy build with DOM resources. Returns the snapshot ID and a list of missing resources that need uploading.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |
| `name` | string | **Yes** | Snapshot name. |
| `widths` | string | No | Comma-separated viewport widths, e.g., `'375,768,1280'`. |
| `enable_javascript` | boolean | No | Enable JavaScript execution during rendering. |
| `resources` | string | No | JSON array of resources: `[{"id":"sha256","resource-url":"/index.html","is-root":true}]`. |

**Returns:** Snapshot ID and count/SHAs of missing resources.

**Example prompt:** "Create a snapshot named 'Homepage' in build 99001 at widths 375, 1280"

**Example output:**
```
Snapshot 'Homepage' created (ID: 66001). Missing resources: 2. Upload them with percy_upload_resource. Missing SHAs: a1b2c3d4..., e5f6g7h8...
```

---

#### `percy_upload_resource`

Upload a resource (CSS, JS, image, HTML) to a Percy build. Only upload resources the server reports as missing after `percy_create_snapshot`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |
| `sha` | string | **Yes** | SHA-256 hash of the resource content. |
| `base64_content` | string | **Yes** | Base64-encoded resource content. |

**Returns:** Confirmation of successful upload.

**Example output:**
```
Resource a1b2c3d4... uploaded successfully.
```

---

#### `percy_finalize_snapshot`

Finalize a Percy snapshot after all resources are uploaded. Triggers rendering in Percy's cloud browsers.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshot_id` | string | **Yes** | Percy snapshot ID. |

**Returns:** Confirmation that rendering will begin.

**Example output:**
```
Snapshot 66001 finalized. Rendering will begin.
```

---

#### `percy_finalize_build`

Finalize a Percy build after all snapshots are complete. Triggers processing, diffing, and AI analysis.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |

**Returns:** Confirmation that processing will begin.

**Example output:**
```
Build 99001 finalized. Processing will begin.
```

---

### Build Creation -- App/BYOS Flow

App and Bring-Your-Own-Screenshots (BYOS) builds skip DOM rendering. Instead, the agent uploads pre-captured screenshot images (PNG or JPEG) with device/browser metadata.

**Protocol:**
1. **`percy_create_build`** -- Create a build container, get `build_id`
2. **`percy_create_app_snapshot`** -- Create a snapshot (no resources needed), get `snapshot_id`
3. **`percy_create_comparison`** -- Create a comparison with device tag and tile metadata, get `comparison_id`
4. **`percy_upload_tile`** -- Upload the screenshot PNG/JPEG
5. **`percy_finalize_comparison`** -- Signal tiles are uploaded, triggering diff processing
6. **`percy_finalize_build`** -- Signal all snapshots are complete

```
create_build --> create_app_snapshot (x N) --> create_comparison (x M) --> upload_tile (x M) --> finalize_comparison (x M) --> finalize_build
```

---

#### `percy_create_app_snapshot`

Create a snapshot for App Percy or BYOS builds. No resources needed -- screenshots are uploaded via comparisons/tiles.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |
| `name` | string | **Yes** | Snapshot name. |
| `test_case` | string | No | Test case name. |

**Returns:** Snapshot ID.

**Example output:**
```
App snapshot 'Login Screen' created (ID: 66002). Create comparisons with percy_create_comparison.
```

---

#### `percy_create_comparison`

Create a comparison with device/browser tag and tile metadata for screenshot-based builds.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshot_id` | string | **Yes** | Percy snapshot ID. |
| `tag_name` | string | **Yes** | Device/browser name, e.g., `'iPhone 13'`. |
| `tag_width` | number | **Yes** | Tag width in pixels. |
| `tag_height` | number | **Yes** | Tag height in pixels. |
| `tag_os_name` | string | No | OS name, e.g., `'iOS'`. |
| `tag_os_version` | string | No | OS version, e.g., `'16.0'`. |
| `tag_browser_name` | string | No | Browser name, e.g., `'Safari'`. |
| `tag_orientation` | string | No | `portrait` or `landscape`. |
| `tiles` | string | **Yes** | JSON array of tiles: `[{"sha":"abc123","status-bar-height":44,"nav-bar-height":34}]`. |

**Returns:** Comparison ID.

**Example output:**
```
Comparison created (ID: 77002). Upload tiles with percy_upload_tile.
```

---

#### `percy_upload_tile`

Upload a screenshot tile (PNG or JPEG) to a Percy comparison. Validates the image format (checks PNG/JPEG magic bytes).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comparison_id` | string | **Yes** | Percy comparison ID. |
| `base64_content` | string | **Yes** | Base64-encoded PNG or JPEG screenshot. |

**Returns:** Confirmation of successful upload.

**Example output:**
```
Tile uploaded to comparison 77002.
```

---

#### `percy_finalize_comparison`

Finalize a Percy comparison after all tiles are uploaded. Triggers diff processing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comparison_id` | string | **Yes** | Percy comparison ID. |

**Returns:** Confirmation that diff processing will begin.

**Example output:**
```
Comparison 77002 finalized. Diff processing will begin.
```

---

### AI Intelligence

These tools leverage Percy's AI-powered analysis to explain visual changes, detect bugs, and summarize builds.

---

#### `percy_get_ai_analysis`

Get Percy AI-powered visual diff analysis. Operates in two modes:

1. **Single comparison** (`comparison_id`) -- Returns AI regions with change types, descriptions, bug classifications, and diff reduction metrics.
2. **Build aggregate** (`build_id`) -- Returns overall AI metrics: comparisons analyzed, potential bugs, diff reduction, and job status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comparison_id` | string | No* | Get AI analysis for a single comparison. |
| `build_id` | string | No* | Get aggregated AI analysis for an entire build. |

*At least one of `comparison_id` or `build_id` is required.

**Returns (comparison mode):** AI diff ratio vs raw diff ratio, potential bug count, and numbered list of AI regions with labels, types, descriptions, and ignored status.

**Returns (build mode):** Aggregate stats: comparisons analyzed, potential bugs, total AI diffs, diff reduction, job completion status, summary status.

**Example prompt:** "What did Percy AI find in comparison 77001?"

**Example output (comparison):**
```
## AI Analysis -- Comparison #77001

**AI Diff Ratio:** 8.1% (raw: 12.3%)

### Regions (3):
1. **Button color change** (style)
   Primary CTA changed from blue to green
2. **New badge added** (content)
   "Beta" badge added next to feature name
3. ~~Font rendering~~ (ignored by AI)
```

**Example output (build):**
```
## AI Analysis -- Build #142

- Comparisons analyzed: 52
- Potential bugs: 1
- Total AI visual diffs: 12
- Diff reduction: 38.5% -> 14.2%
- AI jobs completed: yes
- Summary status: completed
```

---

#### `percy_get_build_summary`

Get an AI-generated natural language summary of all visual changes in a Percy build.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |

**Returns:** The AI-generated summary text, or a status message if the summary is still processing or was skipped.

**Example prompt:** "Summarize the visual changes in build 98765"

**Example output:**
```
## Build Summary -- Build #142

This build introduces a redesigned login page with updated button colors
and spacing. The settings panel shows minor layout adjustments. All other
pages remain unchanged. No visual regressions detected.
```

---

#### `percy_get_ai_quota`

Check Percy AI quota status -- daily regeneration quota and usage. Derives quota information from the latest build's AI details.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | | | |

**Returns:** Daily regeneration usage and limits, plan type, and latest build AI stats.

**Example prompt:** "How much Percy AI quota do I have left?"

**Example output:**
```
## Percy AI Quota Status

**Daily Regenerations:** 3 / 25 used
**Plan:** enterprise

### Latest Build AI Stats
- Build #142
- Comparisons analyzed: 52
- Potential bugs detected: 0
- AI jobs completed: yes
```

---

#### `percy_get_rca`

Trigger and retrieve Percy Root Cause Analysis -- maps visual diffs back to specific DOM/CSS changes with XPath paths and attribute diffs. Automatically triggers RCA if not yet run (configurable). Polls with exponential backoff for up to 2 minutes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comparison_id` | string | **Yes** | Percy comparison ID. |
| `trigger_if_missing` | boolean | No | Auto-trigger RCA if not yet run (default `true`). |

**Returns:** Categorized DOM changes: Changed Elements (with XPath, attribute diffs showing before/after values), Removed Elements, and Added Elements.

**Example prompt:** "What DOM changes caused the visual diff in comparison 77001?"

**Example output:**
```
## Root Cause Analysis -- Comparison #77001

**Status:** finished

### Changed Elements (2)

1. **button** (DIFF)
   XPath: `/html/body/div[1]/main/form/button`
   class: `btn btn-primary` -> `btn btn-success`
   style: `padding: 8px 16px` -> `padding: 12px 24px`

2. **span** (DIFF)
   XPath: `/html/body/div[1]/header/nav/span[2]`
   class: `hidden` -> `badge badge-info`

### Added Elements (1)

1. **div** -- added in head
   XPath: `/html/body/div[1]/main/div[3]`
```

---

### Diagnostics

---

#### `percy_get_suggestions`

Get Percy build failure suggestions -- rule-engine-analyzed diagnostics with categorized issues, actionable fix steps, and documentation links.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |
| `reference_type` | string | No | Filter: `build`, `snapshot`, or `comparison`. |
| `reference_id` | string | No | Specific snapshot or comparison ID to scope suggestions. |

**Returns:** Formatted suggestions with issue categories, descriptions, and recommended fixes.

**Example prompt:** "Why did build 98762 fail? Show me the suggestions."

**Example output:**
```
## Diagnostic Suggestions

### Missing Resources (Critical)
Some assets failed to load during rendering.

**Affected snapshots:** Login Page, Dashboard

**Recommended fixes:**
- Check that all CSS/JS assets are accessible from Percy's rendering environment
- Add failing hostnames to `networkIdleIgnore` in Percy config
- See: https://docs.percy.io/docs/debugging-sdks#missing-resources
```

---

#### `percy_get_network_logs`

Get parsed network request logs for a Percy comparison -- shows per-URL status for base vs head, identifying which assets loaded, failed, or were cached.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comparison_id` | string | **Yes** | Percy comparison ID. |

**Returns:** Formatted network log table showing URL, base status, and head status for each request.

**Example prompt:** "Show me the network requests for comparison 77001"

**Example output:**
```
## Network Logs -- Comparison #77001

| URL | Base | Head |
|-----|------|------|
| /styles/main.css | 200 | 200 |
| /scripts/app.js | 200 | 200 |
| /images/hero.png | 200 | 404 |
| /api/config | NA | 200 |
```

---

### Composite Workflows

These are the highest-value tools -- single calls that combine multiple API queries with domain logic to produce actionable reports. They internally call core query tools, AI analysis, diagnostics, and network logs, then synthesize the results.

---

#### `percy_pr_visual_report`

Get a complete visual regression report for a PR. Finds the Percy build by branch or SHA, ranks snapshots by risk, shows AI analysis, and recommends actions. **This is the single best tool for checking visual status of a PR.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | No | Percy project ID (optional if `PERCY_TOKEN` is project-scoped). |
| `branch` | string | No | Git branch name to find the build. |
| `sha` | string | No | Git commit SHA to find the build. |
| `build_id` | string | No | Direct Percy build ID (skips search). |

*Provide at least one of `branch`, `sha`, or `build_id` to locate the build.*

**Returns:** Full visual regression report with:
- Build header (state, branch, commit, snapshot counts)
- AI build summary (if available)
- Changed snapshots ranked by risk tier:
  - **CRITICAL** -- Potential bugs flagged by AI
  - **REVIEW REQUIRED** -- High diff ratio (>15%)
  - **EXPECTED CHANGES** -- Moderate diff ratio (0.5-15%)
  - **NOISE** -- Negligible diff ratio (<0.5%)
- Actionable recommendation

**Example prompt:** "What's the visual status of my PR on branch feature/login?"

**Example output:**
```
# Percy Visual Regression Report

## Build #142

**State:** finished | **Review:** unreviewed
**Branch:** feature/login | **SHA:** abc1234def5678
**Snapshots:** 48 total | 3 changed | 1 new | 0 removed

### AI Build Summary

> Login page redesign with updated CTA colors

- Button styling updated across login flow
- New "Beta" badge added to feature navigation

### Changed Snapshots (3)

**CRITICAL -- Potential Bugs (1):**
1. **Checkout Form** -- 18.5% diff, 1 bug(s) flagged

**REVIEW REQUIRED (1):**
1. **Login Page** -- 12.3% diff

**EXPECTED CHANGES (1):**
1. Settings Panel -- 3.4% diff

### Recommendation

Review 1 critical item(s) before approving. 1 item(s) need manual review.
```

---

#### `percy_auto_triage`

Automatically categorize all visual changes in a Percy build into Critical, Review Required, Auto-Approvable, and Noise tiers. Helps prioritize visual review.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |
| `noise_threshold` | number | No | Diff ratio below this is noise (default `0.005` = 0.5%). |
| `review_threshold` | number | No | Diff ratio above this needs review (default `0.15` = 15%). |

**Returns:** Categorized snapshot list with counts per tier and a recommended action.

**Triage logic:**
- **Critical** -- Any snapshot with AI-flagged potential bugs
- **Auto-Approvable** -- AI-filtered diffs (IntelliIgnore) or diff ratio between noise and review thresholds
- **Review Required** -- Diff ratio above `review_threshold` without bug flags
- **Noise** -- Diff ratio at or below `noise_threshold`

**Example prompt:** "Triage the visual changes in build 98765"

**Example output:**
```
## Auto-Triage -- Build #98765

**Total changed:** 12 | Critical: 1 | Review: 2 | Auto-approvable: 6 | Noise: 3

### CRITICAL -- Potential Bugs (1)
1. **Checkout Form** -- 18.5% diff, 1 bug(s)

### REVIEW REQUIRED (2)
1. **Login Page** -- 22.1% diff
2. **Pricing Table** -- 16.8% diff

### AUTO-APPROVABLE (6)
1. Settings Panel -- AI-filtered (IntelliIgnore)
2. Profile Page -- Low diff ratio
3. Help Center -- Low diff ratio
...

### NOISE (3)
Footer, Sidebar, Breadcrumb

### Recommended Action

Investigate 1 critical item(s) before approving.
```

---

#### `percy_debug_failed_build`

Diagnose a Percy build failure. Cross-references error buckets, suggestions, failed snapshots, and network logs to provide actionable fix commands.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `build_id` | string | **Yes** | Percy build ID. |

**Returns:** Comprehensive debug report including:
- Build details and failure reason
- Rule-engine diagnostic suggestions with fix steps
- List of failed snapshots
- Network logs for the top 3 failed snapshots (showing failed asset requests)
- Suggested fix commands based on failure reason

**Example prompt:** "Why did Percy build 98762 fail?"

**Example output:**
```
## Build Debug Report -- #98762

## Build #139

**State:** failed | **Failure Reason:** missing_resources
**Branch:** main | **SHA:** jkl3456
...

## Diagnostic Suggestions

### Missing Resources (Critical)
...

### Failed Snapshots (3)

1. **Login Page**
2. **Dashboard**
3. **Settings**

#### Network Issues -- Login Page

| URL | Base | Head |
|-----|------|------|
| /fonts/custom.woff2 | 200 | 404 |

### Suggested Fix Commands

percy config set networkIdleIgnore "<failing-hostname>"
percy config set allowedHostnames "<required-hostname>"
```

---

#### `percy_diff_explain`

Explain visual changes in plain English. Supports three depth levels for progressive detail.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comparison_id` | string | **Yes** | Percy comparison ID. |
| `depth` | enum | No | Analysis depth: `summary`, `detailed` (default), `full_rca`. |

**Depth levels:**
- **`summary`** -- AI descriptions only (region titles and types)
- **`detailed`** -- AI descriptions + change reasons + diff region coordinates
- **`full_rca`** -- All of the above + DOM/CSS changes with XPath (triggers RCA if needed, polls up to 30s)

**Returns:** Progressive explanation of visual changes based on selected depth.

**Example prompt:** "Explain what changed in comparison 77001 with full root cause analysis"

**Example output:**
```
## Visual Diff Explanation -- Comparison #77001

**Diff:** 12.3% | **AI Diff:** 8.1% (34% noise filtered)

### What Changed (3 regions)

1. **Button color change** (style)
   Primary CTA changed from blue to green
   *Reason: Intentional brand color update*

2. **New badge added** (content)
   "Beta" badge added next to feature name
   *Reason: New feature flag enabled*

3. ~~Font rendering~~ (unknown) -- *ignored by AI*

### Diff Regions (coordinates)

1. (340, 520) -> (480, 560)
2. (120, 45) -> (210, 70)

### Root Cause Analysis

1. **button** -- `/html/body/div[1]/main/form/button`
   class: `btn btn-primary` -> `btn btn-success`

2. **span** -- `/html/body/div[1]/header/nav/span[2]`
   class: `hidden` -> `badge badge-info`
```

---

### Auth Diagnostic

---

#### `percy_auth_status`

Check Percy authentication status -- shows which tokens are configured, validates them, and reports project/org scope.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | | | |

**Returns:** Token configuration table (set/not set with masked values), validation results for project and org scope, and setup guidance if no tokens are configured.

**Example prompt:** "Check my Percy authentication status"

**Example output:**
```
## Percy Auth Status

**API URL:** https://percy.io/api/v1

### Token Configuration

| Token | Status | Value |
|-------|--------|-------|
| PERCY_TOKEN | Set | ****a1b2 |
| PERCY_ORG_TOKEN | Not set | -- |
| BrowserStack Credentials | Set | username + access key |

### Validation

**Project scope:** Valid -- project "my-web-app"
**Latest build:** #142 (finished)
```

---

## Common Workflows

### "What's the visual status of my PR?"

Ask your agent: _"Check the Percy visual status for my branch feature/login"_

The agent calls `percy_pr_visual_report` with `branch: "feature/login"`, which:
1. Finds the latest build for that branch
2. Fetches AI summary and changed snapshots
3. Ranks changes by risk
4. Returns a full report with recommendations

### "Why did my Percy build fail?"

Ask your agent: _"Debug Percy build 98762"_

The agent calls `percy_debug_failed_build` with `build_id: "98762"`, which:
1. Fetches build details and failure reason
2. Pulls diagnostic suggestions from the rule engine
3. Lists failed snapshots
4. Checks network logs for the worst failures
5. Suggests specific fix commands

### "Explain what changed in this visual diff"

Ask your agent: _"Explain comparison 77001 with full root cause analysis"_

The agent calls `percy_diff_explain` with `comparison_id: "77001"` and `depth: "full_rca"`, which:
1. Fetches AI analysis regions with descriptions
2. Gets diff coordinates
3. Triggers and polls RCA for DOM/CSS changes
4. Maps visual diffs to specific element attribute changes

### "Create a Percy build for my web app"

The agent sequences multiple tools:
1. `percy_create_build` -- create the build
2. `percy_create_snapshot` -- add snapshots with HTML/CSS resource references
3. `percy_upload_resource` -- upload only the missing resources
4. `percy_finalize_snapshot` -- trigger rendering per snapshot
5. `percy_finalize_build` -- trigger processing

### "Upload mobile screenshots to Percy"

The agent sequences the app/BYOS flow:
1. `percy_create_build` -- create the build
2. `percy_create_app_snapshot` -- create snapshot per screen
3. `percy_create_comparison` -- attach device metadata (iPhone 13, 390x844, iOS 16)
4. `percy_upload_tile` -- upload the screenshot PNG
5. `percy_finalize_comparison` -- trigger diff per comparison
6. `percy_finalize_build` -- trigger processing

### "Approve all visual changes"

Ask your agent: _"Approve Percy build 98765"_

The agent calls `percy_approve_build` with `build_id: "98765"` and `action: "approve"`.

For selective review: _"Request changes on snapshot 55001 in build 98765 because the button color is wrong"_

The agent calls `percy_approve_build` with `action: "request_changes"`, `snapshot_ids: "55001"`, and `reason: "Button color regression"`.

---

## Architecture

```
src/
  lib/percy-api/
    auth.ts         -- Token resolution (env vars + BrowserStack fallback), header generation
    client.ts       -- PercyClient HTTP client with JSON:API deserialization, rate limiting (429 + exponential backoff), retry logic
    cache.ts        -- In-memory cache for cross-tool data sharing (e.g., build data reused by composite workflows)
    polling.ts      -- Exponential backoff polling utility for async operations (RCA, AI processing)
    formatter.ts    -- Markdown formatters for builds, comparisons, snapshots, suggestions, network logs
    errors.ts       -- Error enrichment: maps HTTP status codes and Percy error codes to actionable messages
    types.ts        -- TypeScript interfaces for Percy API responses

  tools/percy-mcp/
    index.ts        -- Tool registrar: defines all 27 tools with names, descriptions, Zod schemas, and wires handlers
    core/           -- Query tools: list-projects, list-builds, get-build, get-build-items, get-snapshot, get-comparison, approve-build
    creation/       -- Build creation: create-build, create-snapshot, upload-resource, finalize-snapshot, finalize-build, create-app-snapshot, create-comparison, upload-tile, finalize-comparison
    intelligence/   -- AI tools: get-ai-analysis, get-build-summary, get-ai-quota, get-rca
    diagnostics/    -- Debug tools: get-suggestions, get-network-logs
    workflows/      -- Composite tools: pr-visual-report, auto-triage, debug-failed-build, diff-explain
    auth/           -- Auth diagnostic: auth-status
```

**Registration flow:** `server-factory.ts` calls `registerPercyMcpTools(server, config)` which registers all 27 tools on the MCP server instance. Each tool validates arguments via Zod schemas, tracks usage via `trackMCP()`, and delegates to its handler function.

**JSON:API handling:** The `PercyClient` automatically deserializes JSON:API envelopes (`data` + `included` + `relationships`) into flat camelCase objects. Handlers work with plain objects, not raw API responses.

---

## Troubleshooting

### Token Types

| Token Type | Source | Scope | Capabilities |
|-----------|--------|-------|--------------|
| Write-only token | Percy project settings | Project | Create builds, upload snapshots. Cannot read builds or comparisons. |
| Full-access token | Percy project settings | Project | All operations: read, write, approve, AI analysis. |
| Org token | Percy org settings | Organization | List projects, cross-project queries. Cannot create builds. |

Most tools require a **full-access project token**. If you only have a write-only token, query tools like `percy_list_builds` and `percy_get_build` will fail with 401/403 errors.

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Percy token is invalid or expired` (401) | Token doesn't match any Percy project | Verify `PERCY_TOKEN` value in Percy project settings |
| `Insufficient permissions` (403, `project_rbac_access_denied`) | Token lacks write access | Use a full-access token, not read-only |
| `This build has been deleted` (403, `build_deleted`) | Build was removed from Percy | Use a different build ID |
| `This build is outside your plan's history limit` (403, `plan_history_exceeded`) | Build is too old for your plan tier | Upgrade plan or use a more recent build |
| `Resource not found` (404) | Invalid build/snapshot/comparison ID | Double-check the ID value |
| `Invalid request` (422) | Malformed request body | Check parameter format (e.g., JSON arrays for `resources` and `tiles`) |
| `Rate limit exceeded` (429) | Too many API requests | The client retries automatically with exponential backoff (up to 3 retries). If persistent, add delays between tool calls. |
| `RCA requires DOM metadata` (422) | Comparison type doesn't support RCA | RCA only works for web builds with DOM snapshots, not app/BYOS screenshot builds |
| `Failed to fetch Percy token via BrowserStack API` | BrowserStack credentials are wrong or API is down | Set `PERCY_TOKEN` directly instead of relying on fallback |

### Rate Limiting

The Percy API enforces rate limits. The `PercyClient` handles 429 responses automatically:

1. Reads `Retry-After` header if present
2. Falls back to exponential backoff: 1s, 2s, 4s
3. Retries up to 3 times before throwing

Network errors (DNS failures, timeouts) also trigger the same retry loop.

### Debugging Authentication Issues

Run `percy_auth_status` first. It will:
- Show which tokens are set (masked)
- Validate project scope by fetching the latest build
- Validate org scope by listing projects
- Provide setup guidance if nothing is configured

If tokens are set but validation fails, the token may be expired or belong to a different project/org than expected.
