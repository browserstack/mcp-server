/**
 * Markdown formatting utilities for Percy API responses.
 *
 * Each function transforms typed Percy API data into concise,
 * agent-readable markdown. All functions handle null/undefined
 * fields gracefully — showing "N/A" or omitting the section.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function na(value: unknown): string {
  if (value == null || value === "") return "N/A";
  return String(value);
}

function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "N/A";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "N/A";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// ---------------------------------------------------------------------------
// formatBuild
// ---------------------------------------------------------------------------

export function formatBuild(build: any): string {
  if (!build) return "_No build data available._";

  const num = build.buildNumber ?? "?";
  const state = (build.state ?? "unknown").toUpperCase();

  const lines: string[] = [];

  // Header — state-aware
  if (build.state === "processing") {
    const total = build.totalComparisons ?? 0;
    const finished = build.totalComparisonsFinished ?? 0;
    const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
    lines.push(`## Build #${num} — PROCESSING (${percent}% complete)`);
  } else if (build.state === "failed") {
    lines.push(`## Build #${num} — FAILED`);
  } else {
    lines.push(`## Build #${num} — ${state}`);
  }

  // Branch / SHA
  const branch = na(build.branch);
  const sha = na(build.commit?.sha ?? build.sha);
  lines.push(`**Branch:** ${branch} | **SHA:** ${sha}`);

  // Review state
  if (build.reviewState) {
    lines.push(`**Review:** ${build.reviewState}`);
  }

  // Snapshot stats
  const total = build.totalSnapshots;
  const changed = build.totalComparisonsDiff;
  const newSnaps = build.totalSnapshotsNew ?? null;
  const removed = build.totalSnapshotsRemoved ?? null;
  const unchanged = build.totalSnapshotsUnchanged ?? null;

  if (total != null) {
    const parts = [`${total} total`];
    if (changed != null) parts.push(`${changed} changed`);
    if (newSnaps != null) parts.push(`${newSnaps} new`);
    if (removed != null) parts.push(`${removed} removed`);
    if (unchanged != null) parts.push(`${unchanged} unchanged`);
    lines.push(`**Snapshots:** ${parts.join(" | ")}`);
  }

  // Duration
  const duration = formatDuration(build.createdAt, build.finishedAt);
  if (duration !== "N/A") {
    lines.push(`**Duration:** ${duration}`);
  }

  // No visual changes
  if (
    build.state === "finished" &&
    (build.totalComparisonsDiff === 0 || build.totalComparisonsDiff == null) &&
    (build.totalSnapshotsNew ?? 0) === 0 &&
    (build.totalSnapshotsRemoved ?? 0) === 0
  ) {
    lines.push("");
    lines.push("> **No visual changes detected in this build.**");
  }

  // Failure info
  if (build.state === "failed") {
    lines.push("");
    if (build.failureReason) {
      lines.push(`**Failure Reason:** ${build.failureReason}`);
    }
    if (build.errorBuckets && build.errorBuckets.length > 0) {
      lines.push("");
      lines.push("### Error Buckets");
      for (const bucket of build.errorBuckets) {
        const name = bucket.name ?? bucket.errorType ?? "Unknown";
        const count = bucket.count ?? bucket.snapshotCount ?? "?";
        lines.push(`- **${name}** — ${count} snapshot(s)`);
      }
    }
  }

  // AI analysis
  const ai = build.aiDetails;
  if (ai && build.state !== "failed") {
    lines.push("");
    lines.push("### AI Analysis");
    if (ai.comparisonsAnalyzed != null) {
      lines.push(`- Comparisons analyzed: ${ai.comparisonsAnalyzed}`);
    }
    if (ai.potentialBugs != null) {
      lines.push(`- Potential bugs: ${ai.potentialBugs}`);
    }
    if (ai.diffReduction != null) {
      lines.push(`- Diff reduction: ${ai.diffReduction}`);
    } else if (ai.originalDiffPercent != null && ai.aiDiffPercent != null) {
      lines.push(
        `- Diff reduction: ${pct(ai.originalDiffPercent)} → ${pct(ai.aiDiffPercent)}`,
      );
    }
  }

  // Build summary
  if (build.summary) {
    lines.push("");
    lines.push("### Summary");
    lines.push(
      build.summary
        .split("\n")
        .map((l: string) => `> ${l}`)
        .join("\n"),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatSnapshot
// ---------------------------------------------------------------------------

export function formatSnapshot(snapshot: any, comparisons?: any[]): string {
  if (!snapshot) return "_No snapshot data available._";

  const lines: string[] = [];
  lines.push(`### ${na(snapshot.name)}`);

  if (snapshot.reviewState) {
    lines.push(`**Review:** ${snapshot.reviewState}`);
  }

  if (comparisons && comparisons.length > 0) {
    lines.push("");
    lines.push("| Browser | Width | Diff | AI Diff | AI Status |");
    lines.push("|---------|-------|------|---------|-----------|");
    for (const c of comparisons) {
      const browser = na(c.browser?.name ?? c.browserName);
      const width = c.width != null ? `${c.width}px` : "N/A";
      const diff = pct(c.diffRatio);
      const aiDiff = pct(c.aiDiffRatio);
      const aiStatus = na(c.aiProcessingState);
      lines.push(`| ${browser} | ${width} | ${diff} | ${aiDiff} | ${aiStatus} |`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatComparison
// ---------------------------------------------------------------------------

export function formatComparison(
  comparison: any,
  options?: { includeRegions?: boolean },
): string {
  if (!comparison) return "_No comparison data available._";

  const browser = na(comparison.browser?.name ?? comparison.browserName);
  const width = comparison.width != null ? `${comparison.width}px` : "";
  const diff = pct(comparison.diffRatio);

  const lines: string[] = [];

  // Header
  let header = `**${browser} ${width}** — ${diff} diff`;
  if (comparison.aiDiffRatio != null) {
    header += ` (AI: ${pct(comparison.aiDiffRatio)})`;
  }
  lines.push(header);

  // Image URLs
  const baseUrl = comparison.baseScreenshot?.url ?? comparison.baseUrl;
  const headUrl = comparison.headScreenshot?.url ?? comparison.headUrl;
  const diffUrl = comparison.diffImage?.url ?? comparison.diffUrl;

  if (baseUrl || headUrl || diffUrl) {
    lines.push("");
    lines.push("Images:");
    if (baseUrl) lines.push(`- Base: ${baseUrl}`);
    if (headUrl) lines.push(`- Head: ${headUrl}`);
    if (diffUrl) lines.push(`- Diff: ${diffUrl}`);
  }

  // AI Regions
  if (
    options?.includeRegions &&
    comparison.appliedRegions &&
    comparison.appliedRegions.length > 0
  ) {
    const regions = comparison.appliedRegions;
    lines.push("");
    lines.push(`AI Regions (${regions.length}):`);
    regions.forEach((region: any, i: number) => {
      const label = na(region.label ?? region.name);
      const type = region.type ?? region.changeType ?? "unknown";
      const desc = region.description ?? "";
      let line = `${i + 1}. **${label}** (${type})`;
      if (desc) line += ` — ${desc}`;
      lines.push(line);
    });
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatSuggestions
// ---------------------------------------------------------------------------

export function formatSuggestions(suggestions: any[]): string {
  if (!suggestions || suggestions.length === 0) {
    return "_No failure suggestions available._";
  }

  const lines: string[] = [];
  lines.push("## Build Failure Suggestions");
  lines.push("");

  suggestions.forEach((s: any, i: number) => {
    const title = na(s.title ?? s.name);
    const affected = s.affectedSnapshots ?? s.snapshotsAffected ?? null;
    let heading = `### ${i + 1}. ${title}`;
    if (affected != null) heading += ` (${affected} snapshots affected)`;
    lines.push(heading);

    if (s.reason) lines.push(`**Reason:** ${s.reason}`);
    if (s.description) lines.push(`**Reason:** ${s.description}`);

    if (s.fixSteps && s.fixSteps.length > 0) {
      lines.push("**Fix Steps:**");
      s.fixSteps.forEach((step: string, j: number) => {
        lines.push(`${j + 1}. ${step}`);
      });
    }

    if (s.docsUrl ?? s.docs) {
      lines.push(`**Docs:** ${s.docsUrl ?? s.docs}`);
    }

    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// formatNetworkLogs
// ---------------------------------------------------------------------------

export function formatNetworkLogs(logs: any[]): string {
  if (!logs || logs.length === 0) {
    return "_No network logs available._";
  }

  const lines: string[] = [];
  lines.push("## Network Logs");
  lines.push("");
  lines.push("| URL | Base Status | Head Status | Type | Issue |");
  lines.push("|-----|-------------|-------------|------|-------|");

  for (const log of logs) {
    const url = na(log.url);
    const baseStatus = na(log.baseStatus ?? log.baseStatusCode);
    const headStatus = na(log.headStatus ?? log.headStatusCode);
    const type = na(log.resourceType ?? log.type);
    const issue = na(log.issue ?? log.error);
    lines.push(`| ${url} | ${baseStatus} | ${headStatus} | ${type} | ${issue} |`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatBuildStatus
// ---------------------------------------------------------------------------

export function formatBuildStatus(build: any): string {
  if (!build) return "Build: N/A";

  const num = build.buildNumber ?? "?";
  const state = (build.state ?? "unknown").toUpperCase();
  const parts: string[] = [];

  if (build.totalComparisonsDiff != null) {
    parts.push(`${build.totalComparisonsDiff} changed`);
  }

  const ai = build.aiDetails;
  if (ai?.potentialBugs != null) {
    parts.push(`${ai.potentialBugs} bugs`);
  }
  if (ai?.noiseFiltered != null) {
    parts.push(`${ai.noiseFiltered}% noise filtered`);
  }

  const suffix = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
  return `Build #${num}: ${state}${suffix}`;
}

// ---------------------------------------------------------------------------
// formatAiWarning
// ---------------------------------------------------------------------------

export function formatAiWarning(comparisons: any[]): string {
  if (!comparisons || comparisons.length === 0) return "";

  const incomplete = comparisons.filter(
    (c: any) =>
      c.aiProcessingState &&
      c.aiProcessingState !== "completed" &&
      c.aiProcessingState !== "not_enabled",
  );

  if (incomplete.length === 0) return "";

  const total = comparisons.length;
  return `> ⚠ AI analysis in progress for ${incomplete.length} of ${total} comparisons. Re-run for complete analysis.`;
}
