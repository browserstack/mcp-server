/**
 * percy_clone_build — Clone snapshots from a source build to a new build,
 * even across different projects.
 *
 * How it works:
 * 1. Reads all snapshots + comparisons from the source build
 * 2. Creates a new build in the target project
 * 3. For each snapshot: creates snapshot in target, creates comparisons
 *    with same tiles/screenshots, uploads tile data, finalizes
 * 4. Finalizes the target build
 *
 * Images/resources are globally stored by SHA in Percy — so cross-project
 * cloning reuses the same storage (no re-upload needed for images that exist).
 */

import { PercyClient } from "../../../lib/percy-api/client.js";
import { getBrowserStackAuth } from "../../../lib/get-auth.js";
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
  const params = new URLSearchParams({ name: projectName });
  const url = `https://api.browserstack.com/api/app_percy/get_project_token?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get token for project "${projectName}"`);
  }

  const data = await response.json();
  if (!data?.token || !data?.success) {
    throw new Error(`No token returned for project "${projectName}"`);
  }

  return data.token;
}

// ── Fetch screenshot image as base64 ────────────────────────────────────────

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

// ── Main handler ────────────────────────────────────────────────────────────

interface CloneBuildArgs {
  source_build_id: string;
  source_token?: string;
  target_project_name: string;
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

  // ── Step 1: Set up source client ──────────────────────────────────────

