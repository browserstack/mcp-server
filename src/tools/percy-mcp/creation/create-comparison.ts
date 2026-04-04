/**
 * percy_create_comparison — Create a comparison with device/browser tag and tile metadata.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface CreateComparisonArgs {
  snapshot_id: string;
  tag_name: string;
  tag_width: number;
  tag_height: number;
  tag_os_name?: string;
  tag_os_version?: string;
  tag_browser_name?: string;
  tag_orientation?: string;
  tiles: string;
}

interface TileInput {
  sha: string;
  "status-bar-height"?: number;
  "nav-bar-height"?: number;
}

export async function percyCreateComparison(
  args: CreateComparisonArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config, { scope: "auto" });

  // Parse tiles JSON string
  let tilesArray: TileInput[];
  try {
    tilesArray = JSON.parse(args.tiles);
    if (!Array.isArray(tilesArray)) {
      return {
        content: [
          {
            type: "text",
            text: "Error: 'tiles' must be a JSON array of tile objects.",
          },
        ],
        isError: true,
      };
    }
  } catch {
    return {
      content: [
        {
          type: "text",
          text: "Error: 'tiles' is not valid JSON. Expected a JSON array of tile objects.",
        },
      ],
      isError: true,
    };
  }

  // Build tag attributes
  const tagAttributes: Record<string, unknown> = {
    name: args.tag_name,
    width: args.tag_width,
    height: args.tag_height,
  };

  if (args.tag_os_name) tagAttributes["os-name"] = args.tag_os_name;
  if (args.tag_os_version) tagAttributes["os-version"] = args.tag_os_version;
  if (args.tag_browser_name) tagAttributes["browser-name"] = args.tag_browser_name;
  if (args.tag_orientation) tagAttributes["orientation"] = args.tag_orientation;

  // Build tiles data
  const tilesData = tilesArray.map((tile) => {
    const tileAttributes: Record<string, unknown> = {
      sha: tile.sha,
    };
    if (tile["status-bar-height"] != null) {
      tileAttributes["status-bar-height"] = tile["status-bar-height"];
    }
    if (tile["nav-bar-height"] != null) {
      tileAttributes["nav-bar-height"] = tile["nav-bar-height"];
    }
    return {
      type: "tiles",
      attributes: tileAttributes,
    };
  });

  const body = {
    data: {
      type: "comparisons",
      relationships: {
        tag: {
          data: {
            type: "tag",
            attributes: tagAttributes,
          },
        },
        tiles: {
          data: tilesData,
        },
      },
    },
  };

  const response = await client.post<{
    data: Record<string, unknown> | null;
  }>(`/snapshots/${args.snapshot_id}/comparisons`, body);

  const id = response.data?.id ?? "unknown";

  return {
    content: [
      {
        type: "text",
        text: `Comparison created (ID: ${id}). Upload tiles with percy_upload_tile.`,
      },
    ],
  };
}
