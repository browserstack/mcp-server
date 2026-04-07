/**
 * Percy MCP Tools v2 — Simplified, production-ready tools.
 *
 * Key changes from v1:
 * - ALL read operations use BrowserStack Basic Auth (not Percy Token)
 * - Fewer, more powerful tools (quality > quantity)
 * - Every tool tested against real Percy API
 *
 * Tools:
 *   percy_create_project    — Create/get a Percy project
 *   percy_create_build      — Create build (URL snapshot / screenshot upload / test wrap)
 *   percy_get_projects      — List projects
 *   percy_get_builds        — List builds with filters
 *   percy_approve_build     — Approve/reject builds
 *   percy_clone_build       — Clone across projects
 *   percy_auth_status       — Check auth
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

  return tools;
}

export default registerPercyMcpToolsV2;
