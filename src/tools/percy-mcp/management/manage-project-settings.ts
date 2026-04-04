/**
 * percy_manage_project_settings — View or update Percy project settings.
 *
 * GET /projects/{project_id} to read current settings.
 * PATCH /projects/{project_id} with JSON:API body to update.
 * High-risk attributes require confirm_destructive=true.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGH_RISK_ATTRIBUTES = [
  "auto-approve-branch-filter",
  "approval-required-branch-filter",
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface ManageProjectSettingsArgs {
  project_id: string;
  settings?: string;
  confirm_destructive?: boolean;
}

export async function percyManageProjectSettings(
  args: ManageProjectSettingsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { project_id, settings, confirm_destructive } = args;
  const client = new PercyClient(config);

  // ---- Read current settings ----
  const current = (await client.get<{
    data: Record<string, unknown> | null;
  }>(`/projects/${project_id}`)) as { data: Record<string, unknown> | null };

  if (!settings) {
    // Read-only mode — return current settings
    const attrs = (current?.data as any)?.attributes ?? current?.data ?? {};
    const lines: string[] = [];
    lines.push(`## Project Settings (ID: ${project_id})`);
    lines.push("");
    lines.push("| Setting | Value |");
    lines.push("|---------|-------|");

    for (const [key, value] of Object.entries(attrs)) {
      lines.push(`| ${key} | ${JSON.stringify(value)} |`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ---- Update mode ----
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(settings);
  } catch {
    return {
      content: [
        {
          type: "text",
          text: "Invalid settings JSON. Provide a valid JSON object of attributes to update.",
        },
      ],
      isError: true,
    };
  }

  // Check for high-risk attributes
  const highRiskKeys = Object.keys(parsed).filter((key) =>
    HIGH_RISK_ATTRIBUTES.includes(key),
  );

  if (highRiskKeys.length > 0 && !confirm_destructive) {
    const lines: string[] = [];
    lines.push("## Warning: High-Risk Settings Change");
    lines.push("");
    lines.push(
      "The following settings can significantly affect your workflow:",
    );
    lines.push("");
    for (const key of highRiskKeys) {
      lines.push(`- **${key}**: \`${JSON.stringify(parsed[key])}\``);
    }
    lines.push("");
    lines.push("Set `confirm_destructive=true` to apply these changes.");

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // Build JSON:API PATCH body
  const body = {
    data: {
      type: "projects",
      id: project_id,
      attributes: parsed,
    },
  };

  try {
    const result = (await client.patch<{
      data: Record<string, unknown> | null;
    }>(`/projects/${project_id}`, body)) as {
      data: Record<string, unknown> | null;
    };

    const updatedAttrs =
      (result?.data as any)?.attributes ?? result?.data ?? {};
    const lines: string[] = [];
    lines.push(`## Project Settings Updated (ID: ${project_id})`);
    lines.push("");
    lines.push("**Updated attributes:**");
    for (const key of Object.keys(parsed)) {
      lines.push(
        `- **${key}**: ${JSON.stringify(updatedAttrs[key] ?? parsed[key])}`,
      );
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to update project settings: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
