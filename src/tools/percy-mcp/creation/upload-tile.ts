/**
 * percy_upload_tile — Upload a screenshot tile (PNG or JPEG) to a Percy comparison.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface UploadTileArgs {
  comparison_id: string;
  base64_content: string;
}

// PNG magic bytes: 0x89 0x50 0x4E 0x47
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

// JPEG magic bytes: 0xFF 0xD8 0xFF
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function isValidImage(base64: string): boolean {
  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length < 4) return false;

    const isPng = PNG_MAGIC.every((byte, i) => buffer[i] === byte);
    const isJpeg = JPEG_MAGIC.every((byte, i) => buffer[i] === byte);

    return isPng || isJpeg;
  } catch {
    return false;
  }
}

export async function percyUploadTile(
  args: UploadTileArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Validate image format
  if (!isValidImage(args.base64_content)) {
    return {
      content: [
        {
          type: "text",
          text: "Only PNG and JPEG images are supported",
        },
      ],
      isError: true,
    };
  }

  const client = new PercyClient(config, { scope: "auto" });

  const body = {
    data: {
      type: "tiles",
      attributes: {
        "base64-content": args.base64_content,
      },
    },
  };

  await client.post(`/comparisons/${args.comparison_id}/tiles`, body);

  return {
    content: [
      {
        type: "text",
        text: `Tile uploaded to comparison ${args.comparison_id}.`,
      },
    ],
  };
}
