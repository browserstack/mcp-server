import logger from "../logger.js";
import globalConfig from "../config.js";

const ONE_MB = 1048576;
// sharp's default (~268M px) lets one image decode to ~1 GB of RGBA; 25M px caps it near 100 MB.
const MAX_INPUT_PIXELS = 25_000_000;
const MAX_IMAGE_DIMENSION = 1920;
let sharpConfigured = false;

//Compresses a base64 image intelligently to keep it under 1 MB if needed.
export async function maybeCompressBase64(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length <= ONE_MB) {
    return base64;
  }

  const sizeRatio = 1048576 / buffer.length;
  const estimatedQuality = Math.floor(sizeRatio * 100);
  const quality = Math.min(95, Math.max(30, estimatedQuality));

  try {
    const { default: sharp } = await import("sharp");
    if (!sharpConfigured && globalConfig.REMOTE_MCP) {
      // Bound memory on constrained hosted pods: no libvips cache, single worker thread.
      sharp.cache(false);
      sharp.concurrency(1);
      sharpConfigured = true;
    }
    const image = globalConfig.REMOTE_MCP
      ? sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).resize({
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
      : sharp(buffer);
    const compressedBuffer = await image.png({ quality }).toBuffer();
    return compressedBuffer.toString("base64");
  } catch (err) {
    logger.warn(
      "Image compression failed; returning the uncompressed image. %s",
      err instanceof Error ? err.message : String(err),
    );
    return base64;
  }
}
