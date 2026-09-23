import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const RECOMMENDED_NODE_MAJOR = 22;

export function nodeUpgradeNotice(
  version: string = process.versions.node,
): string {
  const major = Number(version.split(".")[0]) || 0;
  if (major >= RECOMMENDED_NODE_MAJOR) return "";
  return (
    `⚠️ Please use Node version > ${RECOMMENDED_NODE_MAJOR - 1}.x.x ` +
    `(Node ${RECOMMENDED_NODE_MAJOR} LTS recommended). This server is running on ` +
    `Node ${version}; older versions will be unsupported.`
  );
}

export function withNodeUpgradeNotice<T extends CallToolResult>(
  result: T,
  notice: string = nodeUpgradeNotice(),
): T {
  if (!notice || !result || !Array.isArray(result.content)) return result;
  return {
    ...result,
    content: [...result.content, { type: "text", text: notice }],
  };
}
