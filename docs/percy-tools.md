# Percy MCP Tools — Quick Reference

> 46 tools | All commands use natural language in Claude Code

---

## Setup

```bash
cd mcp-server
./percy-config/setup.sh    # one-time credential setup
# restart Claude Code
```

---

## All Commands at a Glance

### CREATE — Build & Snapshot Things

| What You Want To Do | Command | Notes |
|---|---|---|
| **Create a project** | `Use percy_create_project with name "my-app"` | Auto-creates, returns token |
| **Create a project (web type)** | `Use percy_create_project with name "my-app" and type "web"` | Explicit web type |
| **Snapshot URLs locally** | `Use percy_snapshot_urls with project_name "my-app" and urls "http://localhost:3000"` | Launches real browser, captures screenshots. Requires `@percy/cli` installed |
| **Snapshot multiple URLs** | `Use percy_snapshot_urls with project_name "my-app" and urls "http://localhost:3000,http://localhost:3000/about,http://localhost:3000/login"` | Each URL = 1 snapshot |
| **Snapshot at custom widths** | `Use percy_snapshot_urls with project_name "my-app" and urls "http://localhost:3000" and widths "375,768,1280"` | 3 screenshots per URL |
| **Run tests with Percy** | `Use percy_run_tests with project_name "my-app" and test_command "npx cypress run"` | Wraps tests with `percy exec` |
| **Run any test framework** | `Use percy_run_tests with project_name "my-app" and test_command "npm test"` | Works with any test command |
| **Upload screenshots from folder** | `Use percy_create_percy_build with project_name "my-app" and screenshots_dir "./screenshots"` | Uploads all PNG/JPGs |
| **Upload single screenshot** | `Use percy_create_percy_build with project_name "my-app" and screenshot_files "./screen1.png,./screen2.png"` | Comma-separated paths |
| **Clone a build to another project** | `Use percy_clone_build with source_build_id "12345" and target_project_name "other-project"` | Downloads and re-uploads screenshots |
| **Clone to existing project (with token)** | `Use percy_clone_build with source_build_id "12345" and target_project_name "my-project" and target_token "web_xxx"` | Uses existing project token |
| **Clone across orgs** | `Use percy_clone_build with source_build_id "12345" and target_project_name "other-org-project" and source_token "web_xxx"` | Reads from different token |
| **Get CLI commands (don't execute)** | `Use percy_create_percy_build with project_name "my-app" and urls "http://localhost:3000"` | Returns instructions only |

### READ — Query & Analyze

| What You Want To Do | Command | Notes |
|---|---|---|
| **Check PR visual status** | `Use percy_pr_visual_report with branch "feature-x"` | THE main tool — risk-ranked report with AI |
| **Check by commit SHA** | `Use percy_pr_visual_report with sha "abc1234"` | Find build by SHA |
| **Check by build ID** | `Use percy_pr_visual_report with build_id "12345"` | Direct lookup |
| **List my projects** | `Use percy_list_projects` | All projects in org |
| **List builds** | `Use percy_list_builds` | Latest builds for project |
| **List builds for branch** | `Use percy_list_builds with branch "main"` | Filter by branch |
| **List failed builds** | `Use percy_list_builds with state "failed"` | Only failures |
| **Get build details** | `Use percy_get_build with build_id "12345"` | Full details + AI metrics |
| **List changed snapshots** | `Use percy_get_build_items with build_id "12345" and category "changed"` | Only diffs |
| **List failed snapshots** | `Use percy_get_build_items with build_id "12345" and category "failed"` | Only failures |
| **Get snapshot details** | `Use percy_get_snapshot with snapshot_id "67890"` | All comparisons + screenshots |
| **Get comparison details** | `Use percy_get_comparison with comparison_id "99999"` | Diff ratio, AI data, image URLs |
| **Get AI analysis (comparison)** | `Use percy_get_ai_analysis with comparison_id "99999"` | Per-region change descriptions |
| **Get AI analysis (build)** | `Use percy_get_ai_analysis with build_id "12345"` | Aggregate: bugs, diff reduction |
| **Get AI build summary** | `Use percy_get_build_summary with build_id "12345"` | Natural language summary |
| **Get AI quota** | `Use percy_get_ai_quota` | Daily usage and limits |
| **Get Root Cause Analysis** | `Use percy_get_rca with comparison_id "99999"` | DOM/CSS changes → visual diff mapping |
| **Diagnose failed build** | `Use percy_debug_failed_build with build_id "12345"` | Cross-referenced logs + fix commands |
| **Explain a diff in plain English** | `Use percy_diff_explain with comparison_id "99999"` | Summary level |
| **Explain with DOM details** | `Use percy_diff_explain with comparison_id "99999" and depth "full_rca"` | Includes CSS/XPath changes |
| **Triage all changes** | `Use percy_auto_triage with build_id "12345"` | Critical/Review/Noise categories |
| **Get failure suggestions** | `Use percy_get_suggestions with build_id "12345"` | Rule-engine diagnostics |
| **Get network logs** | `Use percy_get_network_logs with comparison_id "99999"` | Per-URL base vs head status |
| **Get build logs** | `Use percy_get_build_logs with build_id "12345"` | Raw CLI/renderer logs |
| **Filter logs by service** | `Use percy_get_build_logs with build_id "12345" and service "renderer"` | cli, renderer, or jackproxy |
| **Analyze logs in real-time** | `Use percy_analyze_logs_realtime with logs '[{"message":"error","level":"error"}]'` | Instant diagnostics |
| **Get usage stats** | `Use percy_get_usage_stats with org_id "my-org"` | Screenshots, quotas, AI counts |
| **Check auth status** | `Use percy_auth_status` | Which tokens are set + valid |

### UPDATE — Approve, Configure, Manage

| What You Want To Do | Command | Notes |
|---|---|---|
| **Approve a build** | `Use percy_approve_build with build_id "12345" and action "approve"` | Requires user token |
| **Reject a build** | `Use percy_approve_build with build_id "12345" and action "reject"` | |
| **Request changes on snapshot** | `Use percy_approve_build with build_id "12345" and action "request_changes" and snapshot_ids "67890,67891"` | Snapshot-level only |
| **Re-run AI with custom prompt** | `Use percy_trigger_ai_recompute with build_id "12345" and prompt "Ignore font rendering differences"` | Custom AI prompt |
| **Get AI-suggested prompt** | `Use percy_suggest_prompt with comparison_id "99999" and region_ids "1,2,3"` | AI generates the prompt |
| **Update project settings** | `Use percy_manage_project_settings with project_id "12345" and settings '{"diff-sensitivity-level":3}'` | 58 writable attributes |
| **Add browser target** | `Use percy_manage_browser_targets with project_id "12345" and action "add" and browser_family "firefox"` | Chrome, Firefox, Safari, Edge |
| **List browser targets** | `Use percy_manage_browser_targets with project_id "12345"` | Default: list |
| **View tokens (masked)** | `Use percy_manage_tokens with project_id "12345"` | Last 4 chars only |
| **Rotate token** | `Use percy_manage_tokens with project_id "12345" and action "rotate" and role "master"` | master, write_only, read_only |
| **Create webhook** | `Use percy_manage_webhooks with project_id "12345" and action "create" and url "https://example.com/webhook"` | |
| **List webhooks** | `Use percy_manage_webhooks with project_id "12345"` | Default: list |
| **Add ignored region** | `Use percy_manage_ignored_regions with comparison_id "99999" and action "create" and coordinates '{"x":0,"y":0,"width":100,"height":50}'` | Bounding box |
| **Add comment** | `Use percy_manage_comments with snapshot_id "67890" and action "create" and body "This looks wrong"` | Creates thread |
| **List comments** | `Use percy_manage_comments with build_id "12345"` | All threads |
| **Sync branch baselines** | `Use percy_branchline_operations with action "sync" and project_id "12345" and target_branch_filter "feature/*"` | Copy baselines |
| **Merge branch** | `Use percy_branchline_operations with action "merge" and build_id "12345"` | Push to main |
| **Create VM project** | `Use percy_manage_visual_monitoring with action "create" and org_id "my-org" and urls "https://example.com"` | URL scanning |
| **Create A/B variant** | `Use percy_manage_variants with snapshot_id "67890" and action "create" and name "Variant B"` | A/B testing |

---

## Common Workflows

### "I just pushed a PR — what changed visually?"
```
Use percy_pr_visual_report with branch "my-feature-branch"
```

### "Why did my Percy build fail?"
```
Use percy_debug_failed_build with build_id "12345"
```

### "Snapshot my local app"
```
Use percy_snapshot_urls with project_name "my-app" and urls "http://localhost:3000"
```

### "Run my tests with visual testing"
```
Use percy_run_tests with project_name "my-app" and test_command "npx cypress run"
```

### "Copy a build to another project"
```
Use percy_clone_build with source_build_id "12345" and target_project_name "new-project"
```

### "Explain what changed in this diff"
```
Use percy_diff_explain with comparison_id "99999" and depth "full_rca"
```

### "Auto-approve noise, flag bugs"
```
Use percy_auto_triage with build_id "12345"
```

### "Create a new project and snapshot it"
```
Use percy_create_project with name "my-new-app"
Use percy_snapshot_urls with project_name "my-new-app" and urls "http://localhost:3000"
```

---

## Prerequisites

| Requirement | What For | Install |
|---|---|---|
| BrowserStack credentials | All tools (auth) | `./percy-config/setup.sh` |
| PERCY_TOKEN (web_* or auto_*) | Read tools, approvals | From `percy_create_project` output or Percy dashboard |
| @percy/cli | `percy_snapshot_urls`, `percy_run_tests` | `npm install -g @percy/cli` |
| Local dev server running | `percy_snapshot_urls` | Start your app first |

## Switching Orgs

```bash
# Save current org
./percy-config/switch-org.sh --save my-org

# Switch to another
./percy-config/switch-org.sh other-org

# Restart Claude Code
```

## Token Types

| Token Format | Type | Can Read | Can Write | Can Approve |
|---|---|---|---|---|
| `web_xxxx` | Web project (full) | ✓ | ✓ | ✓ |
| `auto_xxxx` | Automate project (full) | ✓ | ✓ | ✓ |
| `app_xxxx` | App project (full) | ✓ | ✓ | ✓ |
| `30a3xxxx` (no prefix) | CI/write-only | ✗ | ✓ | ✗ |

Get a full-access token: `Use percy_create_project with name "my-app"`
