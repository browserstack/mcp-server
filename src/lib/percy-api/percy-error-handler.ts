/**
 * Shared Percy error handler — turns raw API errors into helpful guidance.
 *
 * Instead of showing "403 Forbidden" or "404 Not Found", returns:
 * - What went wrong
 * - What the correct input looks like
 * - Suggested next steps
 */

import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ToolParam {
  name: string;
  required: boolean;
  description: string;
  example: string;
}

interface ToolHelp {
  name: string;
  description: string;
  params: ToolParam[];
  examples: string[];
}

export function handlePercyToolError(
  error: unknown,
  toolHelp: ToolHelp,
  args: Record<string, unknown>,
): CallToolResult {
  const message =
    error instanceof Error ? error.message : String(error);

  let output = `## Error: ${toolHelp.name}\n\n`;

  // Parse the error type
  if (message.includes("401") || message.includes("Unauthorized")) {
    output += `**Authentication failed.** Your BrowserStack credentials may be invalid or expired.\n\n`;
    output += `Check with: \`Use percy_auth_status\`\n`;
  } else if (message.includes("403") || message.includes("Forbidden")) {
    output += `**Access denied.** Your credentials don't have permission for this operation.\n\n`;
    output += `This usually means:\n`;
    output += `- The ID you provided doesn't belong to your organization\n`;
    output += `- Your account doesn't have access to this feature\n`;
  } else if (message.includes("404") || message.includes("Not Found")) {
    output += `**Not found.** The ID or slug you provided doesn't exist.\n\n`;
    // Show what was passed
    const passedArgs = Object.entries(args)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `- \`${k}\`: \`${String(v)}\``)
      .join("\n");
    if (passedArgs) {
      output += `You provided:\n${passedArgs}\n\n`;
    }
    output += `Double-check the ID/slug is correct.\n`;
  } else if (message.includes("422") || message.includes("Unprocessable")) {
    output += `**Invalid input.** The parameters you provided aren't valid.\n\n`;
  } else if (message.includes("429") || message.includes("Rate")) {
    output += `**Rate limited.** Too many requests. Wait a moment and try again.\n`;
    return { content: [{ type: "text", text: output }], isError: true };
  } else if (message.includes("500") || message.includes("Internal Server")) {
    output += `**Percy API error.** The server returned an internal error. This is usually temporary.\n\n`;
    output += `Try again in a moment. If it persists, the endpoint may not be available for your account.\n`;
  } else {
    output += `**Error:** ${message}\n\n`;
  }

  // Show correct usage
  output += `\n### Correct Usage\n\n`;
  output += `**${toolHelp.description}**\n\n`;

  output += `| Parameter | Required | Description | Example |\n|---|---|---|---|\n`;
  toolHelp.params.forEach((p) => {
    output += `| \`${p.name}\` | ${p.required ? "Yes" : "No"} | ${p.description} | \`${p.example}\` |\n`;
  });

  if (toolHelp.examples.length > 0) {
    output += `\n### Examples\n\n`;
    toolHelp.examples.forEach((ex) => {
      output += `\`\`\`\n${ex}\n\`\`\`\n\n`;
    });
  }

  // Suggest discovery tools
  output += `### How to find the right IDs\n\n`;
  output += `- **Project slug:** \`Use percy_get_projects\`\n`;
  output += `- **Build ID:** \`Use percy_get_builds with project_slug "org/project"\`\n`;
  output += `- **Snapshot ID:** \`Use percy_get_build with build_id "123" and detail "snapshots"\`\n`;
  output += `- **Comparison ID:** \`Use percy_get_snapshot with snapshot_id "456"\`\n`;

  return { content: [{ type: "text", text: output }], isError: true };
}

// ── Pre-defined tool help for each tool ─────────────────────────────────────

