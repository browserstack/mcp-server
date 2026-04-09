/**
 * percy_get_build — Unified build details tool.
 *
 * Returns different data based on the `detail` parameter:
 * - overview (default): build status, snapshots, AI metrics
 * - ai_summary: AI-generated change descriptions, bugs, diffs
 * - changes: list of changed snapshots with diff ratios
 * - rca: root cause analysis (DOM/CSS changes) for a comparison
 * - logs: build failure suggestions and diagnostics
 * - network: network request logs for a comparison
 * - snapshots: all snapshots with review states
 */

import { percyGet, percyPost } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type DetailType =
  | "overview"
  | "ai_summary"
  | "changes"
  | "rca"
  | "logs"
  | "network"
  | "snapshots";

interface GetBuildArgs {
  build_id: string;
  detail?: DetailType;
  comparison_id?: string;
  snapshot_id?: string;
}

export async function percyGetBuildDetail(
  args: GetBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const detail = args.detail || "overview";

  switch (detail) {
    case "overview":
      return getOverview(args.build_id, config);
    case "ai_summary":
      return getAiSummary(args.build_id, config);
    case "changes":
      return getChanges(args.build_id, config);
    case "rca":
      return getRca(args, config);
    case "logs":
      return getLogs(args.build_id, config);
    case "network":
      return getNetwork(args, config);
    case "snapshots":
      return getSnapshots(args.build_id, config);
    default:
      return {
        content: [
          {
            type: "text",
            text: `Unknown detail type: ${detail}. Use: overview, ai_summary, changes, rca, logs, network, snapshots.`,
          },
        ],
        isError: true,
      };
  }
}

// ── Overview ────────────────────────────────────────────────────────────────

async function getOverview(
  buildId: string,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet(`/builds/${buildId}`, config, {
    include: "build-summary",
  });

  const build = response?.data || {};
  const attrs = build.attributes || {};
  const ai = attrs["ai-details"] || {};

  let output = `## Percy Build #${attrs["build-number"] || buildId}\n\n`;
  output += `| Field | Value |\n|---|---|\n`;
  output += `| **State** | ${attrs.state || "?"} |\n`;
  output += `| **Branch** | ${attrs.branch || "?"} |\n`;
  output += `| **Review** | ${attrs["review-state"] || "—"} |\n`;
  output += `| **Snapshots** | ${attrs["total-snapshots"] ?? "?"} |\n`;
  output += `| **Comparisons** | ${attrs["total-comparisons"] ?? "?"} |\n`;
  output += `| **Diffs** | ${attrs["total-comparisons-diff"] ?? "—"} |\n`;
  output += `| **Failed** | ${attrs["failed-snapshots-count"] ?? "—"} |\n`;
  output += `| **Unreviewed** | ${attrs["total-snapshots-unreviewed"] ?? "—"} |\n`;

  // Show AI data if any exists (don't rely on ai-enabled flag)
  if (
    (ai["total-comparisons-with-ai"] ?? 0) > 0 ||
    (ai["total-potential-bugs"] ?? 0) > 0
  ) {
    output += `| **AI Bugs** | ${ai["total-potential-bugs"] ?? "—"} |\n`;
    output += `| **AI Diffs** | ${ai["total-ai-visual-diffs"] ?? "—"} |\n`;
    output += `| **AI Reduced** | ${ai["total-diffs-reduced-capped"] ?? "—"} diffs filtered |\n`;
    output += `| **AI Analyzed** | ${ai["total-comparisons-with-ai"] ?? "—"} comparisons |\n`;
  }

  if (attrs["failure-reason"]) {
    output += `| **Failure** | ${attrs["failure-reason"]} |\n`;
  }

  const webUrl = attrs["web-url"];
  if (webUrl) output += `\n**View:** ${webUrl}\n`;

  // Quick summary
  const included = response?.included || [];
  const summaryObj = included.find((i: any) => i.type === "build-summaries");
  if (summaryObj?.attributes?.summary) {
    try {
      const summary =
        typeof summaryObj.attributes.summary === "string"
          ? JSON.parse(summaryObj.attributes.summary)
          : summaryObj.attributes.summary;
      if (summary.title) {
        output += `\n### AI Summary\n> ${summary.title}\n`;
      }
    } catch {
      /* ignore parse errors */
    }
  }

  output += `\n### Available Details\n`;
  output += `Use \`detail\` parameter for more:\n`;
  output += `- \`ai_summary\` — AI change descriptions and bugs\n`;
  output += `- \`changes\` — changed snapshots with diffs\n`;
  output += `- \`snapshots\` — all snapshots with review states\n`;
  output += `- \`logs\` — failure diagnostics\n`;
  output += `- \`rca\` — root cause analysis (needs comparison_id)\n`;
  output += `- \`network\` — network logs (needs comparison_id)\n`;

  return { content: [{ type: "text", text: output }] };
}

