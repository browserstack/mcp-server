import { createHash } from "node:crypto";
import { BrowserStackConfig } from "../../lib/types.js";

/**
 * Remove the caller's BrowserStack credentials from any text before it leaves
 * the server (tool results, logs, telemetry).
 *
 * Appium/WebDriver errors can echo the new-session request, and URL-embedded
 * hub auth (`https://user:key@hub...`) shows up in stack traces, so every
 * device-session error passes through here.
 */
export function scrubSecrets(text: string, config: BrowserStackConfig): string {
  let out = String(text ?? "");
  const secrets = [
    config["browserstack-access-key"],
    config["browserstack-username"],
  ]
    .filter((s): s is string => typeof s === "string" && s.length >= 4)
    // Longest first, so a key that contains the username is removed whole.
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    out = out.split(secret).join("[redacted]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join("[redacted]");
  }
  // Any other `scheme://user:pass@` that slipped in.
  return out.replace(/\b(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@");
}

export function errorMessage(
  error: unknown,
  config: BrowserStackConfig,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  // WebDriver errors are often multi-line with a server stack; the first lines
  // carry the useful part.
  const trimmed = raw.split("\n").slice(0, 6).join("\n").slice(0, 1500);
  return scrubSecrets(trimmed, config);
}

/**
 * Who owns a session: a hash of username AND access key. Matching on the
 * username alone would let anyone who got past login with that username, but a
 * different key, reach sessions driven with the real owner's key.
 */
export function ownerKey(config: BrowserStackConfig): string {
  return createHash("sha256")
    .update(
      `${config["browserstack-username"]}\0${config["browserstack-access-key"]}`,
    )
    .digest("hex");
}
