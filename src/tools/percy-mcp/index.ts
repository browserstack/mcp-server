/**
 * Percy MCP query tools — read-only tools for querying Percy data.
 *
 * Registers 6 tools:
 *   percy_list_projects, percy_list_builds, percy_get_build,
 *   percy_get_build_items, percy_get_snapshot, percy_get_comparison
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

  return tools;
}

export default registerPercyMcpTools;