// ── AI Summary ──────────────────────────────────────────────────────────────

async function getAiSummary(
  buildId: string,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet(`/builds/${buildId}`, config, {
    include: "build-summary",
  });

  const attrs = response?.data?.attributes || {};
  const ai = attrs["ai-details"] || {};
  const buildNum = attrs["build-number"] || buildId;

  let output = `## Build #${buildNum} — AI Summary\n\n`;

  // Check if there's ANY AI data — don't rely on ai-enabled flag alone
  // ai-enabled can be false even when AI data exists (processed before toggle off)
  const hasAiData =
    (ai["total-comparisons-with-ai"] ?? 0) > 0 ||
    (ai["total-potential-bugs"] ?? 0) > 0 ||
    (ai["total-ai-visual-diffs"] ?? 0) > 0 ||
    ai["summary-status"] === "ok";

  if (!hasAiData) {
    output += `No AI analysis data found for this build.\n`;
    output += `AI may not be enabled for this project, or the build has no visual diffs.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  output += `**${ai["total-potential-bugs"] ?? 0} potential bugs** · **${ai["total-ai-visual-diffs"] ?? 0} AI visual diffs**\n\n`;

  if (ai["total-diffs-reduced-capped"] > 0) {
    output += `AI filtered **${ai["total-diffs-reduced-capped"]}** noisy diffs.\n`;
  }
  output += `${ai["total-comparisons-with-ai"] ?? 0} comparisons analyzed. Jobs: ${ai["all-ai-jobs-completed"] ? "done" : "in progress"}.\n\n`;

  // Parse build summary
  const included = response?.included || [];
  const summaryObj = included.find((i: any) => i.type === "build-summaries");

  if (summaryObj?.attributes?.summary) {
    try {
      const summary =
        typeof summaryObj.attributes.summary === "string"
          ? JSON.parse(summaryObj.attributes.summary)
          : summaryObj.attributes.summary;

      if (summary.title) output += `> ${summary.title}\n\n`;

      const items = summary.items || summary.changes || [];
      if (items.length > 0) {
        output += `### Changes\n\n`;
        items.forEach((item: any) => {
          const title = item.title || item.description || String(item);
          const occ = item.occurrences || item.count;
          output += `- **${title}**`;
          if (occ) output += ` (${occ} occurrences)`;
          output += "\n";
        });
      }
    } catch {
      /* ignore */
    }
  } else {
    const status = ai["summary-status"];
    if (status === "processing") {
      output += `Summary is being generated. Try again shortly.\n`;
    } else if (status === "skipped") {
      output += `Summary skipped: ${ai["summary-reason"] || "unknown"}.\n`;
    } else {
      output += `No AI summary available.\n`;
    }
  }

  return { content: [{ type: "text", text: output }] };
}

// ── Changes ─────────────────────────────────────────────────────────────────

