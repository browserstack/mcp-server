/**
 * Percy MCP tools — query and creation tools for Percy visual testing.
 *
 * Registers 23 tools:
 *   Query: percy_list_projects, percy_list_builds, percy_get_build,
 *          percy_get_build_items, percy_get_snapshot, percy_get_comparison
 *   Web Creation: percy_create_build, percy_create_snapshot, percy_upload_resource,
 *                 percy_finalize_snapshot, percy_finalize_build
 *   App/BYOS Creation: percy_create_app_snapshot, percy_create_comparison,
 *                      percy_upload_tile, percy_finalize_comparison
 *   Intelligence: percy_get_ai_analysis, percy_get_build_summary, percy_get_ai_quota,
 *                 percy_get_rca
 *   Diagnostics: percy_get_suggestions, percy_get_network_logs
 *   Workflows: percy_pr_visual_report, percy_auto_triage, percy_debug_failed_build,
 *              percy_diff_explain
 *   Auth: percy_auth_status
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

import { percyGetSuggestions } from "./diagnostics/get-suggestions.js";
import { percyGetNetworkLogs } from "./diagnostics/get-network-logs.js";

import { percyPrVisualReport } from "./workflows/pr-visual-report.js";
import { percyAutoTriage } from "./workflows/auto-triage.js";
import { percyDebugFailedBuild } from "./workflows/debug-failed-build.js";
import { percyDiffExplain } from "./workflows/diff-explain.js";

import { percyAuthStatus } from "./auth/auth-status.js";

export function registerPercyMcpTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  // -------------------------------------------------------------------------
  // percy_list_projects
  // -------------------------------------------------------------------------
  tools.percy_list_projects = server.tool(
    "percy_list_projects",
    "List Percy projects in an organization. Returns project names, types, and settings.",
    {
      org_id: z
        .string()
        .optional()
        .describe("Percy organization ID. If not provided, uses token scope."),
      search: z
        .string()
        .optional()
        .describe("Filter projects by name (substring match)"),
      limit: z
        .number()
        .optional()
        .describe("Max results (default 10, max 50)"),
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
    "List Percy builds for a project with filtering by branch, state, SHA. Returns build numbers, states, review status, and AI metrics.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Percy project ID. If not provided, uses PERCY_TOKEN scope.",
        ),
      branch: z.string().optional().describe("Filter by branch name"),
      state: z
        .string()
        .optional()
        .describe(
          "Filter by state: pending, processing, finished, failed",
        ),
      sha: z.string().optional().describe("Filter by commit SHA"),
      limit: z
        .number()
        .optional()
        .describe("Max results (default 10, max 30)"),
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
    "Get detailed Percy build information including state, review status, snapshot counts, AI analysis metrics, and build summary.",
    {
      build_id: z.string().describe("Percy build ID"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_build",
          server.server.getClientVersion()!,
          config,
        );
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
    "List snapshots in a Percy build filtered by category (changed/new/removed/unchanged/failed). Returns snapshot names with diff ratios and AI flags.",
    {
      build_id: z.string().describe("Percy build ID"),
      category: z
        .string()
        .optional()
        .describe(
          "Filter category: changed, new, removed, unchanged, failed",
        ),
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
    "Get a Percy snapshot with all its comparisons, screenshots, and diff data across browsers and widths.",
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
    "Get detailed Percy comparison data including diff ratios, AI analysis regions, screenshot URLs, and browser info.",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
      include_images: z
        .boolean()
        .optional()
        .describe(
          "Include screenshot image URLs in response (default false)",
        ),
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
  // percy_approve_build
  // -------------------------------------------------------------------------
  tools.percy_approve_build = server.tool(
    "percy_approve_build",
    "Approve, request changes, unapprove, or reject a Percy build. Requires a user token (PERCY_TOKEN). request_changes works at snapshot level only.",
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
  // percy_create_build
  // -------------------------------------------------------------------------
  tools.percy_create_build = server.tool(
    "percy_create_build",
    "Create a new Percy build for visual testing. Returns build ID for snapshot uploads.",
    {
      project_id: z.string().describe("Percy project ID"),
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
    "Create a snapshot in a Percy build with DOM resources. Returns missing resource list for upload.",
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
  // percy_upload_resource
  // -------------------------------------------------------------------------
  tools.percy_upload_resource = server.tool(
    "percy_upload_resource",
    "Upload a resource (CSS, JS, image, HTML) to a Percy build. Only upload resources the server doesn't have.",
    {
      build_id: z.string().describe("Percy build ID"),
      sha: z.string().describe("SHA-256 hash of the resource content"),
      base64_content: z
        .string()
        .describe("Base64-encoded resource content"),
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
  // percy_finalize_snapshot
  // -------------------------------------------------------------------------
  tools.percy_finalize_snapshot = server.tool(
    "percy_finalize_snapshot",
    "Finalize a Percy snapshot after all resources are uploaded. Triggers rendering.",
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
  // percy_finalize_build
  // -------------------------------------------------------------------------
  tools.percy_finalize_build = server.tool(
    "percy_finalize_build",
    "Finalize a Percy build after all snapshots are complete. Triggers processing.",
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
  // percy_create_app_snapshot
  // -------------------------------------------------------------------------
  tools.percy_create_app_snapshot = server.tool(
    "percy_create_app_snapshot",
    "Create a snapshot for App Percy or BYOS builds (no resources needed). Returns snapshot ID.",
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
        return handleMCPError("percy_create_app_snapshot", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_create_comparison
  // -------------------------------------------------------------------------
  tools.percy_create_comparison = server.tool(
    "percy_create_comparison",
    "Create a comparison with device/browser tag and tile metadata for screenshot-based builds.",
    {
      snapshot_id: z.string().describe("Percy snapshot ID"),
      tag_name: z
        .string()
        .describe("Device/browser name, e.g. 'iPhone 13'"),
      tag_width: z.number().describe("Tag width in pixels"),
      tag_height: z.number().describe("Tag height in pixels"),
      tag_os_name: z.string().optional().describe("OS name, e.g. 'iOS'"),
      tag_os_version: z
        .string()
        .optional()
        .describe("OS version, e.g. '16.0'"),
      tag_browser_name: z
        .string()
        .optional()
        .describe("Browser name, e.g. 'Safari'"),
      tag_orientation: z
        .string()
        .optional()
        .describe("portrait or landscape"),
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
  // percy_upload_tile
  // -------------------------------------------------------------------------
  tools.percy_upload_tile = server.tool(
    "percy_upload_tile",
    "Upload a screenshot tile (PNG or JPEG) to a Percy comparison.",
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
  // percy_finalize_comparison
  // -------------------------------------------------------------------------
  tools.percy_finalize_comparison = server.tool(
    "percy_finalize_comparison",
    "Finalize a Percy comparison after all tiles are uploaded. Triggers diff processing.",
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
        return handleMCPError("percy_finalize_comparison", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_get_ai_analysis
  // -------------------------------------------------------------------------
  tools.percy_get_ai_analysis = server.tool(
    "percy_get_ai_analysis",
    "Get Percy AI-powered visual diff analysis. Provides change types, descriptions, bug classifications, and diff reduction metrics per comparison or aggregated per build.",
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
    "Get AI-generated natural language summary of all visual changes in a Percy build.",
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
    "Check Percy AI quota status — daily regeneration quota and usage.",
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
    "Trigger and retrieve Percy Root Cause Analysis — maps visual diffs back to specific DOM/CSS changes with XPath paths and attribute diffs.",
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
    "Get Percy build failure suggestions — rule-engine-analyzed diagnostics with categorized issues, actionable fix steps, and documentation links.",
    {
      build_id: z.string().describe("Percy build ID"),
      reference_type: z.string().optional().describe("Filter: build, snapshot, or comparison"),
      reference_id: z.string().optional().describe("Specific snapshot or comparison ID"),
    },
    async (args) => {
      try {
        trackMCP("percy_get_suggestions", server.server.getClientVersion()!, config);
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
    "Get parsed network request logs for a Percy comparison — shows per-URL status for base vs head, identifying which assets loaded, failed, or were cached.",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
    },
    async (args) => {
      try {
        trackMCP("percy_get_network_logs", server.server.getClientVersion()!, config);
        return await percyGetNetworkLogs(args, config);
      } catch (error) {
        return handleMCPError("percy_get_network_logs", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_pr_visual_report
  // -------------------------------------------------------------------------
  tools.percy_pr_visual_report = server.tool(
    "percy_pr_visual_report",
    "Get a complete visual regression report for a PR. Finds the Percy build by branch/SHA, ranks snapshots by risk, shows AI analysis, and recommends actions. The single best tool for checking visual status.",
    {
      project_id: z.string().optional().describe("Percy project ID (optional if PERCY_TOKEN is project-scoped)"),
      branch: z.string().optional().describe("Git branch name to find the build"),
      sha: z.string().optional().describe("Git commit SHA to find the build"),
      build_id: z.string().optional().describe("Direct Percy build ID (skips search)"),
    },
    async (args) => {
      try {
        trackMCP("percy_pr_visual_report", server.server.getClientVersion()!, config);
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
    "Automatically categorize all visual changes in a Percy build into Critical (bugs), Review Required, Auto-Approvable, and Noise. Helps prioritize visual review.",
    {
      build_id: z.string().describe("Percy build ID"),
      noise_threshold: z.number().optional().describe("Diff ratio below this is noise (default 0.005 = 0.5%)"),
      review_threshold: z.number().optional().describe("Diff ratio above this needs review (default 0.15 = 15%)"),
    },
    async (args) => {
      try {
        trackMCP("percy_auto_triage", server.server.getClientVersion()!, config);
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
    "Diagnose a Percy build failure. Cross-references error buckets, log analysis, failed snapshots, and network logs to provide actionable fix commands.",
    {
      build_id: z.string().describe("Percy build ID"),
    },
    async (args) => {
      try {
        trackMCP("percy_debug_failed_build", server.server.getClientVersion()!, config);
        return await percyDebugFailedBuild(args, config);
      } catch (error) {
        return handleMCPError("percy_debug_failed_build", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_diff_explain
  // -------------------------------------------------------------------------
  tools.percy_diff_explain = server.tool(
    "percy_diff_explain",
    "Explain visual changes in plain English. Supports depth levels: summary (AI descriptions), detailed (+ coordinates), full_rca (+ DOM/CSS changes with XPath).",
    {
      comparison_id: z.string().describe("Percy comparison ID"),
      depth: z.enum(["summary", "detailed", "full_rca"]).optional().describe("Analysis depth (default: detailed)"),
    },
    async (args) => {
      try {
        trackMCP("percy_diff_explain", server.server.getClientVersion()!, config);
        return await percyDiffExplain(args, config);
      } catch (error) {
        return handleMCPError("percy_diff_explain", server, config, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // percy_auth_status
  // -------------------------------------------------------------------------
  tools.percy_auth_status = server.tool(
    "percy_auth_status",
    "Check Percy authentication status — shows which tokens are configured, validates them, and reports project/org scope.",
    {},
    async () => {
      try {
        trackMCP("percy_auth_status", server.server.getClientVersion()!, config);
        return await percyAuthStatus({}, config);
      } catch (error) {
        return handleMCPError("percy_auth_status", server, config, error);
      }
    },
  );

  return tools;
}

export default registerPercyMcpTools;
