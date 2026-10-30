import type { ApiResponse } from "./apiClient.js";
import { BrowserStackConfig } from "./types.js";
import { getBrowserStackAuth } from "./get-auth.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { trackMCP } from "../index.js";

export function sanitizeUrlParam(param: string): string {
  // Remove any characters that could be used for command injection
  return param.replace(/[;&|`$(){}[\]<>]/g, "");
}

export { maybeCompressBase64 } from "./image.js";

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
