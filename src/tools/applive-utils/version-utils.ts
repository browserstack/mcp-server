import { resolveVersion } from "../../lib/version-resolver.js";
import { CallerError } from "../../lib/error.js";

/**
 * Resolve desired version against available list
 */
export function pickVersion(available: string[], requested: string): string {
  try {
    return resolveVersion(requested, available);
  } catch {
    const opts = available.join(", ");
    throw new CallerError(
      `Version "${requested}" not found. Available versions: ${opts}`,
    );
  }
}
