/**
 * percy_get_build — Unified build details tool.
 *
 * detail param routes to different views:
 * - overview: status, stats, AI metrics, browsers, summary preview
 * - ai_summary: full AI change descriptions with occurrences
 * - changes: changed snapshots with diff ratios and bugs
 * - rca: root cause analysis for a comparison
 * - logs: failure diagnostics and suggestions
 * - network: network request logs for a comparison
 * - snapshots: all snapshots with review states
 */

import {
  percyGet,
  percyPost,
} from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface GetBuildArgs {
  build_id: string;
  detail?: string;
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
            text: `Unknown detail: ${detail}. Use: overview, ai_summary, changes, rca, logs, network, snapshots.`,
          },
        ],
        isError: true,
      };
  }
}

// ── Helper: parse build response ────────────────────────────────────────────

function parseBuild(response: any) {
  const attrs = response?.data?.attributes || {};
  const ai = attrs["ai-details"] || {};
  const included = response?.included || [];
  const rels = response?.data?.relationships || {};

  // Parse browsers from unique-browsers-across-snapshots (more detailed)
  const uniqueBrowsers = (
    attrs["unique-browsers-across-snapshots"] || []
  ).map((b: any) => {
    const bf = b.browser_family || {};
    const os = b.operating_system || {};
    const dp = b.device_pool || {};
    return `${bf.name || "?"} ${b.version || ""} on ${os.name || "?"} ${os.version || ""} ${dp.name || ""}`.trim();
  });

  // Parse build summary
  let summaryItems: any[] = [];
  const summaryObj = included.find(
    (i: any) => i.type === "build-summaries",
  );
  if (summaryObj?.attributes?.summary) {
    const raw = summaryObj.attributes.summary;
    try {
      summaryItems =
        typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(summaryItems)) summaryItems = [];
    } catch {
      summaryItems = [];
    }
  }

  // Parse commit
  const commitObj = included.find(
    (i: any) => i.type === "commits",
  );
  const commit = commitObj?.attributes || {};

  // Base build
  const baseBuildId = rels["base-build"]?.data?.id;

  const hasAiData =
    (ai["total-comparisons-with-ai"] ?? 0) > 0 ||
    (ai["total-potential-bugs"] ?? 0) > 0 ||
    (ai["total-ai-visual-diffs"] ?? 0) > 0 ||
    ai["summary-status"] === "ok";

  return {
    attrs,
    ai,
    included,
    uniqueBrowsers,
    summaryItems,
    commit,
    baseBuildId,
    hasAiData,
  };
}

// ── Overview ────────────────────────────────────────────────────────────────