export const TOOL_HELP: Record<string, ToolHelp> = {
  percy_get_build: {
    name: "percy_get_build",
    description: "Get build details with different views",
    params: [
      { name: "build_id", required: true, description: "Percy build ID (numeric)", example: "48436286" },
      { name: "detail", required: false, description: "View type", example: "overview" },
      { name: "comparison_id", required: false, description: "For rca/network detail", example: "4391856176" },
    ],
    examples: [
      'Use percy_get_build with build_id "48436286"',
      'Use percy_get_build with build_id "48436286" and detail "ai_summary"',
      'Use percy_get_build with build_id "48436286" and detail "changes"',
    ],
  },
  percy_get_snapshot: {
    name: "percy_get_snapshot",
    description: "Get snapshot with all comparisons and AI analysis",
    params: [
      { name: "snapshot_id", required: true, description: "Percy snapshot ID (numeric)", example: "2576885624" },
    ],
    examples: [
      'Use percy_get_snapshot with snapshot_id "2576885624"',
    ],
  },
  percy_get_comparison: {
    name: "percy_get_comparison",
    description: "Get comparison with AI change descriptions and image URLs",
    params: [
      { name: "comparison_id", required: true, description: "Percy comparison ID (numeric)", example: "4391856176" },
    ],
    examples: [
      'Use percy_get_comparison with comparison_id "4391856176"',
    ],
  },
  percy_get_builds: {
    name: "percy_get_builds",
    description: "List builds for a project",
    params: [
      { name: "project_slug", required: false, description: "Project slug from percy_get_projects", example: "9560f98d/my-project-abc123" },
      { name: "branch", required: false, description: "Filter by branch", example: "main" },
      { name: "state", required: false, description: "Filter by state", example: "finished" },
    ],
    examples: [
      'Use percy_get_builds with project_slug "9560f98d/my-project-abc123"',
      "Use percy_get_projects  (to find project slugs first)",
    ],
  },
  percy_get_projects: {
    name: "percy_get_projects",
    description: "List all Percy projects",
    params: [
      { name: "search", required: false, description: "Search by name", example: "my-app" },
    ],
    examples: [
      "Use percy_get_projects",
      'Use percy_get_projects with search "dashboard"',
    ],
  },
  percy_create_build: {
    name: "percy_create_build",
    description: "Create a Percy build with snapshots",
    params: [
      { name: "project_name", required: true, description: "Project name", example: "my-app" },
      { name: "urls", required: false, description: "URLs to snapshot", example: "http://localhost:3000" },
      { name: "screenshots_dir", required: false, description: "Screenshot directory", example: "./screenshots" },
      { name: "test_command", required: false, description: "Test command", example: "npx cypress run" },
    ],
    examples: [
      'Use percy_create_build with project_name "my-app" and urls "http://localhost:3000"',
    ],
  },
  percy_create_project: {
    name: "percy_create_project",
    description: "Create or get a Percy project",
    params: [
      { name: "name", required: true, description: "Project name", example: "my-app" },
      { name: "type", required: false, description: "web or automate", example: "web" },
    ],
    examples: [
      'Use percy_create_project with name "my-app"',
    ],
  },
  percy_clone_build: {
    name: "percy_clone_build",
    description: "Clone snapshots from one build to another project",
    params: [
      { name: "source_build_id", required: true, description: "Build ID to clone from", example: "48436286" },
      { name: "target_project_name", required: true, description: "Target project name", example: "my-project" },
    ],
    examples: [
      'Use percy_clone_build with source_build_id "48436286" and target_project_name "my-project"',
    ],
  },
  percy_get_insights: {
    name: "percy_get_insights",
    description: "Get testing health metrics",
    params: [
      { name: "org_slug", required: true, description: "Organization slug or ID", example: "9560f98d" },
      { name: "period", required: false, description: "Time period", example: "last_30_days" },
      { name: "product", required: false, description: "web or app", example: "web" },
    ],
    examples: [
      'Use percy_get_insights with org_slug "9560f98d"',
    ],
  },
};
