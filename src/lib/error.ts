import { AxiosError } from "axios";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Returns the most specific human-readable text for an error raised by an
 * API call. For an AxiosError with a response body it prefers the body's
 * `message`, `error` or `errors` field, serialising it when the API sent an
 * object instead of a string.
 * @param err - The error object to describe
 * @param defaultText - The fallback error message
 */
export function errorText(err: unknown, defaultText: string): string {
  if (err instanceof AxiosError && err.response?.data !== undefined) {
    const data = err.response.data;
    const detail =
      typeof data === "string"
        ? data
        : (data?.message ?? data?.error ?? data?.errors);
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail !== undefined && detail !== null) return JSON.stringify(detail);
    return err.message || defaultText;
  }
  if (err instanceof Error) return err.message || defaultText;
  return defaultText;
}

/**
 * Formats an AxiosError into a CallToolResult with an appropriate message.
 * @param err - The error object to format
 * @param defaultText - The fallback error message
 */
export function formatAxiosError(
  err: unknown,
  defaultText: string,
): CallToolResult {
  return {
    content: [{ type: "text", text: errorText(err, defaultText) }],
    isError: true,
  };
}
