/**
 * Files attached to an askBrowserStackAI task.
 *
 * Each file gets an upload slot from BrowserStack AI; its id then goes in
 * `attachment_ids`. Locally the file is read from `MCP_UPLOAD_BASE_DIR` and sent here.
 * The hosted server cannot read the user's disk, so it returns a `curl` command per file
 * for the client to run, and the client then calls again with the ids.
 */
import fs from "fs";
import path from "path";

import { validateUploadPath } from "../../lib/upload-validator.js";

const MB = 1024 * 1024;

/** Size limits, checked before any upload. */
const IMAGE_MAX_BYTES = 5 * MB;
const FILE_MAX_BYTES = 25 * MB;

/** Supported file types: requirement documents and screenshots. */
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif"]);
export const ATTACHMENT_EXTENSIONS = Object.keys(MIME_BY_EXT);

/** Files per message. */
export const MAX_FILES = 10;
const LISTED_FILES = 20;
const ATTACHMENT_ID = /^att_[0-9a-f]{32}$/;

export class UploadError extends Error {}

export interface UploadedFile {
  id: string;
  name: string;
}

export interface UploadDeps {
  agentUrl: string;
  headers: Record<string, string>;
  product: string;
  baseDir: string | undefined;
  progress?: (message: string) => void;
  fetchImpl?: typeof fetch;
}

interface LocalFile {
  name: string;
  bytes: Buffer;
  mime: string;
}

/**
 * The file a name refers to, read once. A bare or relative name is resolved against the
 * upload folder (the client cannot see that setting); an absolute path must still lie
 * inside it. Every rule of `validateUploadPath` applies.
 */
export function readUploadFile(
  name: string,
  baseDir: string | undefined,
): LocalFile {
  if (!baseDir) {
    throw new UploadError(
      "Attaching files is disabled. Set the MCP_UPLOAD_BASE_DIR environment " +
        "variable to the folder holding the files, then restart the MCP server.",
    );
  }
  const requested = path.isAbsolute(name) ? name : path.join(baseDir, name);
  let canonical: string;
  try {
    canonical = validateUploadPath(requested, {
      allowedExtensions: ATTACHMENT_EXTENSIONS,
      maxSizeBytes: FILE_MAX_BYTES,
      allowedBaseDir: baseDir,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("File not found")) {
      throw new UploadError(notFound(name, baseDir));
    }
    throw new UploadError(message);
  }
  const ext = path.extname(canonical).toLowerCase();
  // Read once and upload exactly these bytes: the declared size and the uploaded body
  // can then never disagree, whatever happens to the file meanwhile.
  const bytes = fs.readFileSync(canonical);
  if (IMAGE_EXTS.has(ext) && bytes.length > IMAGE_MAX_BYTES) {
    throw new UploadError(
      `${path.basename(canonical)}: images are limited to ${IMAGE_MAX_BYTES / MB} MB.`,
    );
  }
  if (bytes.length === 0) {
    throw new UploadError(`${path.basename(canonical)} is empty.`);
  }
  return { name: path.basename(canonical), bytes, mime: MIME_BY_EXT[ext] };
}

/** Names the files that ARE there, so the caller can pick the one that was meant. */
function notFound(name: string, baseDir: string): string {
  let listed: string[] = [];
  try {
    listed = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          !e.name.startsWith(".") &&
          ATTACHMENT_EXTENSIONS.includes(path.extname(e.name).toLowerCase()),
      )
      .map((e) => e.name)
      .sort();
  } catch {
    listed = [];
  }
  const shown = listed.slice(0, LISTED_FILES);
  const more =
    listed.length > shown.length
      ? ` (and ${listed.length - shown.length} more)`
      : "";
  return shown.length
    ? `No file named "${name}" in the upload folder. Files there: ${shown.join(", ")}${more}.`
    : `No file named "${name}" in the upload folder, which has no files that can be attached.`;
}

/** Upload every file and return the attachment ids, in order. All or nothing. */
export async function uploadFiles(
  names: string[],
  deps: UploadDeps,
): Promise<UploadedFile[]> {
  if (names.length > MAX_FILES) {
    throw new UploadError(
      `At most ${MAX_FILES} files can be attached per message.`,
    );
  }
  // Every file is read and checked before anything is sent, so a bad name late in the
  // list does not leave earlier uploads behind.
  const files = names.map((n) => readUploadFile(n, deps.baseDir));
  const uploaded: UploadedFile[] = [];
  for (const file of files) {
    deps.progress?.(`Uploading ${file.name}`);
    uploaded.push({ id: await uploadOne(file, deps), name: file.name });
  }
  return uploaded;
}

interface Slot {
  id: string;
  url: string;
  fields: Record<string, unknown>;
}

