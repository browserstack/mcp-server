import { describe, it, expect } from "vitest";
import {
  formatBuild,
  formatSnapshot,
  formatComparison,
  formatSuggestions,
  formatNetworkLogs,
  formatBuildStatus,
  formatAiWarning,
} from "../../../src/lib/percy-api/formatter.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const finishedBuildWithAi = {
  id: "build-1",
  buildNumber: 142,
  state: "finished",
  branch: "main",
  commit: { sha: "abc1234" },
  reviewState: "unreviewed",
  totalSnapshots: 42,
  totalComparisons: 42,
  totalComparisonsDiff: 5,
  totalSnapshotsUnreviewed: 3,
  failureReason: null,
  createdAt: "2024-01-15T10:00:00Z",
  finishedAt: "2024-01-15T10:02:34Z",
  errorBuckets: null,
  aiDetails: {
    aiEnabled: true,
    totalComparisonsWithAi: 42,
    totalPotentialBugs: 2,
    totalDiffsReducedCapped: 15,
    totalAiVisualDiffs: 8,
    allAiJobsCompleted: true,
    summaryStatus: "completed",
  },
};

const noChangesBuild = {
  id: "build-2",
  buildNumber: 143,
  state: "finished",
  branch: "main",
  totalSnapshots: 20,
  totalComparisons: 20,
  totalComparisonsDiff: 0,
  totalSnapshotsNew: 0,
  totalSnapshotsRemoved: 0,
  totalSnapshotsUnchanged: 20,
  createdAt: "2024-01-16T10:00:00Z",
  finishedAt: "2024-01-16T10:01:00Z",
  failureReason: null,
  errorBuckets: null,
  aiDetails: null,
};

const processingBuild = {
  id: "build-3",
  buildNumber: 144,
  state: "processing",
  branch: "feature/x",
  totalSnapshots: 30,
  totalComparisons: 100,
  totalComparisonsFinished: 47,
  totalComparisonsDiff: null,
  failureReason: null,
  errorBuckets: null,
  aiDetails: null,
  createdAt: "2024-01-17T10:00:00Z",
  finishedAt: null,
};

const failedBuild = {
  id: "build-4",
  buildNumber: 145,
  state: "failed",
  branch: "develop",
  totalSnapshots: null,
  totalComparisons: null,
  totalComparisonsDiff: null,
  failureReason: "render_timeout",
  errorBuckets: [
    { name: "Asset Loading Failed", count: 3 },
    { name: "Render Timeout", count: 1 },
  ],
  createdAt: "2024-01-18T10:00:00Z",
  finishedAt: "2024-01-18T10:00:30Z",
  aiDetails: null,
};

// ---------------------------------------------------------------------------
// formatBuild
// ---------------------------------------------------------------------------

describe("formatBuild", () => {
  it("SUCCESS: finished build with AI renders all sections", () => {
    const result = formatBuild(finishedBuildWithAi);

    expect(result).toContain("## Build #142 — FINISHED");
    expect(result).toContain("**Branch:** main | **SHA:** abc1234");
    expect(result).toContain("**Review:** unreviewed");
    expect(result).toContain("42 snapshots");
    expect(result).toContain("42 comparisons");
    expect(result).toContain("5 with diffs");
    expect(result).toContain("**Duration:** 2m 34s");
    // AI section
    expect(result).toContain("### AI Analysis");
    expect(result).toContain("Comparisons analyzed by AI: 42");
    expect(result).toContain("Potential bugs: 2");
    expect(result).toContain("Diffs reduced by AI: 15");
  });

  it("SUCCESS: build with no changes shows no visual changes message", () => {
    const result = formatBuild(noChangesBuild);

    expect(result).toContain("## Build #143 — FINISHED");
    expect(result).toContain("No visual changes detected");
    expect(result).not.toContain("### AI Analysis");
  });

  it("EDGE: processing build shows percentage", () => {
    const result = formatBuild(processingBuild);

    expect(result).toContain("## Build #144 — PROCESSING (47% complete)");
    expect(result).toContain("**Branch:** feature/x");
  });

  it("EDGE: failed build includes failure_reason and error_buckets", () => {
    const result = formatBuild(failedBuild);

    expect(result).toContain("## Build #145 — FAILED");
    expect(result).toContain("**Failure Reason:** render_timeout");
    expect(result).toContain("### Error Buckets");
    expect(result).toContain("**Asset Loading Failed** — 3 snapshot(s)");
    expect(result).toContain("**Render Timeout** — 1 snapshot(s)");
    // Should NOT show AI section for failed builds
    expect(result).not.toContain("### AI Analysis");
  });

  it("EDGE: null build returns fallback message", () => {
    expect(formatBuild(null)).toContain("No build data available");
    expect(formatBuild(undefined)).toContain("No build data available");
  });
});

