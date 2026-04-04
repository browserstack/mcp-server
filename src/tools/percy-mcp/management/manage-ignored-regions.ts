/**
 * percy_manage_ignored_regions — Create, list, save, or delete ignored regions
 * on Percy comparisons.
 *
 * Supports bounding box (raw), XPath, CSS selector, and fullpage types.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ManageIgnoredRegionsArgs {
  comparison_id?: string;
  action?: string;
  region_id?: string;
  type?: string;
  coordinates?: string;
  selector?: string;
}

export async function percyManageIgnoredRegions(
  args: ManageIgnoredRegionsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const {
    comparison_id,
    action = "list",
    region_id,
    type,
    coordinates,
    selector,
  } = args;
  const client = new PercyClient(config);

  // ---- List ----
  if (action === "list") {
    if (!comparison_id) {
      return {
        content: [
          { type: "text", text: "comparison_id is required for the 'list' action." },
        ],
        isError: true,
      };
    }

    const response = await client.get<{
      data: Record<string, unknown>[] | null;
    }>("/region-revisions", {
      comparison_id,
    });

    const regions = Array.isArray(response?.data) ? response.data : [];

    if (regions.length === 0) {
      return {
        content: [
          { type: "text", text: "_No ignored regions for this comparison._" },
        ],
      };
    }

    const lines: string[] = [];
    lines.push(`## Ignored Regions (Comparison: ${comparison_id})`);
    lines.push("");
    lines.push("| ID | Type | Selector / Coordinates |");
    lines.push("|----|------|------------------------|");

    for (const region of regions) {
      const attrs = (region as any).attributes ?? region;
      const rType = attrs.type ?? attrs["region-type"] ?? "unknown";
      const rSelector = attrs.selector ?? "";
      const rCoords = attrs.coordinates
        ? JSON.stringify(attrs.coordinates)
        : "";
      const display = rSelector || rCoords || "—";
      lines.push(`| ${region.id ?? "?"} | ${rType} | ${display} |`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ---- Create ----
  if (action === "create") {
    if (!comparison_id) {
      return {
        content: [
          {
            type: "text",
            text: "comparison_id is required for the 'create' action.",
          },
        ],
        isError: true,
      };
    }

    const attrs: Record<string, unknown> = {};
    if (type) attrs["region-type"] = type;
    if (selector) attrs.selector = selector;
    if (coordinates) {
      try {
        attrs.coordinates = JSON.parse(coordinates);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: "Invalid coordinates JSON. Expected format: {\"x\":0,\"y\":0,\"width\":100,\"height\":100}",
            },
          ],
          isError: true,
        };
      }
    }

    const body = {
      data: {
        type: "region-revisions",
        attributes: attrs,
        relationships: {
          comparison: {
            data: { type: "comparisons", id: comparison_id },
          },
        },
      },
    };

    try {
      const result = (await client.post<{
        data: Record<string, unknown> | null;
      }>("/region-revisions", body)) as {
        data: Record<string, unknown> | null;
      };

      const id = (result?.data as any)?.id ?? "?";
      return {
        content: [
          {
            type: "text",
            text: `Ignored region created (ID: ${id}, type: ${type ?? "raw"}).`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to create ignored region: ${message}` },
        ],
        isError: true,
      };
    }
  }

  // ---- Save (bulk) ----
  if (action === "save") {
    try {
      await client.patch("/region-revisions/bulk-save", {});
      return {
        content: [
          { type: "text", text: "Ignored regions saved (bulk save completed)." },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to bulk-save regions: ${message}` },
        ],
        isError: true,
      };
    }
  }

  // ---- Delete ----
  if (action === "delete") {
    if (!region_id) {
      return {
        content: [
          {
            type: "text",
            text: "region_id is required for the 'delete' action.",
          },
        ],
        isError: true,
      };
    }

    try {
      await client.del(`/region-revisions/${region_id}`);
      return {
        content: [
          { type: "text", text: `Ignored region ${region_id} deleted.` },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to delete region: ${message}` },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Invalid action "${action}". Valid actions: list, create, save, delete`,
      },
    ],
    isError: true,
  };
}