/** Reserve one upload; checked before anything is sent to where it points. */
async function requestSlot(
  name: string,
  bytes: number,
  mime: string,
  deps: Pick<UploadDeps, "agentUrl" | "headers" | "product" | "fetchImpl">,
): Promise<Slot> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.agentUrl.replace(/\/+$/, "");
  const slot = await atlasJson(fetchImpl, `${base}/attachments`, {
    method: "POST",
    headers: { ...deps.headers, "content-type": "application/json" },
    body: JSON.stringify({ product: deps.product, name, bytes, mime }),
  });
  const upload = (slot.upload ?? {}) as Record<string, unknown>;
  const id = String(slot.id ?? "");
  const url = String(upload.url ?? "");
  if (!ATTACHMENT_ID.test(id)) {
    throw new UploadError("BrowserStack AI returned an unusable upload slot.");
  }
  assertStorageUrl(url);
  return { id, url, fields: (upload.fields ?? {}) as Record<string, unknown> };
}

async function uploadOne(file: LocalFile, deps: UploadDeps): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { id, url, fields } = await requestSlot(
    file.name,
    file.bytes.length,
    file.mime,
    deps,
  );
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append(
    "file",
    new Blob([new Uint8Array(file.bytes)], { type: file.mime }),
    file.name,
  );
  const put = await fetchImpl(url, { method: "POST", body: form });
  if (!put.ok) {
    throw new UploadError(
      `Uploading ${file.name} failed (storage answered ${put.status}).`,
    );
  }
  return id;
}

// --- the hosted server: the client sends the bytes ---------------------------

export interface RemoteFile {
  /** The path the client will upload from, as it will appear in the command. */
  name: string;
  /** Its exact size in bytes. */
  bytes: number;
}

export interface RemoteUpload {
  name: string;
  attachment_id: string;
  command: string;
}

/**
 * Reserve an upload per file and return the command that sends each one. Every file is
 * checked before any upload is reserved, as locally.
 */
export async function prepareRemoteUploads(
  files: RemoteFile[],
  deps: Pick<UploadDeps, "agentUrl" | "headers" | "product" | "fetchImpl">,
): Promise<RemoteUpload[]> {
  if (files.length > MAX_FILES) {
    throw new UploadError(
      `At most ${MAX_FILES} files can be attached per message.`,
    );
  }
  const checked = files.map(checkRemoteFile);
  const out: RemoteUpload[] = [];
  for (const f of checked) {
    const slot = await requestSlot(f.base, f.bytes, f.mime, deps);
    out.push({
      name: f.base,
      attachment_id: slot.id,
      command: curlCommand(slot, f.path),
    });
  }
  return out;
}

function checkRemoteFile(file: RemoteFile): {
  path: string;
  base: string;
  bytes: number;
  mime: string;
} {
  const p = String(file?.name ?? "").trim();
  // `-F file=@path` reads `;` and `"` as its own syntax, and a line break would end the
  // command: such a path is refused rather than escaped into something else.
  if (!p || /[;"\r\n\0]/.test(p)) {
    throw new UploadError(
      `"${p}" cannot be uploaded this way; rename the file without ; or " in its path.`,
    );
  }
  const base = path.basename(p.replace(/\\/g, "/"));
  const ext = path.extname(base).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new UploadError(
      `${base}: file type "${ext || "(none)"}" cannot be attached ` +
        `(allowed: ${ATTACHMENT_EXTENSIONS.join(", ")}).`,
    );
  }
  const bytes = Number(file.bytes);
  const cap = IMAGE_EXTS.has(ext) ? IMAGE_MAX_BYTES : FILE_MAX_BYTES;
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new UploadError(
      `${base}: give its exact size in bytes (for example from \`wc -c\`).`,
    );
  }
  if (bytes > cap) {
    throw new UploadError(
      `${base}: ${IMAGE_EXTS.has(ext) ? "images" : "files"} are limited to ${cap / MB} MB.`,
    );
  }
  return { path: p, base, bytes, mime };
}

/** POSIX single quotes: nothing inside is expanded by the shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The slot's fields first and the file last. */
function curlCommand(slot: Slot, filePath: string): string {
  const parts = ["curl -sSf -X POST"];
  for (const [k, v] of Object.entries(slot.fields)) {
    parts.push(`-F ${shellQuote(`${k}=${String(v)}`)}`);
  }
  parts.push(`-F ${shellQuote(`file=@${filePath}`)}`);
  parts.push(shellQuote(slot.url));
  return parts.join(" ");
}

/** The upload location must be an expected https URL. */
function assertStorageUrl(url: string): void {
  let host = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") host = parsed.hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (!host || !(host === "amazonaws.com" || host.endsWith(".amazonaws.com"))) {
    throw new UploadError(
      "BrowserStack AI returned an unexpected upload location.",
    );
  }
}

async function atlasJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, init);
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const detail = String(body.detail || body.error || res.statusText || "");
    throw new UploadError(
      `BrowserStack AI refused the upload (${res.status})${detail ? `: ${detail}` : ""}.`,
    );
  }
  return body;
}
