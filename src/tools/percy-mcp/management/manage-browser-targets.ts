/**
 * percy_manage_browser_targets — List, add, or remove browser targets for a project.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ManageBrowserTargetsArgs {
  project_id: string;
  action?: string;
  browser_family?: string;
}

export async function percyManageBrowserTargets(
  args: ManageBrowserTargetsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { project_id, action = "list", browser_family } = args;
  const client = new PercyClient(config);

  // ---- List ----
  if (action === "list") {
    const [families, targets] = await Promise.all([
      client.get<{ data: Record<string, unknown>[] | null }>(
        "/browser-families",
      ),
      client.get<{ data: Record<string, unknown>[] | null }>(
        `/projects/${project_id}/project-browser-targets`,
      ),
    ]);

    const familyList = Array.isArray(families?.data) ? families.data : [];
    const targetList = Array.isArray(targets?.data) ? targets.data : [];

    const lines: string[] = [];
    lines.push(`## Browser Targets for Project ${project_id}`);
    lines.push("");

    if (targetList.length === 0) {
      lines.push("_No browser targets configured. Using defaults._");
    } else {
      lines.push("### Active Targets");
      lines.push("");
      lines.push("| Browser Family | ID |");
      lines.push("|---------------|-----|");
      for (const target of targetList) {
        const attrs = (target as any).attributes ?? target;
        const name =
          attrs.browserFamilySlug ??
          attrs["browser-family-slug"] ??
          attrs.name ??
          "unknown";
        lines.push(`| ${name} | ${target.id ?? "?"} |`);
      }
    }

    if (familyList.length > 0) {
      lines.push("");
      lines.push("### Available Browser Families");
      lines.push("");
      for (const family of familyList) {
        const attrs = (family as any).attributes ?? family;
        const name = attrs.name ?? attrs.slug ?? "unknown";
        lines.push(`- ${name} (ID: ${family.id ?? "?"})`);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ---- Add ----
  if (action === "add") {
    if (!browser_family) {
      return {
        content: [
          {
            type: "text",
            text: "browser_family is required for the 'add' action. Use action='list' to see available families.",
          },
        ],
        isError: true,
      };
    }

    const body = {
      data: {
        type: "project-browser-targets",
        relationships: {
          project: { data: { type: "projects", id: project_id } },
          "browser-family": {
            data: { type: "browser-families", id: browser_family },
          },
        },
      },
    };

    try {
      await client.post("/project-browser-targets", body);
      return {
        content: [
          {
            type: "text",
            text: `Browser family ${browser_family} added to project ${project_id}.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to add browser target: ${message}` },
        ],
        isError: true,
      };
    }
  }

  // ---- Remove ----
  if (action === "remove") {
    if (!browser_family) {
      return {
        content: [
          {
            type: "text",
            text: "browser_family (target ID) is required for the 'remove' action.",
          },
        ],
        isError: true,
      };
    }

    try {
      await client.del(`/project-browser-targets/${browser_family}`);
      return {
        content: [
          {
            type: "text",
            text: `Browser target ${browser_family} removed from project ${project_id}.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to remove browser target: ${message}` },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Invalid action "${action}". Valid actions: list, add, remove`,
      },
    ],
    isError: true,
  };
}
