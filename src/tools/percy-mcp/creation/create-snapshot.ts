/**
 * percy_create_snapshot — Create a snapshot in a Percy build with DOM resources.
 *
 * POST /builds/{build_id}/snapshots with JSON:API body.
 * Returns snapshot ID and list of missing resources for upload.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface CreateSnapshotArgs {
  build_id: string;
  name: string;
  widths?: string;
  enable_javascript?: boolean;
  resources?: string;
}

export async function percyCreateSnapshot(
  args: CreateSnapshotArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { build_id, name, widths, enable_javascript, resources } = args;

  // Parse widths from comma-separated string to int array
  const parsedWidths = widths
    ? widths
        .split(",")
        .map((w) => parseInt(w.trim(), 10))
        .filter((w) => !isNaN(w))
    : undefined;

  // Parse resources from JSON string
  let parsedResources:
    | Array<{ id: string; "resource-url": string; "is-root": boolean }>
    | undefined;
  if (resources) {
    try {
      parsedResources = JSON.parse(resources);
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `Invalid resources JSON: could not parse the provided string.`,
          },
        ],
        isError: true,
      };
    }
  }

  const attributes: Record<string, unknown> = { name };
  if (parsedWidths) {
    attributes.widths = parsedWidths;
  }
  if (enable_javascript !== undefined) {
    attributes["enable-javascript"] = enable_javascript;
  }

  const body = {
    data: {
      type: "snapshots",
      attributes,
      relationships: {
        ...(parsedResources
          ? {
              resources: {
                data: parsedResources.map((r) => ({
                  type: "resources",
                  id: r.id,
                  attributes: {
                    "resource-url": r["resource-url"],
                    "is-root": r["is-root"] ?? false,
                  },
                })),
              },
            }
          : {}),
      },
    },
  };

  try {
    const client = new PercyClient(config);
    const result = (await client.post(
      `/builds/${build_id}/snapshots`,
      body,
    )) as { data: Record<string, unknown> | null };

    const snapshotId = result?.data?.id ?? "unknown";

    // Extract missing resources from relationships
    const missingResources = (result?.data as any)?.missingResources ?? [];
    const missingCount = Array.isArray(missingResources)
      ? missingResources.length
      : 0;
    const missingShas = Array.isArray(missingResources)
      ? missingResources.map((r: any) => r.id ?? r).join(", ")
      : "";

    const lines = [
      `Snapshot '${name}' created (ID: ${snapshotId}). Missing resources: ${missingCount}.`,
    ];

    if (missingCount > 0) {
      lines.push(`Upload them with percy_upload_resource.`);
      lines.push(`Missing SHAs: ${missingShas}`);
    }

    return {
      content: [{ type: "text", text: lines.join(" ") }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to create snapshot '${name}' in build ${build_id}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