async function getChanges(
  buildId: string,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet("/build-items", config, {
    "filter[build-id]": buildId,
    "filter[category]": "changed",
    "page[limit]": "30",
  });

  const items = response?.data || [];

  if (!items.length) {
    return {
      content: [
        {
          type: "text",
          text: `## Build #${buildId} — No Changes\n\nAll snapshots match the baseline.`,
        },
      ],
    };
  }

  let output = `## Build #${buildId} — Changed Snapshots (${items.length})\n\n`;
  output += `| # | Snapshot | Diff | Bugs | Review |\n|---|---|---|---|---|\n`;

  items.forEach((item: any, i: number) => {
    const name =
      item.attributes?.["cover-snapshot-name"] || item.coverSnapshotName || "?";
    const diff = item.attributes?.["max-diff-ratio"] ?? item.maxDiffRatio;
    const diffStr = diff != null ? `${(diff * 100).toFixed(1)}%` : "—";
    const bugs =
      item.attributes?.["max-bug-total-potential-bugs"] ??
      item.maxBugTotalPotentialBugs ??
      0;
    const review = item.attributes?.["review-state"] || item.reviewState || "?";
    output += `| ${i + 1} | ${name} | ${diffStr} | ${bugs} | ${review} |\n`;
  });

  return { content: [{ type: "text", text: output }] };
}

// ── RCA ─────────────────────────────────────────────────────────────────────

async function getRca(
  args: GetBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  if (!args.comparison_id) {
    return {
      content: [
        {
          type: "text",
          text: `RCA requires a comparison_id. Get one from:\n\`percy_get_build with build_id "${args.build_id}" and detail "changes"\``,
        },
      ],
      isError: true,
    };
  }

  // Check if RCA exists
  let rcaData: any;
  try {
    rcaData = await percyGet("/rca", config, {
      comparison_id: args.comparison_id,
    });
  } catch {
    // Trigger RCA
    try {
      await percyPost("/rca", config, {
        data: {
          attributes: { "comparison-id": args.comparison_id },
        },
      });
      return {
        content: [
          {
            type: "text",
            text: `## RCA Triggered\n\nRoot Cause Analysis started for comparison ${args.comparison_id}.\nRe-run this command in 30-60 seconds to see results.`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `RCA failed: ${e.message}. This comparison may not support RCA (requires DOM metadata).`,
          },
        ],
        isError: true,
      };
    }
  }

  const status = rcaData?.data?.attributes?.status || "unknown";

  if (status === "pending") {
    return {
      content: [
        {
          type: "text",
          text: `## RCA — Processing\n\nAnalysis in progress for comparison ${args.comparison_id}. Try again in 30 seconds.`,
        },
      ],
    };
  }

  if (status === "failed") {
    return {
      content: [
        {
          type: "text",
          text: `## RCA — Failed\n\nRoot cause analysis failed. This comparison may not have DOM metadata.`,
        },
      ],
    };
  }

  // Parse diff nodes
  let output = `## Root Cause Analysis — Comparison ${args.comparison_id}\n\n`;

  const diffNodes = rcaData?.data?.attributes?.["diff-nodes"] || {};
  const common = diffNodes.common_diffs || [];
  const removed = diffNodes.extra_base || [];
  const added = diffNodes.extra_head || [];

  if (common.length > 0) {
    output += `### Changed Elements (${common.length})\n\n`;
    common.slice(0, 15).forEach((diff: any, i: number) => {
      const base = diff.base || {};
      const head = diff.head || {};
      const tag = head.tagName || base.tagName || "element";
      const xpath = head.xpath || base.xpath || "";
      output += `${i + 1}. **${tag}**`;
      if (xpath) output += ` — \`${xpath}\``;
      output += "\n";
    });
    output += "\n";
  }

  if (removed.length > 0) {
    output += `### Removed (${removed.length})\n`;
    removed.slice(0, 10).forEach((n: any) => {
      output += `- ${n.node_detail?.tagName || "element"}\n`;
    });
    output += "\n";
  }

  if (added.length > 0) {
    output += `### Added (${added.length})\n`;
    added.slice(0, 10).forEach((n: any) => {
      output += `- ${n.node_detail?.tagName || "element"}\n`;
    });
    output += "\n";
  }

  if (!common.length && !removed.length && !added.length) {
    output += `No DOM differences found.\n`;
  }

  return { content: [{ type: "text", text: output }] };
}

// ── Logs ────────────────────────────────────────────────────────────────────

