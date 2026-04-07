/**
 * Percy MCP Tools v2 — Simplified, production-ready tools.
 *
 * Key changes from v1:
 * - ALL read operations use BrowserStack Basic Auth (not Percy Token)
 * - Fewer, more powerful tools (quality > quantity)
 * - Every tool tested against real Percy API
 *
 * Tools (20 total):
 *   percy_create_project       — Create/get a Percy project
 *   percy_create_build         — Create build (URL snapshot / screenshot upload / test wrap)
 *   percy_get_projects         — List projects
 *   percy_get_builds           — List builds with filters
 *   percy_auth_status          — Check auth
 *   percy_figma_build          — Create build from Figma designs
 *   percy_figma_baseline       — Update Figma design baseline
 *   percy_figma_link           — Get Figma link for snapshot/comparison
 *   percy_get_insights         — Testing health metrics
 *   percy_manage_insights_email — Configure insights email recipients
 *   percy_get_test_cases       — List test cases for a project
 *   percy_get_test_case_history — Test case execution history
 *   percy_discover_urls        — Discover URLs from sitemaps
 *   percy_get_devices          — List browsers/devices/viewports
 *   percy_manage_domains       — Get/update allowed/error domains
 *   percy_manage_usage_alerts  — Configure usage alert thresholds
 *   percy_preview_comparison   — Trigger on-demand diff recomputation
 *   percy_search_builds        — Advanced build item search
 *   percy_list_integrations    — List org integrations
 *   percy_migrate_integrations — Migrate integrations between orgs
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { handleMCPError } from "../../../lib/utils.js";
import { trackMCP } from "../../../index.js";
import { z } from "zod";

import { percyCreateProjectV2 } from "./create-project.js";
import { percyGetProjectsV2 } from "./get-projects.js";
import { percyGetBuildsV2 } from "./get-builds.js";
import { percyCreateBuildV2 } from "./create-build.js";
import { percyAuthStatusV2 } from "./auth-status.js";
import { percyFigmaBuild } from "./figma-build.js";
import { percyFigmaBaseline } from "./figma-baseline.js";
import { percyFigmaLink } from "./figma-link.js";
import { percyGetInsights } from "./get-insights.js";
import { percyManageInsightsEmail } from "./manage-insights-email.js";
import { percyGetTestCases } from "./get-test-cases.js";
import { percyGetTestCaseHistory } from "./get-test-case-history.js";
import { percyDiscoverUrls } from "./discover-urls.js";
import { percyGetDevices } from "./get-devices.js";
import { percyManageDomains } from "./manage-domains.js";
import { percyManageUsageAlerts } from "./manage-usage-alerts.js";
import { percyPreviewComparison } from "./preview-comparison.js";
import { percySearchBuildItems } from "./search-build-items.js";
import { percyListIntegrations } from "./list-integrations.js";
import { percyMigrateIntegrations } from "./migrate-integrations.js";

export function registerPercyMcpToolsV2(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  // ── percy_create_project ────────────────────────────────────────────────
  tools.percy_create_project = server.tool(
    "percy_create_project",
    "Create a new Percy project (or get token for existing one). Returns project token for CLI use.",
    {
      name: z.string().describe("Project name"),
      type: z
        .enum(["web", "automate"])
        .optional()
        .describe("Project type (default: auto-detect)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_create_project",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCreateProjectV2(args, config);
      } catch (error) {
        return handleMCPError("percy_create_project", server, config, error);
      }
    },
  );

  // ── percy_create_build ──────────────────────────────────────────────────
  tools.percy_create_build = server.tool(
    "percy_create_build",
    "Create a Percy build with snapshots. Handles URL snapshotting (launches real browser), screenshot upload, and test command wrapping — all in one tool. Auto-creates project if needed, auto-detects git branch.",
    {
      project_name: z
        .string()
        .describe("Percy project name (auto-creates if doesn't exist)"),
      urls: z
        .string()
        .optional()
        .describe(
          "Comma-separated URLs to snapshot (e.g., 'http://localhost:3000,http://localhost:3000/about')",
        ),
      screenshots_dir: z
        .string()
        .optional()
        .describe("Directory path with PNG/JPG screenshots to upload"),
      screenshot_files: z
        .string()
        .optional()
        .describe("Comma-separated screenshot file paths"),
      test_command: z
        .string()
        .optional()
        .describe("Test command to wrap with Percy (e.g., 'npx cypress run')"),
      branch: z.string().optional().describe("Git branch (auto-detected)"),
      widths: z
        .string()
        .optional()
        .describe("Viewport widths (default: '375,1280')"),
      snapshot_names: z
        .string()
        .optional()
        .describe(
          "Custom snapshot names, comma-separated (e.g., 'Homepage,Login Page,Dashboard'). Maps 1:1 with urls or screenshot files.",
        ),
      test_case: z
        .string()
        .optional()
        .describe("Test case name to attach to all snapshots"),
      type: z.enum(["web", "automate"]).optional().describe("Project type"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_create_build",
          server.server.getClientVersion()!,
          config,
        );
        return await percyCreateBuildV2(args, config);
      } catch (error) {
        return handleMCPError("percy_create_build", server, config, error);
      }
    },
  );

  // ── percy_get_projects ──────────────────────────────────────────────────
  tools.percy_get_projects = server.tool(
    "percy_get_projects",
    "List all Percy projects in your organization.",
    {
      search: z.string().optional().describe("Search by project name"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async (args) => {
      try {
        trackMCP(
          "percy_get_projects",
          server.server.getClientVersion()!,
          config,
        );
        return await percyGetProjectsV2(args, config);
      } catch (error) {
        return handleMCPError("percy_get_projects", server, config, error);
      }
    },
  );

  // ── percy_get_builds ────────────────────────────────────────────────────
  tools.percy_get_builds = server.tool(
    "percy_get_builds",
    "List Percy builds. Provide project_slug (from percy_get_projects) to filter by project.",
    {
      project_slug: z
        .string()
        .optional()
        .describe(
          "Project slug from percy_get_projects (e.g., 'org-id/project-slug')",
        ),
      branch: z.string().optional().describe("Filter by branch"),
      state: z
        .string()
        .optional()
        .describe("Filter: pending, processing, finished, failed"),
      limit: z.number().optional().describe("Max results (default: 10)"),
    },
    async (args) => {
      try {
        trackMCP("percy_get_builds", server.server.getClientVersion()!, config);
        return await percyGetBuildsV2(args, config);
      } catch (error) {
        return handleMCPError("percy_get_builds", server, config, error);
      }
    },
  );

  // ── percy_auth_status ───────────────────────────────────────────────────
  tools.percy_auth_status = server.tool(
    "percy_auth_status",
    "Check Percy authentication — validates BrowserStack credentials and Percy API connectivity.",
    {},
    async () => {
      try {
        trackMCP(
          "percy_auth_status",
          server.server.getClientVersion()!,
          config,
        );
        return await percyAuthStatusV2({}, config);
      } catch (error) {
        return handleMCPError("percy_auth_status", server, config, error);
      }
    },
  );

  // ── Figma ─────────────────────────────────────────────────────────────────

  tools.percy_figma_build = server.tool(
    "percy_figma_build",
    "Create a Percy build from Figma design files. Extracts design nodes and creates visual comparisons.",
    {
      project_slug: z.string().describe("Project slug (e.g., 'org-id/project-slug')"),
      branch: z.string().describe("Branch name"),
      figma_url: z.string().describe("Figma file URL (e.g., 'https://www.figma.com/file/...')"),
    },
    async (args) => {
      try { trackMCP("percy_figma_build", server.server.getClientVersion()!, config); return await percyFigmaBuild(args, config); }
      catch (error) { return handleMCPError("percy_figma_build", server, config, error); }
    },
  );

  tools.percy_figma_baseline = server.tool(
    "percy_figma_baseline",
    "Update the Figma design baseline for a project. Uses the latest Figma designs as the new baseline.",
    {
      project_slug: z.string().describe("Project slug"),
      branch: z.string().describe("Branch name"),
      build_id: z.string().describe("Build ID to use as new baseline"),
    },
    async (args) => {
      try { trackMCP("percy_figma_baseline", server.server.getClientVersion()!, config); return await percyFigmaBaseline(args, config); }
      catch (error) { return handleMCPError("percy_figma_baseline", server, config, error); }
    },
  );

  tools.percy_figma_link = server.tool(
    "percy_figma_link",
    "Get the Figma design link for a snapshot or comparison.",
    {
      snapshot_id: z.string().optional().describe("Snapshot ID"),
      comparison_id: z.string().optional().describe("Comparison ID"),
    },
    async (args) => {
      try { trackMCP("percy_figma_link", server.server.getClientVersion()!, config); return await percyFigmaLink(args, config); }
      catch (error) { return handleMCPError("percy_figma_link", server, config, error); }
    },
  );

  // ── Insights ──────────────────────────────────────────────────────────────

  tools.percy_get_insights = server.tool(
    "percy_get_insights",
    "Get testing health metrics: review efficiency, ROI, coverage, change quality. By period and product.",
    {
      org_slug: z.string().describe("Organization slug"),
      period: z.enum(["last_7_days", "last_30_days", "last_90_days"]).optional().describe("Time period (default: last_30_days)"),
      product: z.enum(["web", "app"]).optional().describe("Product type (default: web)"),
    },
    async (args) => {
      try { trackMCP("percy_get_insights", server.server.getClientVersion()!, config); return await percyGetInsights(args, config); }
      catch (error) { return handleMCPError("percy_get_insights", server, config, error); }
    },
  );

  tools.percy_manage_insights_email = server.tool(
    "percy_manage_insights_email",
    "Configure weekly insights email recipients for an organization.",
    {
      org_id: z.string().describe("Organization ID"),
      action: z.enum(["get", "create", "update"]).optional().describe("Action (default: get)"),
      emails: z.string().optional().describe("Comma-separated email addresses"),
      enabled: z.boolean().optional().describe("Enable/disable emails"),
    },
    async (args) => {
      try { trackMCP("percy_manage_insights_email", server.server.getClientVersion()!, config); return await percyManageInsightsEmail(args, config); }
      catch (error) { return handleMCPError("percy_manage_insights_email", server, config, error); }
    },
  );

  // ── Test Cases ────────────────────────────────────────────────────────────

  tools.percy_get_test_cases = server.tool(
    "percy_get_test_cases",
    "List test cases for a project with optional execution details per build.",
    {
      project_id: z.string().describe("Project ID"),
      build_id: z.string().optional().describe("Build ID for execution details"),
    },
    async (args) => {
      try { trackMCP("percy_get_test_cases", server.server.getClientVersion()!, config); return await percyGetTestCases(args, config); }
      catch (error) { return handleMCPError("percy_get_test_cases", server, config, error); }
    },
  );

  tools.percy_get_test_case_history = server.tool(
    "percy_get_test_case_history",
    "Get full execution history of a test case across all builds.",
    {
      test_case_id: z.string().describe("Test case ID"),
    },
    async (args) => {
      try { trackMCP("percy_get_test_case_history", server.server.getClientVersion()!, config); return await percyGetTestCaseHistory(args, config); }
      catch (error) { return handleMCPError("percy_get_test_case_history", server, config, error); }
    },
  );

  // ── Discovery ─────────────────────────────────────────────────────────────

  tools.percy_discover_urls = server.tool(
    "percy_discover_urls",
    "Discover URLs from a sitemap for visual testing. Returns URLs to use with percy_create_build.",
    {
      project_id: z.string().describe("Project ID"),
      sitemap_url: z.string().optional().describe("Sitemap XML URL to crawl"),
      action: z.enum(["create", "list"]).optional().describe("create = crawl new sitemap, list = show existing"),
    },
    async (args) => {
      try { trackMCP("percy_discover_urls", server.server.getClientVersion()!, config); return await percyDiscoverUrls(args, config); }
      catch (error) { return handleMCPError("percy_discover_urls", server, config, error); }
    },
  );

  tools.percy_get_devices = server.tool(
    "percy_get_devices",
    "List available browsers, devices, and viewport details for visual testing.",
    {
      build_id: z.string().optional().describe("Build ID for device details"),
    },
    async (args) => {
      try { trackMCP("percy_get_devices", server.server.getClientVersion()!, config); return await percyGetDevices(args, config); }
      catch (error) { return handleMCPError("percy_get_devices", server, config, error); }
    },
  );

  // ── Configuration ─────────────────────────────────────────────────────────

  tools.percy_manage_domains = server.tool(
    "percy_manage_domains",
    "Get or update allowed/error domain lists for a project.",
    {
      project_id: z.string().describe("Project ID"),
      action: z.enum(["get", "update"]).optional().describe("Action (default: get)"),
      allowed_domains: z.string().optional().describe("Comma-separated allowed domains"),
      error_domains: z.string().optional().describe("Comma-separated error domains"),
    },
    async (args) => {
      try { trackMCP("percy_manage_domains", server.server.getClientVersion()!, config); return await percyManageDomains(args, config); }
      catch (error) { return handleMCPError("percy_manage_domains", server, config, error); }
    },
  );

  tools.percy_manage_usage_alerts = server.tool(
    "percy_manage_usage_alerts",
    "Configure usage alert thresholds for billing notifications.",
    {
      org_id: z.string().describe("Organization ID"),
      action: z.enum(["get", "create", "update"]).optional().describe("Action (default: get)"),
      threshold: z.number().optional().describe("Screenshot count threshold"),
      emails: z.string().optional().describe("Comma-separated email addresses"),
      enabled: z.boolean().optional().describe("Enable/disable alerts"),
      product: z.enum(["web", "app"]).optional().describe("Product type"),
    },
    async (args) => {
      try { trackMCP("percy_manage_usage_alerts", server.server.getClientVersion()!, config); return await percyManageUsageAlerts(args, config); }
      catch (error) { return handleMCPError("percy_manage_usage_alerts", server, config, error); }
    },
  );

  tools.percy_preview_comparison = server.tool(
    "percy_preview_comparison",
    "Trigger on-demand diff recomputation for a comparison without full rebuild.",
    {
      comparison_id: z.string().describe("Comparison ID to recompute"),
    },
    async (args) => {
      try { trackMCP("percy_preview_comparison", server.server.getClientVersion()!, config); return await percyPreviewComparison(args, config); }
      catch (error) { return handleMCPError("percy_preview_comparison", server, config, error); }
    },
  );

  // ── Advanced Search ───────────────────────────────────────────────────────

  tools.percy_search_builds = server.tool(
    "percy_search_builds",
    "Advanced build item search with filters: category, browser, width, OS, device, resolution, orientation.",
    {
      build_id: z.string().describe("Build ID to search within"),
      category: z.string().optional().describe("Filter: changed, new, removed, unchanged, failed"),
      browser_ids: z.string().optional().describe("Comma-separated browser IDs"),
      widths: z.string().optional().describe("Comma-separated widths"),
      os: z.string().optional().describe("Operating system filter"),
      device_name: z.string().optional().describe("Device name filter"),
      sort_by: z.string().optional().describe("Sort: diff_ratio or bug_count"),
      limit: z.number().optional().describe("Max results"),
    },
    async (args) => {
      try { trackMCP("percy_search_builds", server.server.getClientVersion()!, config); return await percySearchBuildItems(args, config); }
      catch (error) { return handleMCPError("percy_search_builds", server, config, error); }
    },
  );

  // ── Integrations ──────────────────────────────────────────────────────────

  tools.percy_list_integrations = server.tool(
    "percy_list_integrations",
    "List all integrations (VCS, Slack, Teams, Email) for an organization.",
    {
      org_id: z.string().describe("Organization ID"),
    },
    async (args) => {
      try { trackMCP("percy_list_integrations", server.server.getClientVersion()!, config); return await percyListIntegrations(args, config); }
      catch (error) { return handleMCPError("percy_list_integrations", server, config, error); }
    },
  );

  tools.percy_migrate_integrations = server.tool(
    "percy_migrate_integrations",
    "Migrate integrations between organizations.",
    {
      source_org_id: z.string().describe("Source organization ID"),
      target_org_id: z.string().describe("Target organization ID"),
    },
    async (args) => {
      try { trackMCP("percy_migrate_integrations", server.server.getClientVersion()!, config); return await percyMigrateIntegrations(args, config); }
      catch (error) { return handleMCPError("percy_migrate_integrations", server, config, error); }
    },
  );

  return tools;
}

export default registerPercyMcpToolsV2;
