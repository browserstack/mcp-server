/**
 * Lift an image out of a response body, so it can travel as an MCP image block.
 *
 * A WebDriver screenshot is `{"value": "<base64 png>"}`, and a phone screen runs to
 * hundreds of kilobytes. Handed back inside the JSON text block it is the worst of both
 * worlds: the model pays for every base64 character as text and still cannot see the
 * picture, because text is text. An MCP `image` content block is what clients render and
 * what the model actually looks at, and it is billed as an image, not as a wall of tokens.
 *
 * A capability says where its image sits with `media: {mime, json_path}`. On a 2xx the
 * string at that path is detached, and once the caller has compressed it a note with the
 * size ACTUALLY attached goes in its place. A body that carries no string there — an
 * error envelope, an empty screen — is handed back untouched, so nothing a product sends
 * is ever lost to this step.
 */
import { Capability } from "./types.js";

/**
 * The one type `media.mime` may declare. The compressor re-encodes anything over 1 MB as
 * PNG, so a JPEG declared here would be attached as PNG under a JPEG label; until the
 * compressor keeps the source format, the index may only promise what the block will be.
 */
export const MEDIA_TYPES = ["image/png"] as const;

export interface DetachedImage {
  /** Base64 of the image, exactly as the product sent it. */
  data: string;
  mimeType: string;
  /** Decoded size as sent, before any compression. */
  bytes: number;
  /** Where in the body it sat, so a note can be put there once the real size is known. */
  keys: string[];
}

/** The image at the capability's `media.json_path`, or nothing when the body has none there. */
export function detachImage(
  capability: Capability,
  body: unknown,
): DetachedImage | undefined {
  const media = capability.media;
  if (!media) return undefined;
  const keys = media.json_path.split("/").slice(1).map(unescapePointer);
  if (!keys.length) return undefined;

  const parent = keys
    .slice(0, -1)
    .reduce<unknown>(
      (node, key) => (isRecord(node) ? node[key] : undefined),
      body,
    );
  if (!isRecord(parent)) return undefined;
  const value = parent[keys[keys.length - 1]];
  if (typeof value !== "string" || !value) return undefined;
  return {
    data: value,
    mimeType: media.mime,
    bytes: decodedLength(value),
    keys,
  };
}

/**
 * The body with a note where the image was, naming what is attached: the type and the
 * size of the block the client receives, which after compression is not the size sent.
 */
export function noteImage(
  body: unknown,
  image: DetachedImage,
  attachedBytes: number,
): unknown {
  return setAt(
    body,
    image.keys,
    `<${image.mimeType}, ${describeSize(attachedBytes)}, attached to this result as an image>`,
  );
}

/** Decoded byte count of a base64 string, without decoding it. */
export function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** RFC 6901: `~1` is `/`, `~0` is `~`. */
function unescapePointer(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** A copy of `body` with the leaf at `keys` replaced; the originals are never mutated. */
function setAt(body: unknown, keys: string[], leaf: unknown): unknown {
  if (!isRecord(body)) return body;
  const [head, ...rest] = keys;
  return {
    ...body,
    [head]: rest.length ? setAt(body[head], rest, leaf) : leaf,
  };
}

function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
