import fs from "fs";
import path from "path";

export interface UploadValidationOptions {
  allowedExtensions: readonly string[];
  maxSizeBytes: number;
  allowedBaseDir?: string;
}

/**
 * Canonicalizes and validates a user-supplied upload path. Returns the resolved
 * absolute path that callers should stream from. Throws on any rule violation.
 *
 * Rules enforced:
 *  - Path resolves (via realpath) to an existing regular file
 *  - File size is within `maxSizeBytes`
 *  - File extension is in `allowedExtensions` (case-insensitive)
 *  - No path segment is a hidden dir/file (starts with `.`); blocks ~/.ssh,
 *    ~/.aws, .env, etc. even after symlink resolution
 *  - The canonical path must live inside `allowedBaseDir` (defaults to the
 *    process working directory when not provided — containment is fail-closed)
 */
export function validateUploadPath(
  filePath: string,
  options: UploadValidationOptions,
): string {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error("Upload rejected: file path is empty.");
  }

  let canonical: string;
  try {
    canonical = fs.realpathSync(path.resolve(filePath));
  } catch {
    throw new Error(`File not found at path: ${filePath}`);
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(canonical);
  } catch {
    throw new Error(`File not found at path: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new Error(
      `Upload rejected: path does not point to a regular file: ${filePath}`,
    );
  }

  if (stats.size > options.maxSizeBytes) {
    const maxMb = Math.round(options.maxSizeBytes / (1024 * 1024));
    throw new Error(
      `Upload rejected: file exceeds maximum allowed size of ${maxMb} MB.`,
    );
  }

  const segments = canonical.split(path.sep).filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg.startsWith(".") && seg !== "." && seg !== "..") {
      throw new Error(
        `Upload rejected: path traverses a hidden directory or file ("${seg}"). Move the file to a non-hidden location or set MCP_UPLOAD_BASE_DIR.`,
      );
    }
  }

  const ext = path.extname(canonical).toLowerCase();
  const allowed = options.allowedExtensions.map((e) => e.toLowerCase());
  if (!allowed.includes(ext)) {
    throw new Error(
      `Upload rejected: file extension "${ext || "(none)"}" is not in the allowed list (${allowed.join(", ")}).`,
    );
  }

  const allowedBaseDir = options.allowedBaseDir ?? process.cwd();
  let baseCanonical: string;
  try {
    baseCanonical = fs.realpathSync(path.resolve(allowedBaseDir));
  } catch {
    throw new Error(
      `Upload rejected: configured MCP_UPLOAD_BASE_DIR does not exist (${allowedBaseDir}).`,
    );
  }
  const baseWithSep = baseCanonical.endsWith(path.sep)
    ? baseCanonical
    : baseCanonical + path.sep;
  if (canonical !== baseCanonical && !canonical.startsWith(baseWithSep)) {
    throw new Error(
      `Upload rejected: file must be located inside ${baseCanonical}. Set MCP_UPLOAD_BASE_DIR to allow uploads from a different directory.`,
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

export const ONE_MB = 1024 * 1024;
export const MAX_APP_UPLOAD_BYTES = 4 * 1024 * ONE_MB; // 4 GB — matches BrowserStack app upload limit
export const MAX_ATTACHMENT_UPLOAD_BYTES = 100 * ONE_MB; // 100 MB