async function getOverview(
  buildId: string,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const response = await percyGet(`/builds/${buildId}`, config, {
    include: "build-summary,browsers,commit",
  });

  const {
    attrs,
    ai,
    uniqueBrowsers,
    summaryItems,
    commit,
    baseBuildId,
    hasAiData,
  } = parseBuild(response);

  const buildNum = attrs["build-number"] || buildId;

  let output = `## Percy Build #${buildNum}\n\n`;

  // Status table
  output += `| Field | Value |\n|---|---|\n`;
  output += `| **State** | ${attrs.state || "?"} |\n`;
  output += `| **Branch** | ${attrs.branch || "?"} |\n`;
  output += `| **Review** | ${attrs["review-state"] || "—"} (${attrs["review-state-reason"] || ""}) |\n`;
  output += `| **Type** | ${attrs.type || "?"} |\n`;
  if (commit.sha)
    output += `| **Commit** | ${commit.sha?.slice(0, 8)} — ${commit.message || "no message"} |\n`;
  if (commit["author-name"])
    output += `| **Author** | ${commit["author-name"]} |\n`;
  if (baseBuildId)
    output += `| **Base build** | #${baseBuildId} |\n`;

  // Stats
  output += `\n### Stats\n\n`;
  output += `| Metric | Value |\n|---|---|\n`;
  output += `| Snapshots | ${attrs["total-snapshots"] ?? "?"} |\n`;
  output += `| Comparisons | ${attrs["total-comparisons"] ?? "?"} |\n`;
  output += `| With diffs | ${attrs["total-comparisons-diff"] ?? "—"} |\n`;
  output += `| Unreviewed | ${attrs["total-snapshots-unreviewed"] ?? "—"} |\n`;
  output += `| Failed | ${attrs["failed-snapshots-count"] ?? 0} |\n`;
  output += `| Comments | ${attrs["total-open-comments"] ?? 0} |\n`;
  output += `| Issues | ${attrs["total-open-issues"] ?? 0} |\n`;

  // AI metrics
  if (hasAiData) {
    output += `\n### AI Analysis\n\n`;
    output += `| Metric | Value |\n|---|---|\n`;
    output += `| Potential bugs | **${ai["total-potential-bugs"] ?? 0}** |\n`;
    output += `| AI visual diffs | ${ai["total-ai-visual-diffs"] ?? 0} |\n`;
    output += `| Diffs reduced | ${ai["total-diffs-reduced-capped"] ?? 0} filtered |\n`;
    output += `| Comparisons analyzed | ${ai["total-comparisons-with-ai"] ?? 0} |\n`;
    output += `| Jobs | ${ai["all-ai-jobs-completed"] ? "completed" : "in progress"} |\n`;
  }

  // Browsers
  if (uniqueBrowsers.length > 0) {
    output += `\n### Browsers (${uniqueBrowsers.length})\n\n`;
    uniqueBrowsers.forEach((b: string) => {
      output += `- ${b}\n`;
    });
  }

  // AI Summary preview
  if (summaryItems.length > 0) {
    output += `\n### AI Summary (${summaryItems.length} changes)\n\n`;
    summaryItems.slice(0, 3).forEach((item: any) => {
      output += `- **${item.title}** (${item.occurrences} occurrences)\n`;
    });
    if (summaryItems.length > 3) {
      output += `- ... and ${summaryItems.length - 3} more\n`;
    }
    output += `\nUse \`detail "ai_summary"\` for full details.\n`;
  }

  // Failure info
  if (attrs["failure-reason"]) {
    output += `\n### Failure\n\n`;
    output += `**Reason:** ${attrs["failure-reason"]}\n`;
    if (attrs["failure-details"])
      output += `**Details:** ${attrs["failure-details"]}\n`;
    const buckets = attrs["error-buckets"];
    if (Array.isArray(buckets) && buckets.length > 0) {
      output += `\n**Error categories:**\n`;
      buckets.forEach((b: any) => {
        output += `- ${b.bucket || b.name || "?"}: ${b.count ?? "?"} snapshot(s)\n`;
      });
    }
  }

  // Timing
  if (attrs["created-at"]) {
    output += `\n### Timing\n\n`;
    output += `| | |\n|---|---|\n`;
    output += `| Created | ${attrs["created-at"]} |\n`;
    if (attrs["finished-at"])
      output += `| Finished | ${attrs["finished-at"]} |\n`;
    if (attrs["percy-processing-duration"])
      output += `| Processing | ${attrs["percy-processing-duration"]}s |\n`;
    if (attrs["build-processing-duration"])
      output += `| Total | ${attrs["build-processing-duration"]}s |\n`;
  }

  // URL
  if (attrs["web-url"])
    output += `\n**View:** ${attrs["web-url"]}\n`;

  // Available details
  output += `\n### More Details\n\n`;
  output += `| Command | Shows |\n|---|---|\n`;
  output += `| \`detail "ai_summary"\` | Full AI change descriptions with occurrences |\n`;
  output += `| \`detail "changes"\` | Changed snapshots with diff ratios |\n`;
  output += `| \`detail "snapshots"\` | All snapshots with review states |\n`;
  output += `| \`detail "logs"\` | Failure diagnostics and suggestions |\n`;
  output += `| \`detail "rca"\` | Root cause analysis (needs comparison_id) |\n`;
  output += `| \`detail "network"\` | Network logs (needs comparison_id) |\n`;

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

  const { attrs, ai, summaryItems, hasAiData } =
    parseBuild(response);
  const buildNum = attrs["build-number"] || buildId;

  let output = `## Build #${buildNum} — AI Summary\n\n`;

  if (!hasAiData) {
    output += `No AI analysis data found for this build.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // AI stats
  output += `**${ai["total-potential-bugs"] ?? 0} potential bugs** · **${ai["total-ai-visual-diffs"] ?? 0} AI visual diffs** · **${ai["total-diffs-reduced-capped"] ?? 0} diffs filtered**\n\n`;
  output += `${ai["total-comparisons-with-ai"] ?? 0} of ${attrs["total-comparisons"] ?? "?"} comparisons analyzed by AI.\n\n`;

  // Summary items with full detail
  if (summaryItems.length > 0) {
    output += `### Changes (${summaryItems.length})\n\n`;
    summaryItems.forEach((item: any, i: number) => {
      output += `#### ${i + 1}. ${item.title}\n\n`;
      output += `**Occurrences:** ${item.occurrences}\n`;

      const snaps = item.snapshots || [];
      if (snaps.length > 0) {
        output += `**Affected snapshots:** ${snaps.length}\n`;
        const totalComps = snaps.reduce(
          (sum: number, s: any) =>
            sum + (s.comparisons?.length || 0),
          0,
        );
        output += `**Affected comparisons:** ${totalComps}\n`;

        // Show snapshot IDs and comparison details
        output += `\n| Snapshot | Comparisons | Dimensions |\n|---|---|---|\n`;
        snaps.slice(0, 5).forEach((s: any) => {
          const comps = s.comparisons || [];
          const dims = comps
            .map(
              (c: any) =>
                `${c.width || "?"}×${c.height || "?"}`,
            )
            .join(", ");
          output += `| ${s.snapshot_id} | ${comps.length} | ${dims} |\n`;
        });
        if (snaps.length > 5) {
          output += `| ... | +${snaps.length - 5} more | |\n`;
        }
      }
      output += "\n";
    });
  } else {
    output += `AI analysis complete but no summary items generated.\n`;
    if (ai["summary-status"] && ai["summary-status"] !== "ok") {
      output += `Summary status: ${ai["summary-status"]}`;
      if (ai["summary-reason"])
        output += ` — ${ai["summary-reason"]}`;
      output += "\n";
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
  output += `| # | Snapshot | Display Name | Diff | Bugs | Review | Comparisons |\n|---|---|---|---|---|---|---|\n`;

  items.forEach((item: any, i: number) => {
    const a = item.attributes || item;
    const name =
      a["cover-snapshot-name"] || a.coverSnapshotName || "?";
    const displayName =
      a["cover-snapshot-display-name"] ||
      a.coverSnapshotDisplayName ||
      "";
    const diff =
      (a["max-diff-ratio"] ?? a.maxDiffRatio) != null
        ? ((a["max-diff-ratio"] ?? a.maxDiffRatio) * 100).toFixed(
            1,
          ) + "%"
        : "—";
    const bugs =
      a["max-bug-total-potential-bugs"] ??
      a.maxBugTotalPotentialBugs ??
      0;
    const review =
      a["review-state"] || a.reviewState || "?";
    const count =
      a["item-count"] || a.itemCount || 1;
    output += `| ${i + 1} | ${name} | ${displayName || "—"} | ${diff} | ${bugs} | ${review} | ${count} |\n`;
  });

  output += `\nUse \`percy_get_snapshot\` with a snapshot ID from above for full details.\n`;

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
          text: `RCA requires a comparison_id.\n\nFind one with:\n\`Use percy_get_build with build_id "${args.build_id}" and detail "changes"\`\nThen: \`Use percy_get_snapshot with snapshot_id "..."\``,
        },
      ],
      isError: true,
    };
  }

  let rcaData: any;
  try {
    rcaData = await percyGet("/rca", config, {
      comparison_id: args.comparison_id,
    });
  } catch {
    try {
      await percyPost("/rca", config, {
        data: {
          attributes: {
            "comparison-id": args.comparison_id,
          },
        },
      });
      return {
        content: [
          {
            type: "text",
            text: `## RCA Triggered\n\nStarted for comparison ${args.comparison_id}. Re-run in 30-60 seconds.`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `RCA not available: ${e.message}\nThis comparison may not have DOM metadata.`,
          },
        ],
        isError: true,
      };
    }
  }

  const status =
    rcaData?.data?.attributes?.status || "unknown";

  if (status === "pending") {
    return {
      content: [
        {
          type: "text",
          text: `## RCA — Processing\n\nStill analyzing. Try again in 30 seconds.`,
        },
      ],
    };
  }

  if (status === "failed") {
    return {
      content: [
        {
          type: "text",
          text: `## RCA — Failed\n\nAnalysis failed. Missing DOM metadata.`,
        },
      ],
    };
  }

  let output = `## Root Cause Analysis — Comparison ${args.comparison_id}\n\n`;

  const diffNodes =
    rcaData?.data?.attributes?.["diff-nodes"] || {};
  const common = diffNodes.common_diffs || [];
  const removed = diffNodes.extra_base || [];
  const added = diffNodes.extra_head || [];

  if (common.length > 0) {
    output += `### Changed (${common.length})\n\n`;
    output += `| # | Element | XPath | Diff Type |\n|---|---|---|---|\n`;
    common.slice(0, 20).forEach((diff: any, i: number) => {
      const head = diff.head || {};
      const tag = head.tagName || "?";
      const xpath = (head.xpath || "").slice(0, 60);
      const dt =
        head.diff_type === 1
          ? "change"
          : head.diff_type === 2
            ? "ignored"
            : "?";
      output += `| ${i + 1} | ${tag} | \`${xpath}\` | ${dt} |\n`;
    });
    output += "\n";
  }

  if (removed.length > 0) {
    output += `### Removed (${removed.length})\n\n`;
    removed.slice(0, 10).forEach((n: any) => {
      const d = n.node_detail || n;
      output += `- ${d.tagName || "element"}`;
      if (d.xpath) output += ` — \`${d.xpath.slice(0, 60)}\``;
      output += "\n";
    });
    output += "\n";
  }

  if (added.length > 0) {
    output += `### Added (${added.length})\n\n`;
    added.slice(0, 10).forEach((n: any) => {
      const d = n.node_detail || n;
      output += `- ${d.tagName || "element"}`;
      if (d.xpath) output += ` — \`${d.xpath.slice(0, 60)}\``;
      output += "\n";
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

  // Build info
  try {
    const buildResponse = await percyGet(
      `/builds/${buildId}`,
      config,
    );
    const attrs = buildResponse?.data?.attributes || {};

    if (attrs["failure-reason"]) {
      output += `### Failure\n\n`;
      output += `**Reason:** ${attrs["failure-reason"]}\n`;
      if (attrs["failure-details"])
        output += `**Details:** ${attrs["failure-details"]}\n`;

      const buckets = attrs["error-buckets"];
      if (Array.isArray(buckets) && buckets.length > 0) {
        output += `\n**Error categories:**\n`;
        output += `| Category | Snapshots |\n|---|---|\n`;
        buckets.forEach((b: any) => {
          output += `| ${b.bucket || b.name || "?"} | ${b.count ?? "?"} |\n`;
        });
      }
      output += "\n";
    } else {
      output += `Build state: **${attrs.state || "?"}** — no failure recorded.\n\n`;
    }

    // Failed snapshots
    if ((attrs["failed-snapshots-count"] ?? 0) > 0) {
      output += `### Failed Snapshots (${attrs["failed-snapshots-count"]})\n\n`;
      try {
        const failedResponse = await percyGet(
          `/builds/${buildId}/failed-snapshots`,
          config,
        );
        const failed = failedResponse?.data || [];
        if (failed.length > 0) {
          output += `| # | Name |\n|---|---|\n`;
          failed.slice(0, 10).forEach((s: any, i: number) => {
            output += `| ${i + 1} | ${s.attributes?.name || s.name || "?"} |\n`;
          });
          output += "\n";
        }
      } catch {
        output += `Could not fetch failed snapshot details.\n\n`;
      }
    }
  } catch {
    output += `Could not fetch build info.\n\n`;
  }

  // Suggestions
  try {
    const sugResponse = await percyGet("/suggestions", config, {
      build_id: buildId,
    });
    const suggestions = sugResponse?.data || [];
    if (Array.isArray(suggestions) && suggestions.length > 0) {
      output += `### Suggestions (${suggestions.length})\n\n`;
      suggestions.forEach((s: any, i: number) => {
        const a = s.attributes || s;
        output += `${i + 1}. **${a["bucket-display-name"] || a.bucket || "Issue"}**\n`;
        if (a["reason-message"])
          output += `   ${a["reason-message"]}\n`;
        const steps = a.suggestion || [];
        if (Array.isArray(steps)) {
          steps.forEach((step: string) => {
            output += `   - ${step}\n`;
          });
        }
        if (a["reference-doc-link"])
          output += `   [Docs](${a["reference-doc-link"]})\n`;
        output += "\n";
      });
    }
  } catch {
    /* suggestions endpoint may not exist */
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
          text: `Network logs require comparison_id.\n\nFind one with:\n\`Use percy_get_snapshot with snapshot_id "..."\``,
        },
      ],
      isError: true,
    };
  }

  const response = await percyGet("/network-logs", config, {
    comparison_id: args.comparison_id,
  });

  const logs = response?.data || response || {};
  const entries = Array.isArray(logs)
    ? logs
    : Object.values(logs);

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
  output += `| # | URL | Base | Head | Type | Issue |\n|---|---|---|---|---|---|\n`;

  entries.slice(0, 30).forEach((entry: any, i: number) => {
    const url =
      entry.file || entry.domain || entry.url || "?";
    const base =
      entry["base-status"] || entry.baseStatus || "—";
    const head =
      entry["head-status"] || entry.headStatus || "—";
    const type = entry.mimetype || entry.type || "—";
    const summary =
      entry["status-summary"] || entry.statusSummary || "";
    output += `| ${i + 1} | ${url} | ${base} | ${head} | ${type} | ${summary} |\n`;
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
        {
          type: "text",
          text: `No snapshots found for build ${buildId}.`,
        },
      ],
    };
  }

  // Count totals
  let totalItems = 0;
  items.forEach((item: any) => {
    totalItems += item.attributes?.["item-count"] || item.itemCount || 1;
  });

  let output = `## Build #${buildId} — Snapshots\n\n`;
  output += `**Groups:** ${items.length} | **Total snapshots:** ${totalItems}\n\n`;
  output += `| # | Name | Display | Diff | Bugs | Review | Items | Snapshot IDs |\n|---|---|---|---|---|---|---|---|\n`;

  items.forEach((item: any, i: number) => {
    const a = item.attributes || item;
    const name =
      a["cover-snapshot-name"] || a.coverSnapshotName || "?";
    const display =
      a["cover-snapshot-display-name"] ||
      a.coverSnapshotDisplayName ||
      "—";
    const diff =
      (a["max-diff-ratio"] ?? a.maxDiffRatio) != null
        ? ((a["max-diff-ratio"] ?? a.maxDiffRatio) * 100).toFixed(
            1,
          ) + "%"
        : "—";
    const bugs =
      a["max-bug-total-potential-bugs"] ??
      a.maxBugTotalPotentialBugs ??
      "—";
    const review =
      a["review-state"] || a.reviewState || "?";
    const count =
      a["item-count"] || a.itemCount || 1;
    const snapIds = (
      a["snapshot-ids"] ||
      a.snapshotIds ||
      []
    )
      .slice(0, 3)
      .join(", ");
    const more =
      (a["snapshot-ids"] || a.snapshotIds || []).length > 3
        ? "..."
        : "";
    output += `| ${i + 1} | ${name} | ${display} | ${diff} | ${bugs} | ${review} | ${count} | ${snapIds}${more} |\n`;
  });

  output += `\nUse \`percy_get_snapshot\` with a snapshot ID for full comparison details.\n`;

  return { content: [{ type: "text", text: output }] };
}
