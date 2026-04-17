import { PercyClient } from "../../../lib/percy-api/client.js";
import { percyCache } from "../../../lib/percy-api/cache.js";
import { formatBuild } from "../../../lib/percy-api/formatter.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyPrVisualReport(
  args: {
    project_id?: string;
    branch?: string;
    sha?: string;
    build_id?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);
  const errors: string[] = [];

  // Step 1: Resolve build
  let build: any;
  try {
    if (args.build_id) {
      build = await client.get(
        `/builds/${args.build_id}`,
        { "include-metadata": "true" },
        ["build-summary", "browsers"],
      );
    } else {
      // Find build by branch or SHA
      const params: Record<string, string> = {};
      if (args.project_id) {
        // Use project-scoped endpoint
      }
      if (args.branch) params["filter[branch]"] = args.branch;
      if (args.sha) params["filter[sha]"] = args.sha;
      params["page[limit]"] = "1";

      const builds = await client.get<any>("/builds", params);
      const buildList = Array.isArray(builds)
        ? builds
        : builds?.data
          ? Array.isArray(builds.data)
            ? builds.data
            : [builds.data]
          : [];

      if (buildList.length === 0) {
        const identifier = args.branch
          ? `branch '${args.branch}'`
          : args.sha
            ? `SHA '${args.sha}'`
            : "the given filters";
        return {
          content: [
            {
              type: "text",
              text: `No Percy build found for ${identifier}. Ensure a Percy build has been created for this branch/commit.`,
            },
          ],
        };
      }

      const buildId = buildList[0]?.id || buildList[0];
      build = await client.get(
        `/builds/${typeof buildId === "object" ? buildId.id : buildId}`,
        { "include-metadata": "true" },
        ["build-summary", "browsers"],
      );
    }
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Failed to fetch build: ${e.message}` }],
      isError: true,
    };
  }

  if (!build) {
    return {
      content: [{ type: "text", text: "Build not found." }],
      isError: true,
    };
  }

  // Cache build data for other composite tools
  percyCache.set(`build:${build.id}`, build);

  // Step 2: Build header with state awareness
  let output = "";
  const state = build.state || "unknown";

  output += `# Percy Visual Regression Report\n\n`;
  output += formatBuild(build);

  // Step 3: Get build summary if available
  const buildSummary = build.buildSummary;
  if (buildSummary?.summary) {
    try {
      const summaryData =
        typeof buildSummary.summary === "string"
          ? JSON.parse(buildSummary.summary)
          : buildSummary.summary;
      if (summaryData?.title || summaryData?.items) {
        output += `\n### AI Build Summary\n\n`;
        if (summaryData.title) output += `> ${summaryData.title}\n\n`;
        if (Array.isArray(summaryData.items)) {
          summaryData.items.forEach((item: any) => {
            output += `- ${item.title || item}\n`;
          });
          output += "\n";
        }
      }
    } catch {
      // Summary parse failed, skip
    }
  }

  // Step 4: Get changed build items
  if (state === "finished" || state === "processing") {
    let items: any[] = [];
    try {
      const itemsData = await client.get<any>("/build-items", {
        "filter[build-id]": build.id,
        "filter[category]": "changed",
        "page[limit]": "30",
      });
      items = Array.isArray(itemsData) ? itemsData : [];
    } catch (e: any) {
      errors.push(`[Failed to load changed snapshots: ${e.message}]`);
    }

    if (items.length === 0 && errors.length === 0) {
      output += `\n### No Visual Changes Detected\n\nAll snapshots match the baseline.\n`;
    } else if (items.length > 0) {
      // Step 5: Rank by risk
      // Critical: AI bug flags > Review: high diff > Expected: content changes > Noise: low diff
      const critical: any[] = [];
      const review: any[] = [];
      const expected: any[] = [];
      const noise: any[] = [];

      for (const item of items) {
        const name = item.name || item.snapshotName || "Unknown";
        const diffRatio = item.diffRatio ?? item.maxDiffRatio ?? 0;
        const potentialBugs =
          item.totalPotentialBugs || item.aiDetails?.totalPotentialBugs || 0;

        const entry = { name, diffRatio, potentialBugs, item };

        if (potentialBugs > 0) {
          critical.push(entry);
        } else if (diffRatio > 0.15) {
          review.push(entry);
        } else if (diffRatio > 0.005) {
          expected.push(entry);
        } else {
          noise.push(entry);
        }
      }

      output += `\n### Changed Snapshots (${items.length})\n\n`;

      if (critical.length > 0) {
        output += `**CRITICAL — Potential Bugs (${critical.length}):**\n`;
        critical.forEach((e, i) => {
          output += `${i + 1}. **${e.name}** — ${(e.diffRatio * 100).toFixed(1)}% diff, ${e.potentialBugs} bug(s) flagged\n`;
        });
        output += "\n";
      }

      if (review.length > 0) {
        output += `**REVIEW REQUIRED (${review.length}):**\n`;
        review.forEach((e, i) => {
          output += `${i + 1}. **${e.name}** — ${(e.diffRatio * 100).toFixed(1)}% diff\n`;
        });
        output += "\n";
      }

      if (expected.length > 0) {
        output += `**EXPECTED CHANGES (${expected.length}):**\n`;
        expected.forEach((e, i) => {
          output += `${i + 1}. ${e.name} — ${(e.diffRatio * 100).toFixed(1)}% diff\n`;
        });
        output += "\n";
      }

      if (noise.length > 0) {
        output += `**NOISE (${noise.length}):** ${noise.map((e) => e.name).join(", ")}\n\n`;
      }

      // Recommendation
      output += `### Recommendation\n\n`;
      if (critical.length > 0) {
        output += `Review ${critical.length} critical item(s) before approving. `;
      }
      if (review.length > 0) {
        output += `${review.length} item(s) need manual review. `;
      }
      if (
        expected.length + noise.length > 0 &&
        critical.length === 0 &&
        review.length === 0
      ) {
        output += `All changes appear expected or are noise. Safe to approve.`;
      }
      output += "\n";
    }
  }

  // Add any sub-call errors
  if (errors.length > 0) {
    output += `\n### Partial Results\n\n`;
    errors.forEach((err) => {
      output += `- ${err}\n`;
    });
  }

  return { content: [{ type: "text", text: output }] };
}
