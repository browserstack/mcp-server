# Percy MCP Tools — Quick Reference

> 21 tools | BrowserStack Basic Auth | All commands use natural language

---

## Setup

```bash
cd mcp-server
./percy-config/setup.sh    # enter BrowserStack username + access key
# restart Claude Code
```

---

## All Commands

### percy_auth_status

Check if your credentials are working.

```
Use percy_auth_status
```

No parameters needed. Shows: credential status, API connectivity, what you can do.

---

### percy_create_project

Create a new Percy project or get token for existing one.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `name` | Yes | Project name | `"my-web-app"` |
| `type` | No | `web` or `automate` | `"web"` |

**Examples:**

```
Use percy_create_project with name "my-app"
```

```
Use percy_create_project with name "my-app" and type "web"
```

```
Use percy_create_project with name "mobile-tests" and type "automate"
```

Returns: project token (save it for Percy CLI use).

---

### percy_create_build

Create a Percy build with snapshots. ONE tool handles everything.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `project_name` | Yes | Project name (auto-creates if new) | `"my-app"` |
| `urls` | No* | URLs to snapshot (launches real browser) | `"http://localhost:3000"` |
| `screenshots_dir` | No* | Folder with PNG/JPG files | `"./screenshots"` |
| `screenshot_files` | No* | Comma-separated file paths | `"./home.png,./login.png"` |
| `test_command` | No* | Test command to wrap with Percy | `"npx cypress run"` |
| `branch` | No | Git branch (auto-detected) | `"feature-x"` |
| `widths` | No | Viewport widths (default: 375,1280) | `"375,768,1280"` |
| `snapshot_names` | No | Custom names for snapshots (comma-separated, maps 1:1 with urls/files) | `"Homepage,Login,Dashboard"` |
| `test_case` | No | Test case name(s). Single = applies to all. Comma-separated = maps 1:1 with urls/files. Works with both URLs and screenshots. | `"smoke-test"` or `"test-1,test-2"` |
| `type` | No | Project type | `"web"` |

*Provide ONE of: `urls`, `screenshots_dir`, `screenshot_files`, or `test_command`

**When Percy CLI is installed:** tool executes automatically and returns build URL.
**When Percy CLI is NOT installed:** tool returns install instructions.

**Snapshot URLs (auto-executes, returns build URL):**

```
Use percy_create_build with project_name "my-app" and urls "http://localhost:3000"
```

```
Use percy_create_build with project_name "my-app" and urls "http://localhost:3000,http://localhost:3000/login,http://localhost:3000/dashboard"
```

**With custom widths:**

```
Use percy_create_build with project_name "my-app" and urls "http://localhost:3000" and widths "375,768,1280"
```

**With custom snapshot names:**

```
Use percy_create_build with project_name "my-app" and urls "http://localhost:3000,http://localhost:3000/login" and snapshot_names "Home Page,Login Page"
```

**With test case:**

```
Use percy_create_build with project_name "my-app" and urls "http://localhost:3000" and snapshot_names "Homepage" and test_case "smoke-test"
```

**Upload screenshots from folder:**

```
Use percy_create_build with project_name "my-app" and screenshots_dir "./screenshots"
```

**Upload with custom names:**

```
Use percy_create_build with project_name "my-app" and screenshot_files "./home.png,./login.png" and snapshot_names "Homepage,Login Page"
```

**Run tests with Percy (auto-executes):**

```
Use percy_create_build with project_name "my-app" and test_command "npx cypress run"
```

```
Use percy_create_build with project_name "my-app" and test_command "npx playwright test"
```

**Just get setup (no snapshots yet):**

```
Use percy_create_build with project_name "my-app"
```

---

### percy_get_projects

List all Percy projects in your organization.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `search` | No | Filter by name | `"my-app"` |
| `limit` | No | Max results (default: 20) | `10` |

**Examples:**

```
Use percy_get_projects
```

```
Use percy_get_projects with search "dashboard"
```

```
Use percy_get_projects with limit 5
```

Returns: table with project name, type, and slug. Use the slug in `percy_get_builds`.

---

### percy_get_builds

List builds for a project.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `project_slug` | No* | From percy_get_projects output | `"9560f98d/my-app-abc123"` |
| `branch` | No | Filter by branch | `"main"` |
| `state` | No | Filter: pending/processing/finished/failed | `"finished"` |
| `limit` | No | Max results (default: 10) | `5` |

*Get project_slug from `percy_get_projects` output.

**Examples:**

```
Use percy_get_builds with project_slug "9560f98d/my-app-abc123"
```

```
Use percy_get_builds with project_slug "9560f98d/my-app-abc123" and branch "main"
```

```
Use percy_get_builds with project_slug "9560f98d/my-app-abc123" and state "failed"
```

```
Use percy_get_builds with project_slug "9560f98d/my-app-abc123" and limit 5
```

Returns: table with build number, ID, branch, state, review status, snapshot count, diff count.

---

### percy_figma_build

Create a Percy build from Figma design files.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `project_slug` | Yes | Project slug | `"org-id/my-project"` |
| `branch` | Yes | Branch name | `"main"` |
| `figma_url` | Yes | Figma file URL | `"https://www.figma.com/file/..."` |

```
Use percy_figma_build with project_slug "org-id/my-project" and branch "main" and figma_url "https://www.figma.com/file/abc123"
```

---

### percy_figma_baseline

Update the Figma design baseline.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `project_slug` | Yes | Project slug | `"org-id/my-project"` |
| `branch` | Yes | Branch | `"main"` |
| `build_id` | Yes | Build ID for new baseline | `"12345"` |

```
Use percy_figma_baseline with project_slug "org-id/my-project" and branch "main" and build_id "12345"
```

---

### percy_figma_link