// ---------------------------------------------------------------------------
// formatSnapshot
// ---------------------------------------------------------------------------

describe("formatSnapshot", () => {
  it("SUCCESS: snapshot with comparisons renders table", () => {
    const snapshot = { id: "s1", name: "Homepage", reviewState: "unreviewed" };
    const comparisons = [
      {
        id: "c1",
        browser: { name: "Chrome" },
        width: 1280,
        diffRatio: 0.083,
        aiDiffRatio: 0.021,
        aiProcessingState: "completed",
      },
    ];

    const result = formatSnapshot(snapshot, comparisons);

    expect(result).toContain("### Homepage");
    expect(result).toContain("**Review:** unreviewed");
    expect(result).toContain("| Chrome | 1280px | 8.3% | 2.1% | completed |");
  });

  it("EDGE: snapshot with no comparisons omits table", () => {
    const snapshot = { id: "s2", name: "About Page", reviewState: "approved" };
    const result = formatSnapshot(snapshot);

    expect(result).toContain("### About Page");
    expect(result).not.toContain("|");
  });
});

// ---------------------------------------------------------------------------
// formatComparison
// ---------------------------------------------------------------------------

describe("formatComparison", () => {
  const comparisonWithAi = {
    id: "c1",
    browser: { name: "Chrome" },
    width: 1280,
    diffRatio: 0.083,
    aiDiffRatio: 0.021,
    aiProcessingState: "completed",
    baseScreenshot: { url: "https://percy.io/base.png" },
    headScreenshot: { url: "https://percy.io/head.png" },
    diffImage: { url: "https://percy.io/diff.png" },
    appliedRegions: [
      {
        label: "Button text truncated",
        type: "modified",
        description: "Container width reduced causing text overflow",
      },
      {
        label: "New CTA button",
        type: "added",
        description: "New element in hero section",
      },
    ],
  };

  it("SUCCESS: comparison with AI and regions", () => {
    const result = formatComparison(comparisonWithAi, {
      includeRegions: true,
    });

    expect(result).toContain("**Chrome 1280px** — 8.3% diff (AI: 2.1%)");
    expect(result).toContain("- Base: https://percy.io/base.png");
    expect(result).toContain("- Head: https://percy.io/head.png");
    expect(result).toContain("- Diff: https://percy.io/diff.png");
    expect(result).toContain("AI Regions (2):");
    expect(result).toContain(
      "1. **Button text truncated** (modified) — Container width reduced causing text overflow",
    );
    expect(result).toContain(
      "2. **New CTA button** (added) — New element in hero section",
    );
  });

  it("EDGE: comparison with no AI data shows diff ratio only", () => {
    const comparison = {
      id: "c2",
      browser: { name: "Firefox" },
      width: 768,
      diffRatio: 0.05,
      aiDiffRatio: null,
      aiProcessingState: null,
      appliedRegions: null,
    };

    const result = formatComparison(comparison);

    expect(result).toContain("**Firefox 768px** — 5.0% diff");
    expect(result).not.toContain("AI:");
    expect(result).not.toContain("AI Regions");
  });

  it("EDGE: regions not shown when includeRegions is false", () => {
    const result = formatComparison(comparisonWithAi);

    expect(result).not.toContain("AI Regions");
  });
});

