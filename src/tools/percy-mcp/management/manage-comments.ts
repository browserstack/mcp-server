/**
 * percy_manage_comments — List, create, or close comment threads on Percy snapshots.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ManageCommentsArgs {
  build_id?: string;
  snapshot_id?: string;
  action?: string;
  thread_id?: string;
  body?: string;
}

export async function percyManageComments(
  args: ManageCommentsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { build_id, snapshot_id, action = "list", thread_id, body } = args;
  const client = new PercyClient(config);

  // ---- List ----
  if (action === "list") {
    if (!build_id) {
      return {
        content: [
          { type: "text", text: "build_id is required for the 'list' action." },
        ],
        isError: true,
      };
    }

    const response = await client.get<{
      data: Record<string, unknown>[] | null;
    }>(`/builds/${build_id}/comment_threads`);

    const threads = Array.isArray(response?.data) ? response.data : [];

    if (threads.length === 0) {
      return {
        content: [
          { type: "text", text: "_No comment threads for this build._" },
        ],
      };
    }

    const lines: string[] = [];
    lines.push(`## Comment Threads (Build: ${build_id})`);
    lines.push("");

    for (const thread of threads) {
      const attrs = (thread as any).attributes ?? thread;
      const id = thread.id ?? "?";
      const closed = attrs.closedAt ?? attrs["closed-at"];
      const status = closed ? "Closed" : "Open";
      const commentCount =
        attrs.commentsCount ?? attrs["comments-count"] ?? "?";
      lines.push(
        `### Thread #${id} (${status}, ${commentCount} comments)`,
      );
      lines.push("");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ---- Create ----
  if (action === "create") {
    if (!snapshot_id) {
      return {
        content: [
          {
            type: "text",
            text: "snapshot_id is required for the 'create' action.",
          },
        ],
        isError: true,
      };
    }
    if (!body) {
      return {
        content: [
          { type: "text", text: "body is required for the 'create' action." },
        ],
        isError: true,
      };
    }

    const requestBody = {
      data: {
        type: "comments",
        attributes: {
          body,
        },
        relationships: {
          snapshot: {
            data: { type: "snapshots", id: snapshot_id },
          },
        },
      },
    };

    try {
      const result = (await client.post<{
        data: Record<string, unknown> | null;
      }>("/comments", requestBody)) as {
        data: Record<string, unknown> | null;
      };

      const id = (result?.data as any)?.id ?? "?";
      return {
        content: [
          {
            type: "text",
            text: `Comment created (ID: ${id}) on snapshot ${snapshot_id}.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to create comment: ${message}` },
        ],
        isError: true,
      };
    }
  }

  // ---- Close ----
  if (action === "close") {
    if (!thread_id) {
      return {
        content: [
          {
            type: "text",
            text: "thread_id is required for the 'close' action.",
          },
        ],
        isError: true,
      };
    }

    const requestBody = {
      data: {
        type: "comment-threads",
        id: thread_id,
        attributes: {
          "closed-at": new Date().toISOString(),
        },
      },
    };

    try {
      await client.patch(`/comment-threads/${thread_id}`, requestBody);
      return {
        content: [
          {
            type: "text",
            text: `Comment thread ${thread_id} closed.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to close thread: ${message}` },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Invalid action "${action}". Valid actions: list, create, close`,
      },
    ],
    isError: true,
  };
}
