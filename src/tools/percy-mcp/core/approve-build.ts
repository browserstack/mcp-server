/**
 * Percy build approval/rejection tool handler.
 *
 * Sends a review action (approve, request_changes, unapprove, reject)
 * to the Percy Reviews API using JSON:API format.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ACTIONS = ["approve", "request_changes", "unapprove", "reject"] as const;
type ReviewAction = (typeof VALID_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function percyApproveBuild(
  args: {
    build_id: string;
    action: string;
    snapshot_ids?: string;
    reason?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { build_id, action, snapshot_ids, reason } = args;

  // Validate action
  if (!VALID_ACTIONS.includes(action as ReviewAction)) {
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

  // request_changes requires snapshot_ids (snapshot-level action)
  if (action === "request_changes" && !snapshot_ids) {
    return {
      content: [
        {
          type: "text",
          text: "request_changes requires snapshot_ids. This action works at snapshot level only.",
        },
      ],
      isError: true,
    };
  }

  // Build JSON:API request body
  const body: Record<string, unknown> = {
    data: {
      type: "reviews",
      attributes: {
        action,
        ...(reason ? { reason } : {}),
      },
      relationships: {
        build: {
          data: { type: "builds", id: build_id },
        },
        ...(snapshot_ids
          ? {
              snapshots: {
                data: snapshot_ids
                  .split(",")
                  .map((id) => id.trim())
                  .filter(Boolean)
                  .map((id) => ({ type: "snapshots", id })),
              },
            }
          : {}),
      },
    },
  };

  try {
    const client = new PercyClient(config);
    const result = (await client.post("/reviews", body)) as {
      data: Record<string, unknown> | null;
    };

    const reviewState =
      (result?.data as Record<string, unknown>)?.reviewState ??
      (result?.data as Record<string, unknown>)?.["review-state"] ??
      action;

    return {
      content: [
        {
          type: "text",
          text: `Build #${build_id} ${action} successful. Review state: ${reviewState}`,
        },
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to ${action} build #${build_id}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