async function getLogs(
  buildId: string,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  let output = `## Build #${buildId} — Diagnostics\n\n`;

  // Get suggestions
  try {
    const response = await percyGet("/suggestions", config, {
      build_id: buildId,
    });

    const suggestions = response?.data || [];
    if (Array.isArray(suggestions) && suggestions.length > 0) {
      output += `### Suggestions\n\n`;
      suggestions.forEach((s: any, i: number) => {
        const attrs = s.attributes || s;
        output += `${i + 1}. **${attrs["bucket-display-name"] || attrs.bucket || "Issue"}**\n`;
        if (attrs["reason-message"])
          output += `   Reason: ${attrs["reason-message"]}\n`;
        const steps = attrs.suggestion || [];
        if (Array.isArray(steps)) {
          steps.forEach((step: string) => {
            output += `   - ${step}\n`;
          });
        }
        output += "\n";
      });
    } else {
      output += `No diagnostic suggestions found.\n\n`;
    }
  } catch {
    output += `Could not fetch suggestions.\n\n`;
  }

  // Get build failure info
  try {
    const buildResponse = await percyGet(`/builds/${buildId}`, config);
    const attrs = buildResponse?.data?.attributes || {};

    if (attrs["failure-reason"]) {
      output += `### Failure Info\n\n`;
      output += `**Reason:** ${attrs["failure-reason"]}\n`;

      const buckets = attrs["error-buckets"];
      if (Array.isArray(buckets) && buckets.length > 0) {
        output += `\n**Error Buckets:**\n`;
        buckets.forEach((b: any) => {
          output += `- ${b.bucket || b.name || "?"}: ${b.count || "?"} snapshot(s)\n`;
        });
      }
    }
  } catch {
    /* ignore */
  }

  return { content: [{ type: "text", text: output }] };
}

// ── Network ─────────────────────────────────────────────────────────────────

async function getNetwork(
  args: GetBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  if (!args.comparison_id) {
    return {
      content: [
        {
          type: "text",
          text: `Network logs require a comparison_id. Get one from:\n\`percy_get_build with build_id "${args.build_id}" and detail "changes"\``,
        },
      ],
      isError: true,
    };
  }

  const response = await percyGet("/network-logs", config, {
    comparison_id: args.comparison_id,
  });

  const logs = response?.data || response || {};
  const entries = Array.isArray(logs) ? logs : Object.values(logs);

  if (!entries.length) {
    return {
      content: [
        {
          type: "text",
          text: `No network logs for comparison ${args.comparison_id}.`,
        },
      ],
    };
  }

  let output = `## Network Logs — Comparison ${args.comparison_id}\n\n`;
  output += `| URL | Base | Head | Type |\n|---|---|---|---|\n`;

  entries.slice(0, 30).forEach((entry: any) => {
    const url = entry.domain || entry.file || entry.url || "?";
    const base = entry["base-status"] || entry.baseStatus || "—";
    const head = entry["head-status"] || entry.headStatus || "—";
    const type = entry.mimetype || entry.type || "—";
    output += `| ${url} | ${base} | ${head} | ${type} |\n`;
  });

  return { content: [{ type: "text", text: output }] };
}

// ── Snapshots ───────────────────────────────────────────────────────────────

async function getSnapshots(
  buildId: string,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet("/build-items", config, {
    "filter[build-id]": buildId,
    "page[limit]": "30",
  });

  const items = response?.data || [];

  if (!items.length) {
    return {
      content: [
        { type: "text", text: `No snapshots found for build ${buildId}.` },
      ],
    };
  }

  let output = `## Build #${buildId} — Snapshots (${items.length})\n\n`;
  output += `| # | Name | Diff | Review | Items |\n|---|---|---|---|---|\n`;

  items.forEach((item: any, i: number) => {
    const name =
      item.attributes?.["cover-snapshot-name"] || item.coverSnapshotName || "?";
    const diff = item.attributes?.["max-diff-ratio"] ?? item.maxDiffRatio;
    const diffStr = diff != null ? `${(diff * 100).toFixed(1)}%` : "—";
    const review = item.attributes?.["review-state"] || item.reviewState || "?";
    const count = item.attributes?.["item-count"] || item.itemCount || 1;
    output += `| ${i + 1} | ${name} | ${diffStr} | ${review} | ${count} |\n`;
  });

  return { content: [{ type: "text", text: output }] };
}
