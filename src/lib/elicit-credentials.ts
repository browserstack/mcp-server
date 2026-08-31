import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import logger from "../logger.js";

export interface CredentialField {
  key: string;
  title: string;
  description: string;
}

/**
 * Collects credential values for a tool WITHOUT routing them through the model.
 *
 * When the connected client advertises MCP elicitation support, any requested
 * field the caller did not already supply is requested directly from the user
 * via the client — the value flows user -> client -> server and never appears in
 * the LLM's tool-call arguments, context, or logs.
 *
 * When the client does not support elicitation, or the user declines/cancels, or
 * the request errors, the values are returned exactly as provided. This keeps the
 * existing argument-based flow working unchanged (backward compatible), and makes
 * the helper safe to ship to transports that cannot elicit (it degrades to the
 * arg path rather than failing).
 */
export async function elicitCredentialsIfSupported(
  server: McpServer,
  provided: Record<string, string | undefined>,
  fields: CredentialField[],
  message: string,
): Promise<Record<string, string | undefined>> {
  const missing = fields.filter((field) => !provided[field.key]);
  if (missing.length === 0) {
    return provided;
  }

  // Only attempt elicitation when the client explicitly supports it; otherwise
  // fall back to the caller-provided values (existing behavior).
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities?.elicitation) {
    return provided;
  }

  const properties: Record<
    string,
    { type: "string"; title: string; description: string }
  > = {};
  for (const field of missing) {
    properties[field.key] = {
      type: "string",
      title: field.title,
      description: field.description,
    };
  }

  let result: ElicitResult;
  try {
    result = await server.server.elicitInput({
      mode: "form",
      message,
      requestedSchema: {
        type: "object",
        properties,
        required: missing.map((field) => field.key),
      },
    });
  } catch {
    // A client that advertised elicitation but failed to handle it must not
    // break the tool — fall back to whatever was provided. The error is not
    // logged: a client validation error can echo the submitted form values
    // (including the password), which must never reach the logs.
    logger.warn("Elicitation request failed; falling back to provided values.");
    return provided;
  }

  if (result.action !== "accept" || !result.content) {
    return provided;
  }

  const merged = { ...provided };
  for (const field of missing) {
    const value = result.content[field.key];
    if (typeof value === "string" && value.length > 0) {
      merged[field.key] = value;
    }
  }
  return merged;
}
