/**
 * Percy MCP tools — CRUD-organized tools for Percy visual testing.
 *
 * Registers 41 tools organized by CRUD action:
 *
 * === CREATE (6) ===
 *   percy_create_project, percy_create_percy_build, percy_create_build,
 *   percy_create_snapshot, percy_create_app_snapshot, percy_create_comparison
 *
 * === READ (17) ===
 *   percy_list_projects, percy_list_builds, percy_get_build,
 *   percy_get_build_items, percy_get_snapshot, percy_get_comparison,
 *   percy_get_ai_analysis, percy_get_build_summary, percy_get_ai_quota,
 *   percy_get_rca, percy_get_suggestions, percy_get_network_logs,
 *   percy_get_build_logs, percy_get_usage_stats, percy_auth_status
 *
 * === UPDATE (12) ===
 *   percy_approve_build, percy_manage_project_settings,
 *   percy_manage_browser_targets, percy_manage_tokens,
 *   percy_manage_webhooks, percy_manage_ignored_regions,
 *   percy_manage_comments, percy_manage_variants,
 *   percy_manage_visual_monitoring, percy_trigger_ai_recompute,
 *   percy_suggest_prompt, percy_branchline_operations
 *
 * === FINALIZE / UPLOAD (6) ===
 *   percy_finalize_build, percy_finalize_snapshot, percy_finalize_comparison,
 *   percy_upload_resource, percy_upload_tile, percy_analyze_logs_realtime
 *
 * === WORKFLOWS (4) ===
 *   percy_pr_visual_report, percy_auto_triage,
 *   percy_debug_failed_build, percy_diff_explain
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { handleMCPError } from "../../lib/utils.js";
import { trackMCP } from "../../index.js";
import { z } from "zod";

import { percyListProjects } from "./core/list-projects.js";
import { percyListBuilds } from "./core/list-builds.js";
import { percyGetBuild } from "./core/get-build.js";
import { percyGetBuildItems } from "./core/get-build-items.js";
import { percyGetSnapshot } from "./core/get-snapshot.js";
import { percyGetComparison } from "./core/get-comparison.js";

import { percyCreateBuild } from "./creation/create-build.js";
import { percyCreateSnapshot } from "./creation/create-snapshot.js";
import { percyUploadResource } from "./creation/upload-resource.js";
import { percyFinalizeSnapshot } from "./creation/finalize-snapshot.js";
import { percyFinalizeBuild } from "./creation/finalize-build.js";

import { percyCreateAppSnapshot } from "./creation/create-app-snapshot.js";
import { percyCreateComparison } from "./creation/create-comparison.js";
import { percyUploadTile } from "./creation/upload-tile.js";
import { percyFinalizeComparison } from "./creation/finalize-comparison.js";

import { percyApproveBuild } from "./core/approve-build.js";

import { percyGetAiAnalysis } from "./intelligence/get-ai-analysis.js";
import { percyGetBuildSummary } from "./intelligence/get-build-summary.js";
import { percyGetAiQuota } from "./intelligence/get-ai-quota.js";
import { percyGetRca } from "./intelligence/get-rca.js";
import { percyTriggerAiRecompute } from "./intelligence/trigger-ai-recompute.js";
import { percySuggestPrompt } from "./intelligence/suggest-prompt.js";

import { percyGetSuggestions } from "./diagnostics/get-suggestions.js";
import { percyGetNetworkLogs } from "./diagnostics/get-network-logs.js";
import { percyGetBuildLogs } from "./diagnostics/get-build-logs.js";
import { percyAnalyzeLogsRealtime } from "./diagnostics/analyze-logs-realtime.js";

import { percyPrVisualReport } from "./workflows/pr-visual-report.js";
import { percyCreatePercyBuild } from "./workflows/create-percy-build.js";
import { percyCloneBuild } from "./workflows/clone-build.js";
import { percyAutoTriage } from "./workflows/auto-triage.js";
import { percyDebugFailedBuild } from "./workflows/debug-failed-build.js";
import { percyDiffExplain } from "./workflows/diff-explain.js";
import { percySnapshotUrls } from "./workflows/snapshot-urls.js";
import { percyRunTests } from "./workflows/run-tests.js";

import { percyAuthStatus } from "./auth/auth-status.js";

import { percyCreateProject } from "./management/create-project.js";
import { percyManageProjectSettings } from "./management/manage-project-settings.js";
import { percyManageBrowserTargets } from "./management/manage-browser-targets.js";
import { percyManageTokens } from "./management/manage-tokens.js";
import { percyManageWebhooks } from "./management/manage-webhooks.js";
import { percyManageIgnoredRegions } from "./management/manage-ignored-regions.js";
import { percyManageComments } from "./management/manage-comments.js";
import { percyGetUsageStats } from "./management/get-usage-stats.js";

import { percyManageVisualMonitoring } from "./advanced/manage-visual-monitoring.js";
import { percyBranchlineOperations } from "./advanced/branchline-operations.js";
import { percyManageVariants } from "./advanced/manage-variants.js";

export function registerPercyMcpTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  // =========================================================================
  // === CREATE ===
  // =========================================================================

  // -------------------------------------------------------------------------
  // percy_create_project
  // -------------------------------------------------------------------------
  tools.percy_create_project = server.tool(
    "percy_create_project",
    "Create a new Percy project. Auto-creates if doesn't exist, returns project token.",
    {
      name: z.string().describe("Project name (e.g. 'my-web-app')"),
      type: z
        .enum(["web", "automate"])
        .optional()
        .describe(
          "Project type: 'web' for Percy Web, 'automate' for Percy Automate (default: auto-detect)",
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_create_project",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCreateProject(args, config);
      } catch (error) {
        return handleMCPError("percy_create_project", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_create_percy_build
  // -------------------------------------------------------------------------
  tools.percy_create_percy_build = server.tool(
    "percy_create_percy_build",
    "Create a complete Percy build with snapshots. Supports URL scanning, screenshot upload, test wrapping, or build cloning. The primary build creation tool.",
    {
      project_name: z
        .string()
        .describe("Percy project name (auto-creates if doesn't exist)"),
      urls: z
        .string()
        .optional()
        .describe(
          "Comma-separated URLs to snapshot, e.g. 'http://localhost:3000,http://localhost:3000/about'",
        ),
      screenshots_dir: z
        .string()
        .optional()
        .describe("Directory path containing PNG/JPG screenshots to upload"),
      screenshot_files: z
        .string()
        .optional()
        .describe("Comma-separated file paths to PNG/JPG screenshots"),
      test_command: z
        .string()
        .optional()
        .describe(
          "Test command to wrap with Percy, e.g. 'npx cypress run' or 'npm test'",
        ),
      clone_build_id: z
        .string()
        .optional()
        .describe("Build ID to clone snapshots from"),
      branch: z
        .string()
        .optional()
        .describe("Git branch (auto-detected from git if not provided)"),
      commit_sha: z
        .string()
        .optional()
        .describe("Git commit SHA (auto-detected from git if not provided)"),
      widths: z
        .string()
        .optional()
        .describe(
          "Comma-separated viewport widths, e.g. '375,768,1280' (default: 375,1280)",
        ),
      snapshot_names: z
        .string()
        .optional()
        .describe(
          "Comma-separated snapshot names (for screenshots — defaults to filename)",
        ),
      test_case: z
        .string()
        .optional()
        .describe("Test case name to associate snapshots with"),
      type: z
        .enum(["web", "app", "automate"])
        .optional()
        .describe("Project type (default: web)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_create_percy_build",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCreatePercyBuild(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_create_percy_build",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_create_build
  // -------------------------------------------------------------------------
  tools.percy_create_build = server.tool(
    "percy_create_build",
    "Create an empty Percy build (low-level). Use percy_create_percy_build for full automation.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Percy project ID (optional if PERCY_TOKEN is project-scoped)",
        ),
      branch: z.string().describe("Git branch name"),
      commit_sha: z.string().describe("Git commit SHA"),
      commit_message: z.string().optional().describe("Git commit message"),
      pull_request_number: z
        .string()
        .optional()
        .describe("Pull request number"),
      type: z
        .string()
        .optional()
        .describe("Project type: web, app, automate, generic"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_create_build",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCreateBuild(args, config);
      } catch (error) {
        return handleMCPError("percy_create_build", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_create_snapshot
  // -------------------------------------------------------------------------
  tools.percy_create_snapshot = server.tool(
    "percy_create_snapshot",
    "Create a snapshot in a Percy build with DOM resources (low-level web flow).",
    {
      build_id: z.string().describe("Percy build ID"),
      name: z.string().describe("Snapshot name"),
      widths: z
        .string()
        .optional()
        .describe("Comma-separated viewport widths, e.g. '375,768,1280'"),
      enable_javascript: z.boolean().optional(),
      resources: z
        .string()
        .optional()
        .describe(
          'JSON array of resources: [{"id":"sha","resource-url":"url","is-root":true}]',
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_create_snapshot",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCreateSnapshot(args, config);
      } catch (error) {
        return handleMCPError("percy_create_snapshot", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_create_app_snapshot
  // -------------------------------------------------------------------------
  tools.percy_create_app_snapshot = server.tool(
    "percy_create_app_snapshot",
    "Create a snapshot for App Percy / screenshot builds (low-level app flow).",
    {
      build_id: z.string().describe("Percy build ID"),
      name: z.string().describe("Snapshot name"),
      test_case: z.string().optional().describe("Test case name"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_create_app_snapshot",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCreateAppSnapshot(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_create_app_snapshot",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_create_comparison
  // -------------------------------------------------------------------------
  tools.percy_create_comparison = server.tool(
    "percy_create_comparison",
    "Create a comparison with device tag and tiles for screenshot builds (low-level).",
    {
      snapshot_id: z.string().describe("Percy snapshot ID"),
      tag_name: z.string().describe("Device/browser name, e.g. 'iPhone 13'"),
      tag_width: z.number().describe("Tag width in pixels"),
      tag_height: z.number().describe("Tag height in pixels"),
      tag_os_name: z.string().optional().describe("OS name, e.g. 'iOS'"),
      tag_os_version: z.string().optional().describe("OS version, e.g. '16.0'"),
      tag_browser_name: z
        .string()
        .optional()
        .describe("Browser name, e.g. 'Safari'"),
      tag_orientation: z.string().optional().describe("portrait or landscape"),
      tiles: z
        .string()
        .describe(
          "JSON array of tiles: [{sha, status-bar-height?, nav-bar-height?}]",
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_create_comparison",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCreateComparison(args, config);
      } catch (error) {
        return handleMCPError("percy_create_comparison", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_clone_build — Cross-project build cloning
  // -------------------------------------------------------------------------
  tools.percy_clone_build = server.tool(
    "percy_clone_build",
    "Clone snapshots from one Percy build to another project. Downloads screenshots from source and re-uploads to target. Works across different projects and orgs. Handles the entire flow: read source → create target build → clone each snapshot with comparisons → finalize.",
    {
      source_build_id: z
        .string()
        .describe("Build ID to clone FROM (the source)"),
      target_project_name: z
        .string()
        .describe(
          "Project name to clone INTO. Use the EXACT project name from Percy dashboard. If project doesn't exist, a new one is created.",
        ),
      target_token: z
        .string()
        .optional()
        .describe(
          "Percy token for the TARGET project. Use this to clone into an existing project without creating a new one. Get it from project settings.",
        ),
      source_token: z
        .string()
        .optional()
        .describe(
          "Percy token for reading the source build (if different from PERCY_TOKEN). Must be a full-access web_* or auto_* token.",
        ),
      branch: z
        .string()
        .optional()
        .describe("Branch for the new build (auto-detected from git)"),
      commit_sha: z
        .string()
        .optional()
        .describe("Commit SHA for the new build (auto-detected from git)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_clone_build",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCloneBuild(args, config);
      } catch (error) {
        return handleMCPError("percy_clone_build", server, config, error);
      }
    },
  );

  // =========================================================================
  // === READ ===
  // =========================================================================

  // -------------------------------------------------------------------------
  // percy_list_projects
  // -------------------------------------------------------------------------
  tools.percy_list_projects = server.tool(
    "percy_list_projects",
    "List all Percy projects in your organization.",
    {
      org_id: z
        .string()
        .optional()
        .describe("Percy organization ID. If not provided, uses token scope."),
      search: z
        .string()
        .optional()
        .describe("Filter projects by name (substring match)"),
      limit: z.number().optional().describe("Max results (default 10, max 50)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_list_projects",
          server.server.getClientVersion()!,
          config,
        );
        return await percyListProjects(args, config);
      } catch (error) {
        return handleMCPError("percy_list_projects", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_list_builds
  // -------------------------------------------------------------------------
  tools.percy_list_builds = server.tool(
    "percy_list_builds",
    "List Percy builds with filters (branch, state, SHA, tags).",
    {
      project_id: z
        .string()
        .optional()
        .describe("Percy project ID. If not provided, uses PERCY_TOKEN scope."),
      branch: z.string().optional().describe("Filter by branch name"),
      state: z
        .string()
        .optional()
        .describe("Filter by state: pending, processing, finished, failed"),
      sha: z.string().optional().describe("Filter by commit SHA"),
      limit: z.number().optional().describe("Max results (default 10, max 30)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_list_builds",
          server.server.getClientVersion()!,
          config,
        );
        return await percyListBuilds(args, config);
      } catch (error) {
        return handleMCPError("percy_list_builds", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_build
  // -------------------------------------------------------------------------
  tools.percy_get_build = server.tool(
    "percy_get_build",
    "Get full Percy build details: state, snapshots, AI metrics, summary.",
    {
      build_id: z.string().describe("Percy build ID"),
    },
    async (args) => {
      try {
        trackMCP("percy_get_build", server.server.getClientVersion()!, config);
        return await percyGetBuild(args, config);
      } catch (error) {
        return handleMCPError("percy_get_build", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_build_items
  // -------------------------------------------------------------------------
  tools.percy_get_build_items = server.tool(
    "percy_get_build_items",
    "List snapshots in a build by category: changed, new, removed, unchanged, failed.",
    {
      build_id: z.string().describe("Percy build ID"),
      category: z
        .string()
        .optional()
        .describe("Filter category: changed, new, removed, unchanged, failed"),
      sort_by: z
        .string()
        .optional()
        .describe("Sort field (e.g. diff-ratio, name)"),
      limit: z
        .number()
        .optional()
        .describe("Max results (default 20, max 100)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_build_items",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetBuildItems(args, config);
      } catch (error) {
        return handleMCPError("percy_get_build_items", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_snapshot
  // -------------------------------------------------------------------------
  tools.percy_get_snapshot = server.tool(
    "percy_get_snapshot",
    "Get snapshot with all comparisons, screenshots, and diff data.",
    {
      snapshot_id: z.string().describe("Percy snapshot ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_snapshot",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetSnapshot(args, config);
      } catch (error) {
        return handleMCPError("percy_get_snapshot", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_comparison
  // -------------------------------------------------------------------------
  tools.percy_get_comparison = server.tool(
    "percy_get_comparison",
    "Get comparison details: diff ratio, AI analysis, screenshot URLs.",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
      include_images: z
        .boolean()
        .optional()
        .describe("Include screenshot image URLs in response (default false)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_comparison",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetComparison(args, config);
      } catch (error) {
        return handleMCPError("percy_get_comparison", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_ai_analysis
  // -------------------------------------------------------------------------
  tools.percy_get_ai_analysis = server.tool(
    "percy_get_ai_analysis",
    "Get AI visual diff analysis: change types, bug classifications, diff reduction.",
    {
      comparison_id: z
        .string()
        .optional()
        .describe("Get AI analysis for a single comparison"),
      build_id: z
        .string()
        .optional()
        .describe("Get aggregated AI analysis for an entire build"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_ai_analysis",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetAiAnalysis(args, config);
      } catch (error) {
        return handleMCPError("percy_get_ai_analysis", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_build_summary
  // -------------------------------------------------------------------------
  tools.percy_get_build_summary = server.tool(
    "percy_get_build_summary",
    "Get AI-generated natural language summary of all visual changes.",
    {
      build_id: z.string().describe("Percy build ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_build_summary",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetBuildSummary(args, config);
      } catch (error) {
        return handleMCPError("percy_get_build_summary", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_ai_quota
  // -------------------------------------------------------------------------
  tools.percy_get_ai_quota = server.tool(
    "percy_get_ai_quota",
    "Check AI regeneration quota: daily usage and limits.",
    {},
    async () => {
      try {
        trackMCP(
          "percy_get_ai_quota",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetAiQuota({}, config);
      } catch (error) {
        return handleMCPError("percy_get_ai_quota", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_rca
  // -------------------------------------------------------------------------
  tools.percy_get_rca = server.tool(
    "percy_get_rca",
    "Get Root Cause Analysis: maps visual diffs to DOM/CSS changes.",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
      trigger_if_missing: z
        .boolean()
        .optional()
        .describe("Auto-trigger RCA if not yet run (default true)"),
    },
    async (args) => {
      try {
        trackMCP("percy_get_rca", server.server.getClientVersion()!, config);
        return await percyGetRca(args, config);
      } catch (error) {
        return handleMCPError("percy_get_rca", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_suggestions
  // -------------------------------------------------------------------------
  tools.percy_get_suggestions = server.tool(
    "percy_get_suggestions",
    "Get build failure diagnostics: categorized issues with fix steps.",
    {
      build_id: z.string().describe("Percy build ID"),
      reference_type: z
        .string()
        .optional()
        .describe("Filter: build, snapshot, or comparison"),
      reference_id: z
        .string()
        .optional()
        .describe("Specific snapshot or comparison ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_suggestions",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetSuggestions(args, config);
      } catch (error) {
        return handleMCPError("percy_get_suggestions", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_network_logs
  // -------------------------------------------------------------------------
  tools.percy_get_network_logs = server.tool(
    "percy_get_network_logs",
    "Get network request logs: per-URL status comparison (base vs head).",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_network_logs",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetNetworkLogs(args, config);
      } catch (error) {
        return handleMCPError("percy_get_network_logs", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_build_logs
  // -------------------------------------------------------------------------
  tools.percy_get_build_logs = server.tool(
    "percy_get_build_logs",
    "Get raw build logs (CLI, renderer, proxy) with level filtering.",
    {
      build_id: z.string().describe("Percy build ID"),
      service: z
        .string()
        .optional()
        .describe("Filter by service: cli, renderer, jackproxy"),
      reference_type: z
        .string()
        .optional()
        .describe("Reference scope: build, snapshot, comparison"),
      reference_id: z
        .string()
        .optional()
        .describe("Specific snapshot or comparison ID"),
      level: z
        .string()
        .optional()
        .describe("Filter by log level: error, warn, info, debug"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_build_logs",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetBuildLogs(args, config);
      } catch (error) {
        return handleMCPError("percy_get_build_logs", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_usage_stats
  // -------------------------------------------------------------------------
  tools.percy_get_usage_stats = server.tool(
    "percy_get_usage_stats",
    "Get organization usage: screenshot counts, quotas, AI comparisons.",
    {
      org_id: z.string().describe("Percy organization ID"),
      product: z
        .string()
        .optional()
        .describe("Filter by product type (e.g., 'percy', 'app_percy')"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_usage_stats",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetUsageStats(args, config);
      } catch (error) {
        return handleMCPError("percy_get_usage_stats", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_auth_status
  // -------------------------------------------------------------------------
  tools.percy_auth_status = server.tool(
    "percy_auth_status",
    "Check Percy auth: which tokens are set, validated, and their scope.",
    {},
    async () => {
      try {
        trackMCP(
          "percy_auth_status",
          server.server.getClientVersion()!,
          config,
        );
        return await percyAuthStatus({}, config);
      } catch (error) {
        return handleMCPError("percy_auth_status", server, config, error);
      }
    },
  );

  // =========================================================================
  // === UPDATE ===
  // =========================================================================

  // -------------------------------------------------------------------------
  // percy_approve_build
  // -------------------------------------------------------------------------
  tools.percy_approve_build = server.tool(
    "percy_approve_build",
    "Approve, reject, or request changes on a Percy build.",
    {
      build_id: z.string().describe("Percy build ID to review"),
      action: z
        .enum(["approve", "request_changes", "unapprove", "reject"])
        .describe("Review action"),
      snapshot_ids: z
        .string()
        .optional()
        .describe(
          "Comma-separated snapshot IDs (required for request_changes)",
        ),
      reason: z
        .string()
        .optional()
        .describe("Optional reason for the review action"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_approve_build",
          server.server.getClientVersion()!,
          config,
        );
        return await percyApproveBuild(args, config);
      } catch (error) {
        return handleMCPError("percy_approve_build", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_manage_project_settings
  // -------------------------------------------------------------------------
  tools.percy_manage_project_settings = server.tool(
    "percy_manage_project_settings",
    "Update Percy project settings: diff sensitivity, auto-approve, IntelliIgnore.",
    {
      project_id: z.string().describe("Percy project ID"),
      settings: z
        .string()
        .optional()
        .describe(
          'JSON string of attributes to update, e.g. \'{"diff-sensitivity":0.1,"auto-approve-branch-filter":"main"}\'',
        ),
      confirm_destructive: z
        .boolean()
        .optional()
        .describe(
          "Set to true to confirm high-risk changes (auto-approve/approval-required branch filters)",
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_manage_project_settings",
          server.server.getClientVersion()!,
          config,
        );
        return await percyManageProjectSettings(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_manage_project_settings",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_manage_browser_targets
  // -------------------------------------------------------------------------
  tools.percy_manage_browser_targets = server.tool(
    "percy_manage_browser_targets",
    "Add or remove browser targets (Chrome, Firefox, Safari, Edge).",
    {
      project_id: z.string().describe("Percy project ID"),
      action: z
        .enum(["list", "add", "remove"])
        .optional()
        .describe("Action to perform (default: list)"),
      browser_family: z
        .string()
        .optional()
        .describe(
          "Browser family ID to add or project-browser-target ID to remove",
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_manage_browser_targets",
          server.server.getClientVersion()!,
          config,
        );
        return await percyManageBrowserTargets(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_manage_browser_targets",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_manage_tokens
  // -------------------------------------------------------------------------
  tools.percy_manage_tokens = server.tool(
    "percy_manage_tokens",
    "View (masked) or rotate Percy project tokens.",
    {
      project_id: z.string().describe("Percy project ID"),
      action: z
        .enum(["list", "rotate"])
        .optional()
        .describe("Action to perform (default: list)"),
      role: z
        .string()
        .optional()
        .describe("Token role for rotation (e.g., 'write', 'read')"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_manage_tokens",
          server.server.getClientVersion()!,
          config,
        );
        return await percyManageTokens(args, config);
      } catch (error) {
        return handleMCPError("percy_manage_tokens", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_manage_webhooks
  // -------------------------------------------------------------------------
  tools.percy_manage_webhooks = server.tool(
    "percy_manage_webhooks",
    "Create, update, or delete webhooks for build events.",
    {
      project_id: z.string().describe("Percy project ID"),
      action: z
        .enum(["list", "create", "update", "delete"])
        .optional()
        .describe("Action to perform (default: list)"),
      webhook_id: z
        .string()
        .optional()
        .describe("Webhook ID (required for update/delete)"),
      url: z.string().optional().describe("Webhook URL (required for create)"),
      events: z
        .string()
        .optional()
        .describe(
          "Comma-separated event types, e.g. 'build:finished,build:failed'",
        ),
      description: z
        .string()
        .optional()
        .describe("Human-readable webhook description"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_manage_webhooks",
          server.server.getClientVersion()!,
          config,
        );
        return await percyManageWebhooks(args, config);
      } catch (error) {
        return handleMCPError("percy_manage_webhooks", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_manage_ignored_regions
  // -------------------------------------------------------------------------
  tools.percy_manage_ignored_regions = server.tool(
    "percy_manage_ignored_regions",
    "Create, save, or delete ignored regions on comparisons.",
    {
      comparison_id: z
        .string()
        .optional()
        .describe("Percy comparison ID (required for list/create)"),
      action: z
        .enum(["list", "create", "save", "delete"])
        .optional()
        .describe("Action to perform (default: list)"),
      region_id: z
        .string()
        .optional()
        .describe("Region revision ID (required for delete)"),
      type: z
        .string()
        .optional()
        .describe("Region type: raw, xpath, css, full_page"),
      coordinates: z
        .string()
        .optional()
        .describe(
          'JSON bounding box for raw type: {"x":0,"y":0,"width":100,"height":100}',
        ),
      selector: z.string().optional().describe("XPath or CSS selector string"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_manage_ignored_regions",
          server.server.getClientVersion()!,
          config,
        );
        return await percyManageIgnoredRegions(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_manage_ignored_regions",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_manage_comments
  // -------------------------------------------------------------------------
  tools.percy_manage_comments = server.tool(
    "percy_manage_comments",
    "Create or close comment threads on snapshots.",
    {
      build_id: z
        .string()
        .optional()
        .describe("Percy build ID (required for list)"),
      snapshot_id: z
        .string()
        .optional()
        .describe("Percy snapshot ID (required for create)"),
      action: z
        .enum(["list", "create", "close"])
        .optional()
        .describe("Action to perform (default: list)"),
      thread_id: z
        .string()
        .optional()
        .describe("Comment thread ID (required for close)"),
      body: z
        .string()
        .optional()
        .describe("Comment body text (required for create)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_manage_comments",
          server.server.getClientVersion()!,
          config,
        );
        return await percyManageComments(args, config);
      } catch (error) {
        return handleMCPError("percy_manage_comments", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_manage_variants
  // -------------------------------------------------------------------------
  tools.percy_manage_variants = server.tool(
    "percy_manage_variants",
    "Create or update A/B testing variants.",
    {
      comparison_id: z
        .string()
        .optional()
        .describe("Percy comparison ID (required for list)"),
      snapshot_id: z
        .string()
        .optional()
        .describe("Percy snapshot ID (required for create)"),
      action: z
        .enum(["list", "create", "update"])
        .optional()
        .describe("Action to perform (default: list)"),
      variant_id: z
        .string()
        .optional()
        .describe("Variant ID (required for update)"),
      name: z
        .string()
        .optional()
        .describe("Variant name (required for create)"),
      state: z.string().optional().describe("Variant state (for update)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_manage_variants",
          server.server.getClientVersion()!,
          config,
        );
        return await percyManageVariants(args, config);
      } catch (error) {
        return handleMCPError("percy_manage_variants", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_manage_visual_monitoring
  // -------------------------------------------------------------------------
  tools.percy_manage_visual_monitoring = server.tool(
    "percy_manage_visual_monitoring",
    "Create or update Visual Monitoring projects.",
    {
      org_id: z
        .string()
        .optional()
        .describe("Percy organization ID (required for list/create)"),
      project_id: z
        .string()
        .optional()
        .describe("Visual Monitoring project ID (required for update)"),
      action: z
        .enum(["list", "create", "update"])
        .optional()
        .describe("Action to perform (default: list)"),
      urls: z
        .string()
        .optional()
        .describe(
          "Comma-separated URLs to monitor, e.g. 'https://example.com,https://example.com/about'",
        ),
      cron: z
        .string()
        .optional()
        .describe(
          "Cron expression for monitoring schedule, e.g. '0 */6 * * *'",
        ),
      schedule: z
        .boolean()
        .optional()
        .describe("Enable or disable the monitoring schedule"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_manage_visual_monitoring",
          server.server.getClientVersion()!,
          config,
        );
        return await percyManageVisualMonitoring(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_manage_visual_monitoring",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_trigger_ai_recompute
  // -------------------------------------------------------------------------
  tools.percy_trigger_ai_recompute = server.tool(
    "percy_trigger_ai_recompute",
    "Re-run AI analysis with a custom prompt.",
    {
      build_id: z
        .string()
        .optional()
        .describe("Percy build ID (for bulk recompute)"),
      comparison_id: z
        .string()
        .optional()
        .describe("Single comparison ID to recompute"),
      prompt: z
        .string()
        .optional()
        .describe(
          "Custom prompt for AI (max 400 chars), e.g. 'Ignore font rendering differences'",
        ),
      mode: z
        .enum(["ignore", "unignore"])
        .optional()
        .describe(
          "ignore = hide matching diffs, unignore = show matching diffs",
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_trigger_ai_recompute",
          server.server.getClientVersion()!,
          config,
        );
        return await percyTriggerAiRecompute(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_trigger_ai_recompute",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_suggest_prompt
  // -------------------------------------------------------------------------
  tools.percy_suggest_prompt = server.tool(
    "percy_suggest_prompt",
    "Get AI-suggested prompt for specific diff regions.",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
      region_ids: z.string().describe("Comma-separated region IDs to analyze"),
      ignore_change: z
        .boolean()
        .optional()
        .describe(
          "true = suggest ignore prompt, false = suggest show prompt (default true)",
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_suggest_prompt",
          server.server.getClientVersion()!,
          config,
        );
        return await percySuggestPrompt(args, config);
      } catch (error) {
        return handleMCPError("percy_suggest_prompt", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_branchline_operations
  // -------------------------------------------------------------------------
  tools.percy_branchline_operations = server.tool(
    "percy_branchline_operations",
    "Sync, merge, or unmerge branch baselines.",
    {
      action: z
        .enum(["sync", "merge", "unmerge"])
        .describe("Branchline operation to perform"),
      project_id: z.string().optional().describe("Percy project ID"),
      build_id: z.string().optional().describe("Percy build ID"),
      target_branch_filter: z
        .string()
        .optional()
        .describe("Target branch pattern for sync (e.g., 'main', 'release/*')"),
      snapshot_ids: z
        .string()
        .optional()
        .describe("Comma-separated snapshot IDs to include"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_branchline_operations",
          server.server.getClientVersion()!,
          config,
        );
        return await percyBranchlineOperations(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_branchline_operations",
          server,
          config,
          error,
        );
      }
    },
  );

  // =========================================================================
  // === FINALIZE / UPLOAD ===
  // =========================================================================

  // -------------------------------------------------------------------------
  // percy_finalize_build
  // -------------------------------------------------------------------------
  tools.percy_finalize_build = server.tool(
    "percy_finalize_build",
    "Finalize a Percy build (triggers processing).",
    {
      build_id: z.string().describe("Percy build ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_finalize_build",
          server.server.getClientVersion()!,
          config,
        );
        return await percyFinalizeBuild(args, config);
      } catch (error) {
        return handleMCPError("percy_finalize_build", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_finalize_snapshot
  // -------------------------------------------------------------------------
  tools.percy_finalize_snapshot = server.tool(
    "percy_finalize_snapshot",
    "Finalize a snapshot (triggers rendering).",
    {
      snapshot_id: z.string().describe("Percy snapshot ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_finalize_snapshot",
          server.server.getClientVersion()!,
          config,
        );
        return await percyFinalizeSnapshot(args, config);
      } catch (error) {
        return handleMCPError("percy_finalize_snapshot", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_finalize_comparison
  // -------------------------------------------------------------------------
  tools.percy_finalize_comparison = server.tool(
    "percy_finalize_comparison",
    "Finalize a comparison (triggers diff processing).",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_finalize_comparison",
          server.server.getClientVersion()!,
          config,
        );
        return await percyFinalizeComparison(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_finalize_comparison",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_upload_resource
  // -------------------------------------------------------------------------
  tools.percy_upload_resource = server.tool(
    "percy_upload_resource",
    "Upload a resource to a Percy build (CSS, JS, HTML, images).",
    {
      build_id: z.string().describe("Percy build ID"),
      sha: z.string().describe("SHA-256 hash of the resource content"),
      base64_content: z.string().describe("Base64-encoded resource content"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_upload_resource",
          server.server.getClientVersion()!,
          config,
        );
        return await percyUploadResource(args, config);
      } catch (error) {
        return handleMCPError("percy_upload_resource", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_upload_tile
  // -------------------------------------------------------------------------
  tools.percy_upload_tile = server.tool(
    "percy_upload_tile",
    "Upload a screenshot tile to a comparison (PNG/JPEG).",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
      base64_content: z
        .string()
        .describe("Base64-encoded PNG or JPEG screenshot"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_upload_tile",
          server.server.getClientVersion()!,
          config,
        );
        return await percyUploadTile(args, config);
      } catch (error) {
        return handleMCPError("percy_upload_tile", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_analyze_logs_realtime
  // -------------------------------------------------------------------------
  tools.percy_analyze_logs_realtime = server.tool(
    "percy_analyze_logs_realtime",
    "Analyze raw logs in real-time without a stored build.",
    {
      logs: z
        .string()
        .describe(
          'JSON array of log entries: [{"message":"...","level":"error","meta":{}}]',
        ),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_analyze_logs_realtime",
          server.server.getClientVersion()!,
          config,
        );
        return await percyAnalyzeLogsRealtime(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_analyze_logs_realtime",
          server,
          config,
          error,
        );
      }
    },
  );

  // =========================================================================
  // === WORKFLOWS (Composite — highest value) ===
  // =========================================================================

  // -------------------------------------------------------------------------
  // percy_pr_visual_report
  // -------------------------------------------------------------------------
  tools.percy_pr_visual_report = server.tool(
    "percy_pr_visual_report",
    "Get a complete PR visual regression report: risk-ranked changes with AI analysis and recommendations. THE tool for checking PR status.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Percy project ID (optional if PERCY_TOKEN is project-scoped)",
        ),
      branch: z
        .string()
        .optional()
        .describe("Git branch name to find the build"),
      sha: z.string().optional().describe("Git commit SHA to find the build"),
      build_id: z
        .string()
        .optional()
        .describe("Direct Percy build ID (skips search)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_pr_visual_report",
          server.server.getClientVersion()!,
          config,
        );
        return await percyPrVisualReport(args, config);
      } catch (error) {
        return handleMCPError("percy_pr_visual_report", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_auto_triage
  // -------------------------------------------------------------------------
  tools.percy_auto_triage = server.tool(
    "percy_auto_triage",
    "Auto-categorize all visual changes: Critical, Review Required, Auto-Approvable, Noise.",
    {
      build_id: z.string().describe("Percy build ID"),
      noise_threshold: z
        .number()
        .optional()
        .describe("Diff ratio below this is noise (default 0.005 = 0.5%)"),
      review_threshold: z
        .number()
        .optional()
        .describe("Diff ratio above this needs review (default 0.15 = 15%)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_auto_triage",
          server.server.getClientVersion()!,
          config,
        );
        return await percyAutoTriage(args, config);
      } catch (error) {
        return handleMCPError("percy_auto_triage", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_debug_failed_build
  // -------------------------------------------------------------------------
  tools.percy_debug_failed_build = server.tool(
    "percy_debug_failed_build",
    "Diagnose a failed build: cross-references logs, suggestions, and network issues with fix commands.",
    {
      build_id: z.string().describe("Percy build ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_debug_failed_build",
          server.server.getClientVersion()!,
          config,
        );
        return await percyDebugFailedBuild(args, config);
      } catch (error) {
        return handleMCPError(
          "percy_debug_failed_build",
          server,
          config,
          error,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_diff_explain
  // -------------------------------------------------------------------------
  tools.percy_diff_explain = server.tool(
    "percy_diff_explain",
    "Explain visual changes in plain English at 3 depth levels (summary/detailed/full_rca).",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
      depth: z
        .enum(["summary", "detailed", "full_rca"])
        .optional()
        .describe("Analysis depth (default: detailed)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_diff_explain",
          server.server.getClientVersion()!,
          config,
        );
        return await percyDiffExplain(args, config);
      } catch (error) {
        return handleMCPError("percy_diff_explain", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_snapshot_urls — Actually render URLs locally via Percy CLI
  // -------------------------------------------------------------------------
  tools.percy_snapshot_urls = server.tool(
    "percy_snapshot_urls",
    "Snapshot URLs locally using Percy CLI. Launches a browser, captures screenshots at specified widths, and uploads to Percy. Runs in background — returns build URL immediately. Requires @percy/cli installed.",
    {
      project_name: z
        .string()
        .describe("Percy project name (auto-creates if doesn't exist)"),
      urls: z
        .string()
        .describe(
          "Comma-separated URLs to snapshot, e.g. 'http://localhost:3000,http://localhost:3000/about'",
        ),
      widths: z
        .string()
        .optional()
        .describe("Comma-separated widths (default: 375,1280)"),
      type: z.string().optional().describe("Project type: web or automate"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_snapshot_urls",
          server.server.getClientVersion()!,
          config,
        );
        return await percySnapshotUrls(args, config);
      } catch (error) {
        return handleMCPError("percy_snapshot_urls", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_run_tests — Run tests with Percy visual testing
  // -------------------------------------------------------------------------
  tools.percy_run_tests = server.tool(
    "percy_run_tests",
    "Run a test command with Percy visual testing. Wraps your test command with percy exec to capture snapshots during test execution. Runs in background — returns build URL immediately. Requires @percy/cli installed.",
    {
      project_name: z
        .string()
        .describe("Percy project name (auto-creates if doesn't exist)"),
      test_command: z
        .string()
        .describe("Test command to run, e.g. 'npx cypress run' or 'npm test'"),
      type: z.string().optional().describe("Project type: web or automate"),
    },
    async (args) => {
      try {
        trackMCP("percy_run_tests", server.server.getClientVersion()!, config);
        return await percyRunTests(args, config);
      } catch (error) {
        return handleMCPError("percy_run_tests", server, config, error);
      }
    },
  );

  return tools;
}

export default registerPercyMcpTools;
