import type { ApiResponse } from "./apiClient.js";
import { BrowserStackConfig } from "./types.js";
import { getBrowserStackAuth } from "./get-auth.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../index.js";
import logger from "../logger.js";

export function sanitizeUrlParam(param: string): string {
  // Remove any characters that could be used for command injection
  return param.replace(/[;&|`$(){}[\]<>]/g, "");
}

const ONE_MB = 1048576;

//Compresses a base64 image intelligently to keep it under 1 MB if needed.
export async function maybeCompressBase64(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length <= ONE_MB) {
    return base64;
  }

  const sizeRatio = 1048576 / buffer.length;
  const estimatedQuality = Math.floor(sizeRatio * 100);
  const quality = Math.min(95, Math.max(30, estimatedQuality));

  try {
    const { default: sharp } = await import("sharp");
    const compressedBuffer = await sharp(buffer).png({ quality }).toBuffer();
    return compressedBuffer.toString("base64");
  } catch (err) {
    logger.warn(
      "Image compression unavailable (sharp failed to load); returning the uncompressed image. %s",
      err instanceof Error ? err.message : String(err),
    );
    return base64;
  }
}

export async function assertOkResponse(
  response: Response | ApiResponse,
  action: string,
) {
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Invalid session ID for ${action}`);
    }
    throw new Error(
      `Failed to fetch logs for ${action}: ${response.statusText}`,
    );
  }
}

export async function fetchFromBrowserStackAPI(
  url: string,
  config: BrowserStackConfig,
): Promise<any> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch from ${url}: ${res.status} ${res.statusText}`,
    );
  }

  return res.json();
}

function errorContent(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function handleMCPError(
  toolName: string,
  server: McpServer,
  config: BrowserStackConfig,
  error: unknown,
) {
  trackMCP(toolName, server.server.getClientVersion()!, error, config);

  const errorMessage = error instanceof Error ? error.message : "Unknown error";

  const readableToolName = toolName.replace(/([A-Z])/g, " $1").toLowerCase();

  return errorContent(
    `Failed to ${readableToolName}: ${errorMessage}. Please open an issue on GitHub if the problem persists`,
  );
}

export function isDataUrlPayloadTooLarge(
  dataUrl: string,
  maxBytes: number,
): boolean {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return true; // malformed
  const meta = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);

  const isBase64 = /;base64$/i.test(meta);
  if (!isBase64) {
    try {
      const decoded = decodeURIComponent(payload);
      return Buffer.byteLength(decoded, "utf8") > maxBytes;
    } catch {
      return true;
    }
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const decodedBytes = Math.floor((payload.length * 3) / 4) - padding;
  return decodedBytes > maxBytes;
}
