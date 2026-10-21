import { AxiosError } from "axios";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const MAX_ERROR_TEXT = 500;
const BODY_FIELDS = ["message", "error", "errors"] as const;

function clip(text: string): string {
  return text.length > MAX_ERROR_TEXT ? text.slice(0, MAX_ERROR_TEXT) : text;
}

const HTML_DOCUMENT = /^\s*<(!doctype|html)\b/i;

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return HTML_DOCUMENT.test(value) ? "" : value.trim();
  }
  if (value === undefined || value === null) return "";
  try {
    const json = JSON.stringify(value);
    return json === "{}" || json === "[]" ? "" : (json ?? "");
  } catch {
    return "";
  }
}

/**
 * Text taken from an API error body: the first non-empty `message`, `error`
 * or `errors` field when any of them is present, otherwise the whole body.
 * Returns undefined when the body carries no usable text.
 */
function bodyText(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    const text = stringify(data);
    return text ? clip(text) : undefined;
  }
  const record = data as Record<string, unknown>;
  const named = BODY_FIELDS.filter((key) => key in record);
  if (named.length > 0) {
    for (const key of named) {
      const text = stringify(record[key]);
      if (text) return clip(text);
    }
    return undefined;
  }
  const text = stringify(record);
  return text ? clip(text) : undefined;
}

/**
 * Returns the most specific human-readable text for an error raised by an
 * API call, capped at 500 characters. For an AxiosError with a response body
 * it prefers the body's `message`, `error` or `errors` field, serialising
 * objects, and uses the whole body when none of those fields exist. An empty,
 * whitespace-only or HTML-document body falls back to the error's own message.
 * @param err - The error object to describe
 * @param defaultText - The fallback error message
 */
export function errorText(err: unknown, defaultText: string): string {
  if (err instanceof AxiosError) {
    const text = bodyText(err.response?.data);
    if (text) return text;
    return clip(err.message || defaultText);
  }
  if (err instanceof Error) return clip(err.message || defaultText);
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