// ---------------------------------------------------------------------------
// formatSuggestions
// ---------------------------------------------------------------------------

describe("formatSuggestions", () => {
  it("SUCCESS: renders numbered suggestions with fix steps", () => {
    const suggestions = [
      {
        title: "Asset Loading Failed",
        affectedSnapshots: 3,
        reason: "4 font files from cdn.example.com returned HTTP 503",
        fixSteps: [
          "Verify cdn.example.com is accessible",
          "Add to percy config allowedHostnames",
        ],
        docsUrl: "https://docs.percy.io/hosting",
      },
    ];

    const result = formatSuggestions(suggestions);

    expect(result).toContain("## Build Failure Suggestions");
    expect(result).toContain(
      "### 1. Asset Loading Failed (3 snapshots affected)",
    );
    expect(result).toContain("**Reason:** 4 font files");
    expect(result).toContain("1. Verify cdn.example.com");
    expect(result).toContain("2. Add to percy config");
    expect(result).toContain("**Docs:** https://docs.percy.io/hosting");
  });

  it("EDGE: empty suggestions returns fallback", () => {
    expect(formatSuggestions([])).toContain("No failure suggestions");
    expect(formatSuggestions(null as any)).toContain("No failure suggestions");
  });
});

// ---------------------------------------------------------------------------
// formatNetworkLogs
// ---------------------------------------------------------------------------

describe("formatNetworkLogs", () => {
  it("SUCCESS: renders network logs table", () => {
    const logs = [
      {
        url: "cdn.example.com/font.woff2",
        baseStatus: "200 OK",
        headStatus: "503 Error",
        resourceType: "font",
        issue: "Server error",
      },
    ];

    const result = formatNetworkLogs(logs);

    expect(result).toContain("## Network Logs");
    expect(result).toContain(
      "| cdn.example.com/font.woff2 | 200 OK | 503 Error | font | Server error |",
    );
  });

  it("EDGE: empty logs returns fallback", () => {
    expect(formatNetworkLogs([])).toContain("No network logs");
  });
});

// ---------------------------------------------------------------------------
// formatBuildStatus
// ---------------------------------------------------------------------------

describe("formatBuildStatus", () => {
  it("SUCCESS: one-line status with AI stats", () => {
    const build = {
      buildNumber: 142,
      state: "finished",
      totalComparisonsDiff: 5,
      aiDetails: { potentialBugs: 2, noiseFiltered: 73 },
    };

    const result = formatBuildStatus(build);

    expect(result).toBe(
      "Build #142: FINISHED — 5 changed, 2 bugs, 73% noise filtered",
    );
  });

  it("EDGE: null build returns fallback", () => {
    expect(formatBuildStatus(null)).toBe("Build: N/A");
  });
});

// ---------------------------------------------------------------------------
// formatAiWarning
// ---------------------------------------------------------------------------

describe("formatAiWarning", () => {
  it("EDGE: AI processing on 3/10 comparisons shows warning", () => {
    const comparisons = [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`,
        aiProcessingState: "completed",
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `p${i}`,
        aiProcessingState: "processing",
      })),
    ];

    const result = formatAiWarning(comparisons);

    expect(result).toContain("AI analysis in progress for 3 of 10");
    expect(result).toContain("Re-run for complete analysis");
  });

  it("SUCCESS: all completed returns empty string", () => {
    const comparisons = [
      { id: "c1", aiProcessingState: "completed" },
      { id: "c2", aiProcessingState: "completed" },
    ];

    expect(formatAiWarning(comparisons)).toBe("");
  });

  it("EDGE: AI not enabled returns empty string", () => {
    const comparisons = [
      { id: "c1", aiProcessingState: "not_enabled" },
      { id: "c2", aiProcessingState: "not_enabled" },
    ];

    expect(formatAiWarning(comparisons)).toBe("");
  });

  it("EDGE: empty array returns empty string", () => {
    expect(formatAiWarning([])).toBe("");
  });
});
