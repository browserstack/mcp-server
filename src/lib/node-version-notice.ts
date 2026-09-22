import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Returns a user-facing upgrade nudge for runtimes below Node 22 (> 21.x.x),
 * or "" on supported runtimes. sharp 0.35.x needs Node >= 20.9 (image
 * compression is disabled below that via graceful fallback), and an upcoming
 * release will require Node >= 22 — so we steer users to Node 22 LTS.
 */
export function nodeUpgradeNotice(
  version: string = process.versions.node,
): string {
  const major = Number(version.split(".")[0]) || 0;
  if (major >= 22) return "";
  return (
    `⚠️ Please use Node version > 21.x.x (Node 22 LTS recommended). ` +
    `This server is running on Node ${version}; older versions will be unsupported.`
  );
}

/**
 * Prepends the upgrade notice to a tool result's content when one applies.
 * A no-op (returns the result unchanged) on Node >= 22 or for malformed results.
 */
export function withNodeUpgradeNotice<T extends CallToolResult>(
  result: T,
  notice: string = nodeUpgradeNotice(),
): T {
  if (!notice || !result || !Array.isArray(result.content)) return result;
  return {
    ...result,
    content: [{ type: "text", text: notice }, ...result.content],
  };
}
