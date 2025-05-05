import { AxiosError } from "axios";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Formats an AxiosError into a CallToolResult with an appropriate message.
 * @param err - The error object to format
 * @param defaultText - The fallback error message
 */
export function formatAxiosError(
  err: unknown,
  defaultText: string,
): CallToolResult {
  let text = defaultText;

  if (err instanceof AxiosError && err.response?.data) {
    const message =
      err.response.data.message ||
      err.response.data.error ||
      err.message ||
      defaultText;
    text = message;
  } else if (err instanceof Error) {
    text = err.message;
  }

  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}
