import { PercyClient } from "../../../lib/percy-api/client.js";
import { pollUntil } from "../../../lib/percy-api/polling.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetRca(
  args: { comparison_id: string; trigger_if_missing?: boolean },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);
  const triggerIfMissing = args.trigger_if_missing !== false; // default true

  // Step 1: Check existing RCA status
  // GET /rca?comparison_id={id}
  // Response has: status (pending/finished/failed), diffNodes (when finished)

  let rcaData: any;
  try {
    rcaData = await client.get("/rca", { "comparison_id": args.comparison_id });
  } catch (e: any) {
    // 404 means RCA not started
    if (e.statusCode === 404 && triggerIfMissing) {
      // Step 2: Trigger RCA
      try {
        await client.post("/rca", {
          data: {
            type: "rca",
            attributes: { "comparison-id": args.comparison_id }
          }
        });
      } catch (triggerError: any) {
        if (triggerError.statusCode === 422) {
          return { content: [{ type: "text", text: "RCA requires DOM metadata. This comparison type does not support RCA." }], isError: true };
        }
        throw triggerError;
      }
      rcaData = { status: "pending" };
    } else if (e.statusCode === 404) {
      return { content: [{ type: "text", text: "RCA not yet triggered for this comparison. Set trigger_if_missing=true to start it." }] };
    } else {
      throw e;
    }
  }

  // Step 3: Poll if pending
  if (rcaData?.status === "pending") {
    const result = await pollUntil(async () => {
      const data = await client.get<any>("/rca", { "comparison_id": args.comparison_id });
      if (data?.status === "finished") return { done: true, result: data };
      if (data?.status === "failed") return { done: true, result: data };
      return { done: false };
    }, { initialDelayMs: 500, maxDelayMs: 5000, maxTimeoutMs: 120000 });

    if (!result) {
      return { content: [{ type: "text", text: "RCA analysis timed out after 2 minutes. The analysis may still be processing — try again later." }] };
    }
    rcaData = result;
  }

  if (rcaData?.status === "failed") {
    return { content: [{ type: "text", text: "RCA analysis failed. The comparison may not have sufficient DOM metadata." }], isError: true };
  }

  // Step 4: Format diff nodes
  const diffNodes = rcaData?.diffNodes || rcaData?.diff_nodes || {};
  const commonDiffs = diffNodes.common_diffs || [];
  const extraBase = diffNodes.extra_base || [];
  const extraHead = diffNodes.extra_head || [];

  let output = `## Root Cause Analysis — Comparison #${args.comparison_id}\n\n`;
  output += `**Status:** ${rcaData?.status || "unknown"}\n\n`;

  if (commonDiffs.length > 0) {
    output += `### Changed Elements (${commonDiffs.length})\n\n`;
    commonDiffs.forEach((diff: any, i: number) => {
      const base = diff.base || {};
      const head = diff.head || {};
      const tag = head.tagName || base.tagName || "unknown";
      const xpath = head.xpath || base.xpath || "";
      const diffType = head.diff_type === 1 ? "DIFF" : head.diff_type === 2 ? "IGNORED" : "unknown";
      output += `${i + 1}. **${tag}** (${diffType})\n`;
      if (xpath) output += `   XPath: \`${xpath}\`\n`;
      // Show attribute differences
      const baseAttrs = base.attributes || {};
      const headAttrs = head.attributes || {};
      const allKeys = new Set([...Object.keys(baseAttrs), ...Object.keys(headAttrs)]);
      for (const key of allKeys) {
        if (JSON.stringify(baseAttrs[key]) !== JSON.stringify(headAttrs[key])) {
          output += `   ${key}: \`${baseAttrs[key] ?? "N/A"}\` → \`${headAttrs[key] ?? "N/A"}\`\n`;
        }
      }
      output += "\n";
    });
  }

  if (extraBase.length > 0) {
    output += `### Removed Elements (${extraBase.length})\n\n`;
    extraBase.forEach((node: any, i: number) => {
      const detail = node.node_detail || node;
      output += `${i + 1}. **${detail.tagName || "unknown"}** — removed from head\n`;
      if (detail.xpath) output += `   XPath: \`${detail.xpath}\`\n`;
      output += "\n";
    });
  }

  if (extraHead.length > 0) {
    output += `### Added Elements (${extraHead.length})\n\n`;
    extraHead.forEach((node: any, i: number) => {
      const detail = node.node_detail || node;
      output += `${i + 1}. **${detail.tagName || "unknown"}** — added in head\n`;
      if (detail.xpath) output += `   XPath: \`${detail.xpath}\`\n`;
      output += "\n";
    });
  }

  if (commonDiffs.length === 0 && extraBase.length === 0 && extraHead.length === 0) {
    output += "No DOM differences found.\n";
  }

  return { content: [{ type: "text", text: output }] };
}