Get Figma design link for a snapshot or comparison.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `snapshot_id` | No* | Snapshot ID | `"67890"` |
| `comparison_id` | No* | Comparison ID | `"99999"` |

```
Use percy_figma_link with snapshot_id "67890"
```

---

### percy_get_insights

Get testing health metrics for an organization.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `org_slug` | Yes | Organization slug | `"my-org"` |
| `period` | No | last_7_days / last_30_days / last_90_days | `"last_30_days"` |
| `product` | No | web / app | `"web"` |

```
Use percy_get_insights with org_slug "my-org"
```

```
Use percy_get_insights with org_slug "my-org" and period "last_90_days" and product "app"
```

---

### percy_manage_insights_email

Configure weekly insights email recipients.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `org_id` | Yes | Organization ID | `"12345"` |
| `action` | No | get / create / update | `"create"` |
| `emails` | No | Comma-separated emails | `"a@b.com,c@d.com"` |
| `enabled` | No | Enable/disable | `true` |

```
Use percy_manage_insights_email with org_id "12345"
```

```
Use percy_manage_insights_email with org_id "12345" and action "create" and emails "team@company.com"
```

---

### percy_get_test_cases

List test cases for a project.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `project_id` | Yes | Project ID | `"12345"` |
| `build_id` | No | Build ID for execution details | `"67890"` |

```
Use percy_get_test_cases with project_id "12345"
```

```
Use percy_get_test_cases with project_id "12345" and build_id "67890"
```

---

### percy_get_test_case_history

Get execution history of a test case across builds.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `test_case_id` | Yes | Test case ID | `"99999"` |

```
Use percy_get_test_case_history with test_case_id "99999"
```

---

### percy_discover_urls

Discover URLs from a sitemap for visual testing.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `project_id` | Yes | Project ID | `"12345"` |
| `sitemap_url` | No | Sitemap XML URL to crawl | `"https://example.com/sitemap.xml"` |
| `action` | No | create / list | `"create"` |

```
Use percy_discover_urls with project_id "12345" and sitemap_url "https://example.com/sitemap.xml"
```

---

### percy_get_devices

List available browsers and devices.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `build_id` | No | Build ID for device details | `"12345"` |

```
Use percy_get_devices
```

---

### percy_manage_domains

Get or update allowed/error domains for a project.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `project_id` | Yes | Project ID | `"12345"` |
| `action` | No | get / update | `"get"` |
| `allowed_domains` | No | Comma-separated domains | `"cdn.example.com,api.example.com"` |

```
Use percy_manage_domains with project_id "12345"
```

---

### percy_manage_usage_alerts

Configure usage alert thresholds.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `org_id` | Yes | Organization ID | `"12345"` |
| `action` | No | get / create / update | `"create"` |
| `threshold` | No | Screenshot count threshold | `5000` |
| `emails` | No | Comma-separated emails | `"team@co.com"` |

```
Use percy_manage_usage_alerts with org_id "12345" and action "create" and threshold 5000 and emails "team@co.com"
```

---

### percy_preview_comparison

Trigger on-demand diff recomputation.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `comparison_id` | Yes | Comparison ID | `"99999"` |

```
Use percy_preview_comparison with comparison_id "99999"
```

---

### percy_search_builds

Advanced build item search with filters.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `build_id` | Yes | Build ID | `"12345"` |
| `category` | No | changed / new / removed / unchanged / failed | `"changed"` |
| `browser_ids` | No | Comma-separated browser IDs | `"63,73"` |
| `widths` | No | Comma-separated widths | `"375,1280"` |
| `os` | No | OS filter | `"iOS"` |
| `device_name` | No | Device filter | `"iPhone 13"` |
| `sort_by` | No | diff_ratio / bug_count | `"diff_ratio"` |

```
Use percy_search_builds with build_id "12345" and category "changed" and sort_by "diff_ratio"
```

---

### percy_list_integrations

List all integrations for an organization.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `org_id` | Yes | Organization ID | `"12345"` |

```
Use percy_list_integrations with org_id "12345"
```

---

### percy_get_ai_summary

Get AI-generated build summary with potential bugs, visual diffs, and change descriptions.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `build_id` | Yes | Percy build ID | `"48436286"` |

```
Use percy_get_ai_summary with build_id "48436286"
```

Returns: potential bugs count, AI visual diffs count, change descriptions with occurrences, affected snapshots.

---

### percy_migrate_integrations

Migrate integrations between organizations.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `source_org_id` | Yes | Source organization ID | `"12345"` |
| `target_org_id` | Yes | Target organization ID | `"67890"` |

```
Use percy_migrate_integrations with source_org_id "12345" and target_org_id "67890"
```

---

## Common Workflows

### First time setup
```
Use percy_auth_status
Use percy_create_project with name "my-app"
```

### Snapshot my local app
```
Use percy_create_build with project_name "my-app" and urls "http://localhost:3000"
```

### Upload existing screenshots
```
Use percy_create_build with project_name "my-app" and screenshots_dir "./screenshots"
```

### Run tests with visual testing
```
Use percy_create_build with project_name "my-app" and test_command "npx cypress run"
```

### Check my builds
```
Use percy_get_projects
Use percy_get_builds with project_slug "org-id/project-slug"
```

---

## Prerequisites

| Requirement | Needed For | How to Get |
|---|---|---|
| BrowserStack credentials | All tools | `./percy-config/setup.sh` |
| @percy/cli installed | URL snapshots, test commands | `npm install -g @percy/cli` |
| Local dev server running | URL snapshots | Start your app first |

## Switching Orgs

```bash
./percy-config/switch-org.sh --save my-org    # save current
./percy-config/switch-org.sh other-org        # switch
# restart Claude Code
```
