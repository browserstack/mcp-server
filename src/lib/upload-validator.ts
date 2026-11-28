import fs from "fs";
import path from "path";
import { CallerError } from "./error.js";

export interface UploadValidationOptions {
  allowedExtensions: readonly string[];
  maxSizeBytes: number;
  allowedBaseDir: string | undefined;
}

/**
 * Canonicalizes and validates a user-supplied upload path. Returns the resolved
 * absolute path that callers should stream from. Throws on any rule violation.
 *
 * Rules enforced, in this order:
 *  - `allowedBaseDir` is mandatory: uploads are refused unless it is configured
 *    (via MCP_UPLOAD_BASE_DIR)
 *  - The canonical path must resolve to somewhere inside `allowedBaseDir`. A path
 *    that does not resolve and a path that resolves outside share one message, so
 *    the result never tells the caller whether a path outside the allowed
 *    directory exists, nor its type, size or extension
 *  - Within the allowed directory: an existing regular file, size within
 *    `maxSizeBytes`, no hidden path segment (starts with `.`), and an extension
 *    in `allowedExtensions` (case-insensitive)
 *
 * The base-directory check runs first on purpose: the detailed errors below
 * describe only files the caller is already authorized to read, so they cannot
 * be used to probe paths elsewhere on the host.
 */
export function validateUploadPath(
  filePath: string,
  options: UploadValidationOptions,
): string {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new CallerError("Upload rejected: file path is empty.");
  }

  if (!options.allowedBaseDir) {
    throw new CallerError(
      "Upload rejected: MCP_UPLOAD_BASE_DIR is not set. Set it to the directory " +
        "containing the files to upload, then restart the MCP server.",
    );
  }

  let baseCanonical: string;
  try {
    baseCanonical = fs.realpathSync(path.resolve(options.allowedBaseDir));
  } catch {
    throw new CallerError(
      `Upload rejected: configured MCP_UPLOAD_BASE_DIR does not exist (${options.allowedBaseDir}).`,
    );
  }

  // One message for "does not resolve" and for "resolves outside the base dir",
  // so a caller cannot tell a non-existent path from one that exists elsewhere.
  const outsideError = new CallerError(
    `Upload rejected: file must be an existing file inside ${baseCanonical}.`,
  );

  let canonical: string;
  try {
    canonical = fs.realpathSync(path.resolve(filePath));
  } catch {
    throw outsideError;
  }

  const baseWithSep = baseCanonical.endsWith(path.sep)
    ? baseCanonical
    : baseCanonical + path.sep;
  if (canonical !== baseCanonical && !canonical.startsWith(baseWithSep)) {
    throw outsideError;
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(canonical);
  } catch {
    throw outsideError;
  }

  if (!stats.isFile()) {
    throw new CallerError(
      `Upload rejected: path does not point to a regular file: ${filePath}`,
    );
  }

  if (stats.size > options.maxSizeBytes) {
    const maxMb = Math.round(options.maxSizeBytes / (1024 * 1024));
    throw new CallerError(
      `Upload rejected: file exceeds maximum allowed size of ${maxMb} MB.`,
    );
  }

  const segments = canonical.split(path.sep).filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg.startsWith(".") && seg !== "." && seg !== "..") {
      throw new CallerError(
        `Upload rejected: path traverses a hidden directory or file ("${seg}").`,
      );
    }
  }

  const ext = path.extname(canonical).toLowerCase();
  const allowed = options.allowedExtensions.map((e) => e.toLowerCase());
  if (!allowed.includes(ext)) {
    throw new CallerError(
      `Upload rejected: file extension "${ext || "(none)"}" is not in the allowed list (${allowed.join(", ")}).`,
    );
  }

  return canonical;
}

export const APP_BINARY_EXTENSIONS = [
  ".apk",
  ".aab",
  ".ipa",
  ".app",
  ".zip",
] as const;

export const TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".md",
  ".doc",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".csv",
  ".xls",
  ".xlsx",
  ".json",
  ".html",
  ".zip",
] as const;

/** File types test case generation can read, mapped to the mimeType it expects. */
export const TEST_CASE_GENERATION_MIME_TYPES: Readonly<Record<string, string>> =
  {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".rtf": "application/rtf",
  };

export const ONE_MB = 1024 * 1024;
export const MAX_APP_UPLOAD_BYTES = 4 * 1024 * ONE_MB; // 4 GB — matches BrowserStack app upload limit
export const MAX_ATTACHMENT_UPLOAD_BYTES = 100 * ONE_MB; // 100 MB
