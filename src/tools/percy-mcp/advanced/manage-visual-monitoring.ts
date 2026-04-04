/**
 * percy_manage_visual_monitoring — Create, update, or list Visual Monitoring projects
 * with URL lists, cron schedules, and auth configuration.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ManageVisualMonitoringArgs {
  org_id?: string;
  project_id?: string;
  action?: string;
  urls?: string;
  cron?: string;
  schedule?: boolean;
}

export async function percyManageVisualMonitoring(
  args: ManageVisualMonitoringArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { org_id, project_id, action = "list", urls, cron, schedule } = args;
  const client = new PercyClient(config);

  // ---- List ----
  if (action === "list") {
    if (!org_id) {
      return {
        content: [
          { type: "text", text: "org_id is required for the 'list' action." },
        ],
        isError: true,
      };
    }

    const response = await client.get<{
      data: Record<string, unknown>[] | null;
    }>(`/organizations/${org_id}/visual_monitoring_projects`);

    const projects = Array.isArray(response?.data) ? response.data : [];

    if (projects.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "_No Visual Monitoring projects found._",
          },
        ],
      };
    }

    const lines: string[] = [];
    lines.push(`## Visual Monitoring Projects (Org: ${org_id})`);
    lines.push("");
    lines.push("| ID | Name | URLs | Schedule | Status |");
    lines.push("|----|------|------|----------|--------|");

    for (const project of projects) {
      const attrs = (project as any).attributes ?? project;
      const name = attrs.name ?? "Unnamed";
      const urlCount = Array.isArray(attrs.urls)
        ? attrs.urls.length
        : attrs["url-count"] ?? "?";
      const cronSchedule = attrs.cron ?? attrs["cron-schedule"] ?? "—";
      const status = attrs.enabled ?? attrs.status ?? "—";
      lines.push(
        `| ${project.id ?? "?"} | ${name} | ${urlCount} URLs | ${cronSchedule} | ${status} |`,
      );
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ---- Create ----
  if (action === "create") {
    if (!org_id) {
      return {
        content: [
          { type: "text", text: "org_id is required for the 'create' action." },
        ],
        isError: true,
      };
    }

    const urlArray = urls
      ? urls.split(",").map((u) => u.trim()).filter(Boolean)
      : [];

    const attrs: Record<string, unknown> = {};
    if (urlArray.length > 0) attrs.urls = urlArray;
    if (cron) attrs.cron = cron;
    if (schedule !== undefined) attrs.enabled = schedule;

    const body = {
      data: {
        type: "visual-monitoring-projects",
        attributes: attrs,
        relationships: {
          organization: {
            data: { type: "organizations", id: org_id },
          },
        },
      },
    };

    try {
      const result = (await client.post<{
        data: Record<string, unknown> | null;
      }>(
        `/organizations/${org_id}/visual_monitoring_projects`,
        body,
      )) as { data: Record<string, unknown> | null };

      const id = (result?.data as any)?.id ?? "?";
      return {
        content: [
          {
            type: "text",
            text: `## Visual Monitoring Project Created\n\n**ID:** ${id}\n**URLs:** ${urlArray.length}\n**Cron:** ${cron ?? "not set"}\n**Enabled:** ${schedule ?? "default"}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to create Visual Monitoring project: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // ---- Update ----
  if (action === "update") {
    if (!project_id) {
      return {
        content: [
          {
            type: "text",
            text: "project_id is required for the 'update' action.",
          },
        ],
        isError: true,
      };
    }

    const attrs: Record<string, unknown> = {};
    if (urls) {
      attrs.urls = urls.split(",").map((u) => u.trim()).filter(Boolean);
    }
    if (cron) attrs.cron = cron;
    if (schedule !== undefined) attrs.enabled = schedule;

    const body = {
      data: {
        type: "visual-monitoring-projects",
        id: project_id,
        attributes: attrs,
      },
    };

    try {
      await client.patch(
        `/visual_monitoring_projects/${project_id}`,
        body,
      );
      return {
        content: [
          {
            type: "text",
            text: `Visual Monitoring project ${project_id} updated.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to update Visual Monitoring project: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Invalid action "${action}". Valid actions: list, create, update`,
      },
    ],
    isError: true,
  };
}
