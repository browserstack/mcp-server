import sharp from "sharp";

export function sanitizeUrlParam(param: string): string {
  // Remove any characters that could be used for command injection
  return param.replace(/[;&|`$(){}[\]<>]/g, "");
}

export interface HarFile {
  log: {
    entries: HarEntry[];
  };
}

export interface HarEntry {
  startedDateTime: string;
  request: {
    method: string;
    url: string;
    queryString?: { name: string; value: string }[];
  };
  response: {
    status: number;
    statusText?: string;
    _error?: string;
  };
  serverIPAddress?: string;
  time?: number;
}

/**
 * Compresses a base64 image intelligently to keep it under 1 MB if needed.
 */
export async function maybeCompressBase64(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length <= 1048576) {
    return base64;
  }

  const sizeRatio = 1048576 / buffer.length;
  const estimatedQuality = Math.floor(sizeRatio * 100);
  const quality = Math.min(95, Math.max(30, estimatedQuality)); 

  const compressedBuffer = await sharp(buffer)
    .png({ quality })
    .toBuffer();

  return compressedBuffer.toString("base64");
}