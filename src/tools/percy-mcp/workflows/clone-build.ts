/**
 * percy_clone_build — Clone snapshots from a source build to a new build,
 * even across different projects.
 *
 * Flow:
 * 1. Read build-items to get snapshot IDs
 * 2. For each snapshot: fetch raw JSON:API with includes to get image URLs
 * 3. Create target build + snapshots + comparisons with downloaded screenshots
 * 4. Finalize
 */

import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import {
  getPercyHeaders,
  getPercyApiBaseUrl,
} from "../../../lib/percy-api/auth.js";
import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getGitBranch(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"]);
    return stdout.trim() || "main";
  } catch {
    return "main";
  }
}

async function getGitSha(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    return createHash("sha1").update(Date.now().toString()).digest("hex");
  }
}

async function getProjectToken(
  projectName: string,
  config: BrowserStackConfig,
): Promise<string> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");
  const url = `https://api.browserstack.com/api/app_percy/get_project_token?name=${encodeURIComponent(projectName)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) throw new Error(`Failed to get token for "${projectName}"`);
  const data = await response.json();
  if (!data?.token || !data?.success)
    throw new Error(`No token returned for "${projectName}"`);
  return data.token;
}

async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

/**
 * Fetch a snapshot with RAW JSON:API response to manually walk the
 * included chain: comparison → head-screenshot → image → url
 */
async function fetchSnapshotRaw(
  snapshotId: string,
  config: BrowserStackConfig,
): Promise<{
  name: string;
  comparisons: Array<{
    width: number;
    height: number;
    tagName: string;
    osName: string;
    browserName: string;
    imageUrl: string | null;
  }>;
  debugRelKeys?: string;
} | null> {
  const headers = await getPercyHeaders(config);
  const baseUrl = getPercyApiBaseUrl();
  const url = `${baseUrl}/snapshots/${snapshotId}?include=comparisons.head-screenshot.image,comparisons.comparison-tag`;

  const response = await fetch(url, { headers });
  if (!response.ok) return null;

  const json = await response.json();
  const data = json.data;
  const included = json.included || [];

  if (!data) return null;

  const name = data.attributes?.name || "Unknown";

  // Build lookup maps from included
  const byTypeId = new Map<string, any>();
  for (const item of included) {
    byTypeId.set(`${item.type}:${item.id}`, item);
  }

  // Get comparison IDs from snapshot relationships
  const compRefs = data.relationships?.comparisons?.data || [];

  const comparisons: Array<{
    width: number;
    height: number;
    tagName: string;
    osName: string;
    browserName: string;
    imageUrl: string | null;
  }> = [];

  // Debug: dump first comparison's relationships keys
  let debugRelKeys = "";
  for (const compRef of compRefs) {
    const comp = byTypeId.get(`comparisons:${compRef.id}`);
    if (!comp) continue;

    if (!debugRelKeys && comp.relationships) {
      debugRelKeys = Object.keys(comp.relationships).join(", ");
    }

    const width = comp.attributes?.width || 1280;

    // Walk: comparison → head-screenshot → image
    const hsRef = comp.relationships?.["head-screenshot"]?.data;
    let imageUrl: string | null = null;
    let height = 800;

    if (hsRef) {
      const screenshot = byTypeId.get(`screenshots:${hsRef.id}`);
      if (screenshot) {
        const imgRef = screenshot.relationships?.image?.data;
        if (imgRef) {
          const image = byTypeId.get(`images:${imgRef.id}`);
          if (image) {
            imageUrl = image.attributes?.url || null;
            height = image.attributes?.height || 800;
          }
        }
      }
    }

    // Get comparison tag
    const tagRef = comp.relationships?.["comparison-tag"]?.data;
    let tagName = "Screenshot";
    let osName = "Clone";
    let browserName = "Screenshot";

    if (tagRef) {
      const tag = byTypeId.get(`comparison-tags:${tagRef.id}`);
      if (tag) {
        tagName = tag.attributes?.name || "Screenshot";
        osName = tag.attributes?.["os-name"] || "Clone";
        browserName = tag.attributes?.["browser-name"] || "Screenshot";
      }
    }

    comparisons.push({
      width,
      height,
      tagName,
      osName,
      browserName,
      imageUrl,
    });
  }

  return { name, comparisons, debugRelKeys };
}

// ── Main handler ────────────────────────────────────────────────────────────

interface CloneBuildArgs {
  source_build_id: string;
  source_token?: string;
  target_project_name: string;
  target_token?: string;
  branch?: string;
  commit_sha?: string;
}

export async function percyCloneBuild(
  args: CloneBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { source_build_id, target_project_name } = args;
  const branch = args.branch || (await getGitBranch());
  const commitSha = args.commit_sha || (await getGitSha());

  let output = `## Percy Build Clone\n\n`;
  output += `**Source build:** #${source_build_id}\n`;
  output += `**Target project:** ${target_project_name}\n`;
  output += `**Branch:** ${branch}\n\n`;

  // ── Step 1: Set up source token ───────────────────────────────────────

  const originalToken = process.env.PERCY_TOKEN;

  if (args.source_token) {
    process.env.PERCY_TOKEN = args.source_token;
  } else if (!process.env.PERCY_TOKEN) {
    return {
      content: [
        {
          type: "text",
          text: "Need a token to read the source build. Provide `source_token` or set PERCY_TOKEN.",
        },
      ],
      isError: true,
    };
  }

  const sourceClient = new PercyClient(config);

  // ── Step 2: Read source build ─────────────────────────────────────────

  let sourceBuild: any;
  try {
    sourceBuild = await sourceClient.get<any>(`/builds/${source_build_id}`);
  } catch (e: any) {
    process.env.PERCY_TOKEN = originalToken || "";
    return {
      content: [
        {
          type: "text",
          text: `Failed to read source build: ${e.message}\n\nUse a full-access token (web_* or auto_*), not a CI token.`,
        },
      ],
      isError: true,
    };
  }

  output += `Source: **${sourceBuild?.state || "unknown"}** — ${sourceBuild?.totalSnapshots || "?"} snapshots, ${sourceBuild?.totalComparisons || "?"} comparisons\n\n`;

  // ── Step 3: Get snapshot IDs from build-items ─────────────────────────

  let allSnapshotIds: string[] = [];
  try {
    const items = await sourceClient.get<any>("/build-items", {
      "filter[build-id]": source_build_id,
      "page[limit]": "30",
    });
    const itemList = Array.isArray(items) ? items : [];

    // Extract all snapshot IDs from build-items (grouped format)
    for (const item of itemList) {
      if (item.snapshotIds && Array.isArray(item.snapshotIds)) {
        allSnapshotIds.push(...item.snapshotIds.map((id: any) => String(id)));
      } else if (item.coverSnapshotId) {
        allSnapshotIds.push(String(item.coverSnapshotId));
      }
    }

    // Deduplicate
    allSnapshotIds = [...new Set(allSnapshotIds)];
  } catch (e: any) {
    process.env.PERCY_TOKEN = originalToken || "";
    return {
      content: [
        {
          type: "text",
          text: `Failed to read build items: ${e.message}`,
        },
      ],
      isError: true,
    };
  }

  output += `Found **${allSnapshotIds.length}** snapshot(s) to clone.\n\n`;

  if (allSnapshotIds.length === 0) {
    process.env.PERCY_TOKEN = originalToken || "";
    output += "No snapshots found. Nothing to clone.\n";
    return { content: [{ type: "text", text: output }] };
  }

  // ── Step 4: Fetch each snapshot with raw JSON:API ─────────────────────

  output += `### Reading snapshot details...\n\n`;

  // Limit to 20 snapshots to avoid timeout
  const snapshotsToClone = allSnapshotIds.slice(0, 20);
  const snapshotData: Array<
    NonNullable<Awaited<ReturnType<typeof fetchSnapshotRaw>>>
  > = [];

  for (const snapId of snapshotsToClone) {
    const detail = await fetchSnapshotRaw(snapId, config);
    if (detail) {
      snapshotData.push(detail);
    } else {
      output += `- ⚠ Could not read snapshot ${snapId}\n`;
    }
  }

  output += `Read ${snapshotData.length} snapshot(s) with ${snapshotData.reduce((s, d) => s + d.comparisons.length, 0)} comparison(s).\n\n`;

  // ── Step 5: Create target project and build ───────────────────────────

  output += `### Creating target build...\n\n`;

  let targetToken: string;
  if (args.target_token) {
    // Use provided token — clones into existing project
    targetToken = args.target_token;
    output += `Using provided target token for project "${target_project_name}".\n`;
  } else {
    // Auto-create/get project via BrowserStack API
    try {
      targetToken = await getProjectToken(target_project_name, config);
    } catch (e: any) {
      process.env.PERCY_TOKEN = originalToken || "";
      return {
        content: [
          {
            type: "text",
            text: `Failed to create/access target project: ${e.message}\n\nTip: To clone into an existing project, provide its token via the \`target_token\` parameter.`,
          },
        ],
        isError: true,
      };
    }
  }

  // Switch to target token for writes
  process.env.PERCY_TOKEN = targetToken;
  const targetClient = new PercyClient(config);

  let targetBuildId: string;
  let targetBuildUrl = "";
  try {
    const build = await targetClient.post<any>("/builds", {
      data: {
        type: "builds",
        attributes: { branch, "commit-sha": commitSha },
        relationships: { resources: { data: [] } },
      },
    });
    targetBuildId = build?.id || (build?.data || build)?.id;
    targetBuildUrl =
      build?.webUrl ||
      build?.["web-url"] ||
      (build?.data || build)?.webUrl ||
      "";
  } catch (e: any) {
    process.env.PERCY_TOKEN = originalToken || "";
    return {
      content: [
        { type: "text", text: `Failed to create target build: ${e.message}` },
      ],
      isError: true,
    };
  }

  output += `Target build: **#${targetBuildId}**\n`;
  if (targetBuildUrl) output += `URL: ${targetBuildUrl}\n`;
  output += "\n### Cloning snapshots...\n\n";

  // ── Step 6: Clone each snapshot ───────────────────────────────────────

  let clonedCount = 0;
  let failedCount = 0;

  for (const snap of snapshotData) {
    const comparisonsWithImages = snap.comparisons.filter((c) => c.imageUrl);

    if (comparisonsWithImages.length === 0) {
      output += `- ⚠ **${snap.name}** — no downloadable screenshots (web/DOM build)\n`;
      failedCount++;
      continue;
    }

    try {
      // Create snapshot in target
      const snapResult = await targetClient.post<any>(
        `/builds/${targetBuildId}/snapshots`,
        { data: { type: "snapshots", attributes: { name: snap.name } } },
      );
      const newSnapId = snapResult?.id || (snapResult?.data || snapResult)?.id;

      if (!newSnapId) {
        output += `- ✗ **${snap.name}** — failed to create snapshot\n`;
        failedCount++;
        continue;
      }

      let compCloned = 0;

      // Debug: output comparison tags for first snapshot
      if (clonedCount === 0) {
        output += `  [DBG] relationship keys: ${snap.debugRelKeys || "NONE"}\n`;
        for (const c of comparisonsWithImages) {
          output += `  [DBG] tag="${c.tagName}" w=${c.width} h=${c.height} os="${c.osName}" browser="${c.browserName}"\n`;
        }
      }

      for (const comp of comparisonsWithImages) {
        // Download screenshot
        const base64 = await fetchImageAsBase64(comp.imageUrl!);
        if (!base64) {
          output += `  ⚠ Could not download image for ${comp.tagName} ${comp.width}px\n`;
          continue;
        }

        const imageBuffer = Buffer.from(base64, "base64");
        const sha = createHash("sha256").update(imageBuffer).digest("hex");

        try {
          // Create comparison with tile — must match JSON:API format with type fields
          const tagAttributes: Record<string, unknown> = {
            name: comp.tagName,
            width: comp.width,
            height: comp.height,
          };
          if (comp.osName) tagAttributes["os-name"] = comp.osName;
          if (comp.browserName)
            tagAttributes["browser-name"] = comp.browserName;

          const compResult = await targetClient.post<any>(
            `/snapshots/${newSnapId}/comparisons`,
            {
              data: {
                type: "comparisons",
                relationships: {
                  tag: {
                    data: {
                      type: "tag",
                      attributes: tagAttributes,
                    },
                  },
                  tiles: {
                    data: [
                      {
                        type: "tiles",
                        attributes: {
                          sha,
                          "status-bar-height": 0,
                          "nav-bar-height": 0,
                        },
                      },
                    ],
                  },
                },
              },
            },
          );
          const newCompId =
            compResult?.id || (compResult?.data || compResult)?.id;

          if (newCompId) {
            // Upload tile
            await targetClient.post<any>(`/comparisons/${newCompId}/tiles`, {
              data: {
                attributes: { "base64-content": base64 },
              },
            });

            // Finalize comparison
            await targetClient.post<any>(
              `/comparisons/${newCompId}/finalize`,
              {},
            );
            compCloned++;
          }
        } catch (compErr: any) {
          output += `  ⚠ ${comp.tagName} ${comp.width}px: ${compErr.message}\n`;
        }
      }

      clonedCount++;
      output += `- ✓ **${snap.name}** — ${compCloned}/${comparisonsWithImages.length} comparisons\n`;
    } catch (e: any) {
      output += `- ✗ **${snap.name}** — ${e.message}\n`;
      failedCount++;
    }
  }

  // ── Step 7: Finalize ──────────────────────────────────────────────────

  output += "\n";
  try {
    await targetClient.post<any>(`/builds/${targetBuildId}/finalize`, {});
    output += `### Build finalized ✓\n\n`;
  } catch (e: any) {
    output += `### Build finalize failed: ${e.message}\n\n`;
  }

  // Summary
  output += `### Summary\n\n`;
  output += `| | Count |\n|---|---|\n`;
  output += `| Snapshots cloned | ${clonedCount} |\n`;
  output += `| Failed/skipped | ${failedCount} |\n`;
  output += `| Target build | #${targetBuildId} |\n`;
  if (targetBuildUrl) output += `| View results | ${targetBuildUrl} |\n`;

  if (allSnapshotIds.length > 20) {
    output += `\n> Note: Cloned first 20 of ${allSnapshotIds.length} snapshots.\n`;
  }

  // Restore token
  process.env.PERCY_TOKEN = originalToken || "";

  return { content: [{ type: "text", text: output }] };
}
