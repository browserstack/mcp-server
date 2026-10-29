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
 * string at that path is detached, the body keeps a short note in its place, and the
 * image rides alongside the JSON as a second content block. A body that carries no string
 * there — an error envelope, an empty screen — is handed back untouched, so nothing a
 * product sends is ever lost to this step.
 */
import { Capability } from "./types.js";

/** What an MCP client will render. Anything else would arrive as an opaque attachment. */
const RENDERABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export interface DetachedImage {
  /** Base64 of the image, exactly as the product sent it. */
  data: string;
  mimeType: string;
  /** Decoded size, so the caller can be told what it was handed. */
  bytes: number;
}

/** Refuse an index whose `media` could not be acted on, at load rather than at the call. */
export function checkMedia(product: string, capabilities: Capability[]): void {
  for (const capability of capabilities) {
    const media = capability.media;
    if (!media) continue;
    if (!RENDERABLE.has(media.mime))
      throw new Error(
        `${product}.${capability.name}: media.mime '${media.mime}' is not an image type a ` +
          `client renders (${[...RENDERABLE].join(", ")})`,
      );
    if (!media.json_path.startsWith("/"))
      throw new Error(
        `${product}.${capability.name}: media.json_path '${media.json_path}' must be a ` +
          "JSON pointer, starting with '/'",
      );
  }
}

/**
 * The body with the image replaced by a note, and the image itself — or the body as it
 * was, when there is nothing at the path to detach.
 */
export function detachImage(
  capability: Capability,
  body: unknown,
): { body: unknown; image?: DetachedImage } {
  const media = capability.media;
  if (!media) return { body };
  const keys = media.json_path.split("/").slice(1).map(unescapePointer);
  if (!keys.length) return { body };

  const parent = keys
    .slice(0, -1)
    .reduce<unknown>(
      (node, key) => (isRecord(node) ? node[key] : undefined),
      body,
    );
  const last = keys[keys.length - 1];
  if (!isRecord(parent)) return { body };
  const value = parent[last];
  if (typeof value !== "string" || !value) return { body };

  const bytes = decodedLength(value);
  const image = { data: value, mimeType: media.mime, bytes };
  const replaced = setAt(
    body,
    keys,
    `<${media.mime}, ${describeSize(bytes)}, attached to this result as an image>`,
  );
  return { body: replaced, image };
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

/** Decoded byte count of a base64 string, without decoding it. */
function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