  let sourceToken: string;
  if (args.source_token) {
    sourceToken = args.source_token;
  } else if (process.env.PERCY_TOKEN) {
    sourceToken = process.env.PERCY_TOKEN;
  } else {
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

  // Source client uses the source token
  process.env.PERCY_TOKEN = sourceToken;
  const sourceClient = new PercyClient(config);

  // ── Step 2: Read source build ─────────────────────────────────────────

  output += `### Reading source build...\n\n`;

  let sourceBuild: any;
  try {
    sourceBuild = await sourceClient.get<any>(`/builds/${source_build_id}`, {
      "include-metadata": "true",
    });
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to read source build #${source_build_id}: ${e.message}\n\nMake sure the source token has read access. Use a \`web_*\` or \`auto_*\` token, not a CI token.`,
        },
      ],
      isError: true,
    };
  }

  const sourceState = sourceBuild?.state || "unknown";
  output += `Source build state: **${sourceState}**\n`;

  // ── Step 3: Get source snapshots ──────────────────────────────────────

  let snapshots: any[] = [];
  try {
    const items = await sourceClient.get<any>("/build-items", {
      "filter[build-id]": source_build_id,
      "page[limit]": "30",
    });
    snapshots = Array.isArray(items) ? items : [];
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to read source snapshots: ${e.message}`,
        },
      ],
      isError: true,
    };
  }

  output += `Source snapshots: **${snapshots.length}**\n\n`;

  if (snapshots.length === 0) {
    output += `No snapshots found in source build. Nothing to clone.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // ── Step 4: Get detailed snapshot data with comparisons ───────────────

  output += `### Fetching snapshot details...\n\n`;

  const snapshotDetails: any[] = [];
  for (const snap of snapshots.slice(0, 20)) {
    // Limit to 20 snapshots
    const snapId = snap.id || snap.snapshotId || snap.snapshot?.id;
    if (!snapId) continue;

    try {
      const detail = await sourceClient.get<any>(`/snapshots/${snapId}`, {}, [
        "comparisons.head-screenshot.image",
        "comparisons.comparison-tag",
        "comparisons.browser.browser-family",
      ]);
      snapshotDetails.push(detail);
    } catch {
      output += `- ⚠ Could not read snapshot ${snapId}\n`;
    }
  }

  output += `Read ${snapshotDetails.length} snapshot(s) with comparison data.\n\n`;

  // ── Step 5: Get target project token ──────────────────────────────────

  output += `### Setting up target project...\n\n`;

  let targetToken: string;
  try {
    targetToken = await getProjectToken(target_project_name, config);
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to create/access target project "${target_project_name}": ${e.message}`,
        },
      ],
      isError: true,
    };
  }

  // Switch to target token
  process.env.PERCY_TOKEN = targetToken;
  const targetClient = new PercyClient(config);

  // ── Step 6: Create target build ───────────────────────────────────────

  let targetBuild: any;
  try {
    targetBuild = await targetClient.post<any>("/builds", {
      data: {
        type: "builds",
        attributes: {
          branch,
          "commit-sha": commitSha,
        },
        relationships: { resources: { data: [] } },
      },
    });
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to create target build: ${e.message}`,
        },
      ],
      isError: true,
    };
  }

  const targetBuildData = targetBuild?.data || targetBuild;
  const targetBuildId = targetBuildData?.id;
  const targetBuildUrl =
    targetBuildData?.webUrl || targetBuildData?.["web-url"] || "";

  output += `Target build created: **#${targetBuildId}**\n`;
  if (targetBuildUrl) output += `URL: ${targetBuildUrl}\n`;
  output += "\n";

  // ── Step 7: Clone each snapshot ───────────────────────────────────────

  output += `### Cloning snapshots...\n\n`;

  let clonedCount = 0;
  let failedCount = 0;

  for (const detail of snapshotDetails) {
    const snapName = detail?.name || "Unknown";
    const comparisons = detail?.comparisons || [];

    try {
      // For app/screenshot builds: create snapshot + comparisons with tiles
      if (comparisons.length > 0) {
        // Check if comparisons have screenshots (app/screenshot build)
        const hasScreenshots = comparisons.some(
          (c: any) => c?.headScreenshot?.image?.url,
        );

        if (hasScreenshots) {
          // App/screenshot build — create snapshot and comparisons
          const snapResult = await targetClient.post<any>(
            `/builds/${targetBuildId}/snapshots`,
            {
              data: {
                type: "snapshots",
                attributes: { name: snapName },
              },
            },
          );
          const newSnapData = snapResult?.data || snapResult;
          const newSnapId = newSnapData?.id;

          if (!newSnapId) {
            output += `- ✗ ${snapName}: failed to create snapshot\n`;
            failedCount++;
            continue;
          }

          // Create comparison for each source comparison
          for (const comp of comparisons) {
            const tag = comp?.comparisonTag || comp?.["comparison-tag"] || {};
            const headImage = comp?.headScreenshot?.image;
            const imageUrl = headImage?.url;

            if (!imageUrl) continue;

            // Download the screenshot
            const base64 = await fetchImageAsBase64(imageUrl);
            if (!base64) {
              output += `- ⚠ ${snapName}: could not download screenshot\n`;
              continue;
            }

            // Compute SHA
            const imageBuffer = Buffer.from(base64, "base64");
            const sha = createHash("sha256").update(imageBuffer).digest("hex");

            const tagWidth =
              tag?.width || headImage?.width || comp?.width || 1280;
            const tagHeight = tag?.height || headImage?.height || 800;

            // Create comparison with tile
            try {
              const compResult = await targetClient.post<any>(
                `/snapshots/${newSnapId}/comparisons`,
                {
                  data: {
                    type: "comparisons",
                    attributes: {},
                    relationships: {
                      tag: {
                        data: {
                          type: "tag",
                          attributes: {
                            name: tag?.name || "Cloned",
                            width: tagWidth,
                            height: tagHeight,
                            "os-name":
                              tag?.osName || tag?.["os-name"] || "Clone",
                            "browser-name":
                              tag?.browserName ||
                              tag?.["browser-name"] ||
                              "Screenshot",
                          },
                        },
                      },
                      tiles: {
                        data: [{ type: "tiles", attributes: { sha } }],
                      },
                    },
                  },
                },
              );

              const newCompData = compResult?.data || compResult;
              const newCompId = newCompData?.id;

              if (newCompId) {
                // Upload the tile
                await targetClient.post<any>(
                  `/comparisons/${newCompId}/tiles`,
                  {
                    data: {
                      type: "tiles",
                      attributes: { "base64-content": base64 },
                    },
                  },
                );

                // Finalize comparison
                await targetClient.post<any>(
                  `/comparisons/${newCompId}/finalize`,
                  {},
                );
              }
            } catch (compError: any) {
              output += `- ⚠ ${snapName}: comparison failed — ${compError.message}\n`;
            }
          }

          clonedCount++;
          output += `- ✓ **${snapName}** — ${comparisons.length} comparison(s) cloned\n`;
        } else {
          // Web/rendering build — snapshots need DOM resources, can't easily clone
          // Just log the snapshot info for the user
          output += `- ⚠ **${snapName}** — web build snapshot (DOM-based, cannot clone images directly)\n`;
          output += `    Re-snapshot this URL with: \`percy_create_percy_build\` with urls\n`;
          failedCount++;
        }
      }
    } catch (e: any) {
      output += `- ✗ ${snapName}: ${e.message}\n`;
      failedCount++;
    }
  }

  // ── Step 8: Finalize target build ─────────────────────────────────────

  output += "\n";

  try {
    await targetClient.post<any>(`/builds/${targetBuildId}/finalize`, {});
    output += `### Build finalized ✓\n\n`;
  } catch (e: any) {
    output += `### Build finalize failed: ${e.message}\n\n`;
  }

  // ── Summary ───────────────────────────────────────────────────────────

  output += `### Summary\n\n`;
  output += `| | Count |\n`;
  output += `|---|---|\n`;
  output += `| Snapshots cloned | ${clonedCount} |\n`;
  output += `| Failed/skipped | ${failedCount} |\n`;
  output += `| Target build | #${targetBuildId} |\n`;
  if (targetBuildUrl) output += `| View results | ${targetBuildUrl} |\n`;

  if (failedCount > 0 && clonedCount === 0) {
    output +=
      "\n> **Note:** Web/rendering builds store DOM, not screenshots. " +
      "To clone web builds, re-snapshot the same URLs using `percy_create_percy_build` " +
      "with the `urls` parameter.\n";
  }

  // Restore original token
  if (sourceToken) {
    process.env.PERCY_TOKEN = sourceToken;
  }

  return { content: [{ type: "text", text: output }] };
}
