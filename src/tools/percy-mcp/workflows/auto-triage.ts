import { PercyClient } from "../../../lib/percy-api/client.js";
import { percyCache } from "../../../lib/percy-api/cache.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyAutoTriage(
  args: { build_id: string; noise_threshold?: number; review_threshold?: number },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const client = new PercyClient(config);
  const noiseThreshold = args.noise_threshold ?? 0.005;  // 0.5%
  const reviewThreshold = args.review_threshold ?? 0.15;  // 15%

  // Get all changed build items (limit to 90 = 3 pages max)
  const items = await client.get<any>("/build-items", {
    "filter[build-id]": args.build_id,
    "filter[category]": "changed",
    "page[limit]": "30",
  });
  const itemList = Array.isArray(items) ? items : [];

  const critical: any[] = [];
  const reviewRequired: any[] = [];
  const autoApprovable: any[] = [];
  const noise: any[] = [];

  for (const item of itemList) {
    const name = item.name || item.snapshotName || "Unknown";
    const diffRatio = item.diffRatio ?? item.maxDiffRatio ?? 0;
    const potentialBugs = item.totalPotentialBugs || 0;
    const aiIgnored = item.aiDiffRatio !== undefined && item.aiDiffRatio === 0 && diffRatio > 0;
    const entry = { name, diffRatio, potentialBugs };

    if (potentialBugs > 0) {
      critical.push(entry);
    } else if (aiIgnored) {
      autoApprovable.push({ ...entry, reason: "AI-filtered (IntelliIgnore)" });
    } else if (diffRatio > reviewThreshold) {
      reviewRequired.push(entry);
    } else if (diffRatio <= noiseThreshold) {
      noise.push(entry);
    } else {
      autoApprovable.push({ ...entry, reason: "Low diff ratio" });
    }
  }

  let output = `## Auto-Triage — Build #${args.build_id}\n\n`;
  output += `**Total changed:** ${itemList.length} | `;
  output += `Critical: ${critical.length} | Review: ${reviewRequired.length} | `;
  output += `Auto-approvable: ${autoApprovable.length} | Noise: ${noise.length}\n\n`;

  if (critical.length > 0) {
    output += `### CRITICAL — Potential Bugs (${critical.length})\n`;
    critical.forEach((e, i) => {
      output += `${i + 1}. **${e.name}** — ${(e.diffRatio * 100).toFixed(1)}% diff, ${e.potentialBugs} bug(s)\n`;
    });
    output += "\n";
  }
  if (reviewRequired.length > 0) {
    output += `### REVIEW REQUIRED (${reviewRequired.length})\n`;
    reviewRequired.forEach((e, i) => {
      output += `${i + 1}. **${e.name}** — ${(e.diffRatio * 100).toFixed(1)}% diff\n`;
    });
    output += "\n";
  }
  if (autoApprovable.length > 0) {
    output += `### AUTO-APPROVABLE (${autoApprovable.length})\n`;
    autoApprovable.forEach((e, i) => {
      output += `${i + 1}. ${e.name} — ${e.reason}\n`;
    });
    output += "\n";
  }
  if (noise.length > 0) {
    output += `### NOISE (${noise.length})\n`;
    output += noise.map(e => e.name).join(", ") + "\n\n";
  }

  output += `### Recommended Action\n\n`;
  if (critical.length > 0) {
    output += `Investigate ${critical.length} critical item(s) before approving.\n`;
  } else if (reviewRequired.length > 0) {
    output += `Review ${reviewRequired.length} item(s) manually. ${autoApprovable.length + noise.length} can be auto-approved.\n`;
  } else {
    output += `All changes are auto-approvable or noise. Safe to approve.\n`;
  }

  if (itemList.length >= 30) {
    output += `\n> Note: Results limited to first 30 changed snapshots. Build may have more.\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
