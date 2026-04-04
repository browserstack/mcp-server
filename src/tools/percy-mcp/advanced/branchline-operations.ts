/**
 * percy_branchline_operations — Sync, merge, or unmerge Percy branch baselines.
 *
 * Sync copies approved baselines to target branches.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface BranchlineOperationsArgs {
  action: string;
  project_id?: string;
  build_id?: string;
  target_branch_filter?: string;
  snapshot_ids?: string;
}

export async function percyBranchlineOperations(
  args: BranchlineOperationsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { action, project_id, build_id, target_branch_filter, snapshot_ids } =
    args;
  const client = new PercyClient(config);

  const VALID_ACTIONS = ["sync", "merge", "unmerge"];
  if (!VALID_ACTIONS.includes(action)) {
    return {
      content: [
        {
          type: "text",
          text: `Invalid action "${action}". Valid actions: ${VALID_ACTIONS.join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  // Build the request body based on action
  const attrs: Record<string, unknown> = {};
  const relationships: Record<string, unknown> = {};

  if (project_id) {
    relationships.project = {
      data: { type: "projects", id: project_id },
    };
  }
  if (build_id) {
    relationships.build = {
      data: { type: "builds", id: build_id },
    };
  }
  if (target_branch_filter) {
    attrs["target-branch-filter"] = target_branch_filter;
  }
  if (snapshot_ids) {
    relationships.snapshots = {
      data: snapshot_ids
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => ({ type: "snapshots", id })),
    };
  }

  const body = {
    data: {
      type: "branchline",
      attributes: attrs,
      ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
    },
  };

  try {
    await client.post(`/branchline/${action}`, body);

    const lines: string[] = [];
    lines.push(`## Branchline ${action.charAt(0).toUpperCase() + action.slice(1)} Complete`);
    lines.push("");
    if (build_id) lines.push(`**Build:** ${build_id}`);
    if (project_id) lines.push(`**Project:** ${project_id}`);
    if (target_branch_filter)
      lines.push(`**Target Branch Filter:** ${target_branch_filter}`);
    if (snapshot_ids)
      lines.push(`**Snapshot IDs:** ${snapshot_ids}`);

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to ${action} branchline: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
