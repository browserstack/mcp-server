# Percy MCP Tools — Quick Reference

> 5 core tools | BrowserStack Basic Auth | All commands use natural language

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
