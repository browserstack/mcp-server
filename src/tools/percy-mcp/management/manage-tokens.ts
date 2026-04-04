/**
 * percy_manage_tokens — List or rotate Percy project tokens.
 *
 * Token values are masked — only the last 4 characters are shown.
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ManageTokensArgs {
  project_id: string;
  action?: string;
  role?: string;
}

export async function percyManageTokens(
  args: ManageTokensArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { project_id, action = "list", role } = args;
  const client = new PercyClient(config);

  // ---- List ----
  if (action === "list") {
    const response = await client.get<{
      data: Record<string, unknown>[] | null;
    }>(`/projects/${project_id}/tokens`);

    const tokens = Array.isArray(response?.data) ? response.data : [];

    if (tokens.length === 0) {
      return {
        content: [{ type: "text", text: "_No tokens found for this project._" }],
      };
    }

    const lines: string[] = [];
    lines.push(`## Tokens for Project ${project_id}`);
    lines.push("");
    lines.push("| Role | Token (masked) | ID |");
    lines.push("|------|---------------|----|");

    for (const token of tokens) {
      const attrs = (token as any).attributes ?? token;
      const tokenRole = attrs.role ?? attrs["token-role"] ?? "unknown";
      const tokenValue = attrs.token ?? attrs["token-value"] ?? "";
      const masked =
        tokenValue.length > 4
          ? `****${tokenValue.slice(-4)}`
          : "****";
      lines.push(`| ${tokenRole} | ${masked} | ${token.id ?? "?"} |`);
    }

    lines.push("");
    lines.push(
      "_Token values are masked for security. Use action='rotate' to generate a new token._",
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ---- Rotate ----
  if (action === "rotate") {
    if (!role) {
      return {
        content: [
          {
            type: "text",
            text: "role is required for the 'rotate' action (e.g., 'write', 'read').",
          },
        ],
        isError: true,
      };
    }

    const body = {
      data: {
        type: "tokens",
        attributes: {
          "project-id": parseInt(project_id, 10),
          role,
        },
      },
    };

    try {
      const result = (await client.patch<{
        data: Record<string, unknown> | null;
      }>("/tokens/rotate", body)) as {
        data: Record<string, unknown> | null;
      };

      const attrs = (result?.data as any)?.attributes ?? result?.data ?? {};
      const newToken = attrs.token ?? attrs["token-value"] ?? "";
      const masked =
        newToken.length > 4 ? `****${newToken.slice(-4)}` : "****";

      return {
        content: [
          {
            type: "text",
            text: `## Token Rotated\n\n**Role:** ${role}\n**New token (masked):** ${masked}\n\n_The full token was returned by the API. Store it securely — it cannot be retrieved again._`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to rotate token: ${message}` },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Invalid action "${action}". Valid actions: list, rotate`,
      },
    ],
    isError: true,
  };
}
