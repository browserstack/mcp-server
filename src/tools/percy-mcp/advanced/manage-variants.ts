/**
 * percy_manage_variants — List, create, or update A/B testing variants
 * for Percy snapshot comparisons.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ManageVariantsArgs {
  comparison_id?: string;
  snapshot_id?: string;
  action?: string;
  variant_id?: string;
  name?: string;
  state?: string;
}

export async function percyManageVariants(
  args: ManageVariantsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { comparison_id, snapshot_id, action = "list", variant_id, name, state } =
    args;
  const client = new PercyClient(config);

  // ---- List ----
  if (action === "list") {
    if (!comparison_id) {
      return {
        content: [
          {
            type: "text",
            text: "comparison_id is required for the 'list' action.",
          },
        ],
        isError: true,
      };
    }

    const response = await client.get<{
      data: Record<string, unknown>[] | null;
    }>("/variants", { comparison_id });

    const variants = Array.isArray(response?.data) ? response.data : [];

    if (variants.length === 0) {
      return {
        content: [
          { type: "text", text: "_No variants found for this comparison._" },
        ],
      };
    }

    const lines: string[] = [];
    lines.push(`## Variants (Comparison: ${comparison_id})`);
    lines.push("");
    lines.push("| ID | Name | State |");
    lines.push("|----|------|-------|");

    for (const variant of variants) {
      const attrs = (variant as any).attributes ?? variant;
      const vName = attrs.name ?? "Unnamed";
      const vState = attrs.state ?? "—";
      lines.push(`| ${variant.id ?? "?"} | ${vName} | ${vState} |`);
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
    if (!name) {
      return {
        content: [
          { type: "text", text: "name is required for the 'create' action." },
        ],
        isError: true,
      };
    }

    const body = {
      data: {
        type: "variants",
        attributes: {
          name,
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
      }>("/variants", body)) as { data: Record<string, unknown> | null };

      const id = (result?.data as any)?.id ?? "?";
      return {
        content: [
          {
            type: "text",
            text: `Variant created (ID: ${id}, name: "${name}").`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to create variant: ${message}` },
        ],
        isError: true,
      };
    }
  }

  // ---- Update ----
  if (action === "update") {
    if (!variant_id) {
      return {
        content: [
          {
            type: "text",
            text: "variant_id is required for the 'update' action.",
          },
        ],
        isError: true,
      };
    }

    const attrs: Record<string, unknown> = {};
    if (name) attrs.name = name;
    if (state) attrs.state = state;

    const body = {
      data: {
        type: "variants",
        id: variant_id,
        attributes: attrs,
      },
    };

    try {
      await client.patch(`/variants/${variant_id}`, body);
      return {
        content: [
          {
            type: "text",
            text: `Variant ${variant_id} updated.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to update variant: ${message}` },
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
