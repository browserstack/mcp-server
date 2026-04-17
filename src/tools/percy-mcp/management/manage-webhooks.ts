/**
 * percy_manage_webhooks — Create, update, list, or delete webhooks for Percy build events.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ManageWebhooksArgs {
  project_id: string;
  action?: string;
  webhook_id?: string;
  url?: string;
  events?: string;
  description?: string;
}

export async function percyManageWebhooks(
  args: ManageWebhooksArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const {
    project_id,
    action = "list",
    webhook_id,
    url,
    events,
    description,
  } = args;
  const client = new PercyClient(config);

  // ---- List ----
  if (action === "list") {
    const response = await client.get<{
      data: Record<string, unknown>[] | null;
    }>(`/webhook-configs`, {
      "filter[project-id]": project_id,
    });

    const webhooks = Array.isArray(response?.data) ? response.data : [];

    if (webhooks.length === 0) {
      return {
        content: [
          { type: "text", text: "_No webhooks configured for this project._" },
        ],
      };
    }

    const lines: string[] = [];
    lines.push(`## Webhooks for Project ${project_id}`);
    lines.push("");
    lines.push("| ID | URL | Events | Description |");
    lines.push("|----|-----|--------|-------------|");

    for (const webhook of webhooks) {
      const attrs = (webhook as any).attributes ?? webhook;
      const wUrl = attrs.url ?? "?";
      const wEvents = Array.isArray(attrs.events)
        ? attrs.events.join(", ")
        : (attrs.events ?? "?");
      const wDesc = attrs.description ?? "";
      lines.push(`| ${webhook.id ?? "?"} | ${wUrl} | ${wEvents} | ${wDesc} |`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ---- Create ----
  if (action === "create") {
    if (!url) {
      return {
        content: [
          { type: "text", text: "url is required for the 'create' action." },
        ],
        isError: true,
      };
    }

    const eventArray = events
      ? events
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : [];

    const body = {
      data: {
        type: "webhook-configs",
        attributes: {
          url,
          events: eventArray,
          ...(description ? { description } : {}),
        },
        relationships: {
          project: { data: { type: "projects", id: project_id } },
        },
      },
    };

    try {
      const result = (await client.post<{
        data: Record<string, unknown> | null;
      }>("/webhook-configs", body)) as { data: Record<string, unknown> | null };

      const id = (result?.data as any)?.id ?? "?";
      return {
        content: [
          {
            type: "text",
            text: `## Webhook Created\n\n**ID:** ${id}\n**URL:** ${url}\n**Events:** ${eventArray.join(", ") || "all"}\n${description ? `**Description:** ${description}` : ""}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to create webhook: ${message}` },
        ],
        isError: true,
      };
    }
  }

  // ---- Update ----
  if (action === "update") {
    if (!webhook_id) {
      return {
        content: [
          {
            type: "text",
            text: "webhook_id is required for the 'update' action.",
          },
        ],
        isError: true,
      };
    }

    const attrs: Record<string, unknown> = {};
    if (url) attrs.url = url;
    if (events) {
      attrs.events = events
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    }
    if (description) attrs.description = description;

    const body = {
      data: {
        type: "webhook-configs",
        id: webhook_id,
        attributes: attrs,
      },
    };

    try {
      await client.patch(`/webhook-configs/${webhook_id}`, body);
      return {
        content: [
          {
            type: "text",
            text: `Webhook ${webhook_id} updated successfully.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to update webhook: ${message}` },
        ],
        isError: true,
      };
    }
  }

  // ---- Delete ----
  if (action === "delete") {
    if (!webhook_id) {
      return {
        content: [
          {
            type: "text",
            text: "webhook_id is required for the 'delete' action.",
          },
        ],
        isError: true,
      };
    }

    try {
      await client.del(`/webhook-configs/${webhook_id}`);
      return {
        content: [
          { type: "text", text: `Webhook ${webhook_id} deleted successfully.` },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to delete webhook: ${message}` },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Invalid action "${action}". Valid actions: list, create, update, delete`,
      },
    ],
    isError: true,
  };
}
