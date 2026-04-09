/**
 * percy_clone_build — Deep clone: downloads DOM resources and re-creates
 * snapshots so Percy re-renders them against the target project's baseline.
 *
 * Flow:
 * 1. Read source build → get snapshot IDs
 * 2. For each snapshot: download root HTML from /snapshots/{id}/assets/head.html
 * 3. Create target build with resources
 * 4. For each snapshot: create with resource SHA → upload missing → finalize
 * 5. Finalize build → Percy re-renders DOM and creates proper comparisons
 *
 * Resources are GLOBAL by SHA — if the CSS/JS/images already exist from the
 * original build, they won't need re-uploading.
 */

import {
  percyGet,
  percyTokenPost,
  getOrCreateProjectToken,
  getPercyAuthHeaders,
} from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function getGitBranch(): Promise<string> {
  try {
    return (
      (
        await execFileAsync("git", ["branch", "--show-current"])
      ).stdout.trim() || "main"
    );
  } catch {
    return "main";
  }
}

async function getGitSha(): Promise<string> {
  try {
    return (
      await execFileAsync("git", ["rev-parse", "HEAD"])
    ).stdout.trim();
  } catch {
    return createHash("sha1")
      .update(Date.now().toString())
      .digest("hex");
  }
}

interface CloneBuildArgs {
  source_build_id: string;
  target_project_name: string;
  target_token?: string;
  source_token?: string;
  branch?: string;
}

export async function percyCloneBuildV2(
  args: CloneBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const branch = args.branch || (await getGitBranch());
  const commitSha = await getGitSha();

  let output = `## Percy Deep Clone\n\n`;
  output += `**Source:** Build #${args.source_build_id}\n`;
  output += `**Target:** ${args.target_project_name}\n`;
  output += `**Branch:** ${branch}\n\n`;

  // ── Step 1: Read source build ─────────────────────────────────────────

  output += `### Step 1: Reading source build...\n\n`;

  let sourceBuild: any;
  try {
    sourceBuild = await percyGet(
      `/builds/${args.source_build_id}`,
      config,
    );
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to read source build: ${e.message}\n\nUse BrowserStack credentials that have access to the source project.`,
        },
      ],
      isError: true,
    };
  }

  const sourceAttrs = sourceBuild?.data?.attributes || {};
  output += `Source: **${sourceAttrs.state}** — ${sourceAttrs["total-snapshots"]} snapshots, ${sourceAttrs["total-comparisons"]} comparisons\n\n`;

  // ── Step 2: Get snapshot IDs ──────────────────────────────────────────

  output += `### Step 2: Getting snapshots...\n\n`;

  let allSnapshotIds: string[] = [];
  try {
    const items = await percyGet("/build-items", config, {
      "filter[build-id]": args.source_build_id,
      "page[limit]": "30",
    });
    const itemList = items?.data || [];
    for (const item of itemList) {
      const a = item.attributes || item;
      const ids =
        a["snapshot-ids"] || a.snapshotIds || [];
      if (ids.length > 0) {
        allSnapshotIds.push(...ids.map(String));
      } else if (a["cover-snapshot-id"] || a.coverSnapshotId) {
        allSnapshotIds.push(
          String(a["cover-snapshot-id"] || a.coverSnapshotId),
        );
      }
    }
    allSnapshotIds = [...new Set(allSnapshotIds)];
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to read snapshots: ${e.message}`,
        },
      ],
      isError: true,
    };
  }

  output += `Found **${allSnapshotIds.length}** snapshots.\n\n`;

  if (allSnapshotIds.length === 0) {
    output += `Nothing to clone.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // Limit to 20 for sanity
  const snapsToClone = allSnapshotIds.slice(0, 20);

  // ── Step 3: Read each snapshot's metadata + download root HTML ────────

  output += `### Step 3: Downloading snapshot resources...\n\n`;

  const headers = getPercyAuthHeaders(config);
  const baseUrl = "https://percy.io/api/v1";

  interface SnapshotData {
    id: string;
    name: string;
    widths: number[];
    enableJavascript: boolean;
    enableLayout: boolean;
    rootHtml: string | null;
    rootSha: string | null;
    hasScreenshots: boolean;
    comparisons: Array<{
      width: number;
      height: number;
      tagName: string;
      imageUrl: string | null;
    }>;
  }

  const snapshotData: SnapshotData[] = [];

  for (const snapId of snapsToClone) {
    try {
      // Get snapshot metadata
      const snapResponse = await fetch(
        `${baseUrl}/snapshots/${snapId}?include=comparisons.head-screenshot.image,comparisons.comparison-tag`,
        { headers },
      );
      if (!snapResponse.ok) {
        output += `- ⚠ Snapshot ${snapId}: ${snapResponse.status}\n`;
        continue;
      }
      const snapJson = await snapResponse.json();
      const snapAttrs = snapJson.data?.attributes || {};
      const included = snapJson.included || [];

      // Try to download root HTML (DOM)
      let rootHtml: string | null = null;
      let rootSha: string | null = null;
      try {
        const htmlResponse = await fetch(
          `${baseUrl}/snapshots/${snapId}/assets/head.html`,
          { headers },
        );
        if (htmlResponse.ok) {
          rootHtml = await htmlResponse.text();
          rootSha = createHash("sha256")
            .update(rootHtml)
            .digest("hex");
        }
      } catch {
        // HTML not available — will fall back to screenshot clone
      }

      // Get comparison data for screenshot fallback
      const compRefs =
        snapJson.data?.relationships?.comparisons?.data || [];
      const byTypeId = new Map<string, any>();
      for (const item of included) {
        byTypeId.set(`${item.type}:${item.id}`, item);
      }

      const comparisons: SnapshotData["comparisons"] = [];
      for (const ref of compRefs) {
        const comp = byTypeId.get(`comparisons:${ref.id}`);
        if (!comp) continue;

        const width = comp.attributes?.width || 1280;
        let imageUrl: string | null = null;
        let height = 800;

        // Walk: comparison → head-screenshot → image
        const hsRef =
          comp.relationships?.["head-screenshot"]?.data;
        if (hsRef) {
          const ss = byTypeId.get(`screenshots:${hsRef.id}`);
          const imgRef = ss?.relationships?.image?.data;
          if (imgRef) {
            const img = byTypeId.get(`images:${imgRef.id}`);
            if (img) {
              imageUrl = img.attributes?.url || null;
              height = img.attributes?.height || 800;
            }
          }
        }

        // Get tag
        const tagRef =
          comp.relationships?.["comparison-tag"]?.data;
        let tagName = "Screenshot";
        if (tagRef) {
          const tag = byTypeId.get(
            `comparison-tags:${tagRef.id}`,
          );
          tagName = tag?.attributes?.name || "Screenshot";
        }

        comparisons.push({ width, height, tagName, imageUrl });
      }

      snapshotData.push({
        id: snapId,
        name: snapAttrs.name || `Snapshot ${snapId}`,
        widths: [1280], // default — will be derived from comparisons
        enableJavascript: snapAttrs["enable-javascript"] || false,
        enableLayout: snapAttrs["enable-layout"] || false,
        rootHtml,
        rootSha,
        hasScreenshots: comparisons.some((c) => c.imageUrl),
        comparisons,
      });

      const method = rootHtml ? "DOM (deep)" : "screenshot";
      output += `- ✓ **${snapAttrs.name}** — ${method}, ${comparisons.length} comparisons\n`;
    } catch (e: any) {
      output += `- ✗ Snapshot ${snapId}: ${e.message}\n`;
    }
  }

  output += "\n";

  const domSnapshots = snapshotData.filter((s) => s.rootHtml);
  const screenshotSnapshots = snapshotData.filter(
    (s) => !s.rootHtml && s.hasScreenshots,
  );

  output += `**DOM clones:** ${domSnapshots.length} (Percy will re-render)\n`;
  output += `**Screenshot clones:** ${screenshotSnapshots.length} (image copy)\n\n`;

  // ── Step 4: Create target build ───────────────────────────────────────

  output += `### Step 4: Creating target build...\n\n`;

  let targetToken: string;
  if (args.target_token) {
    targetToken = args.target_token;
  } else {
    try {
      targetToken = await getOrCreateProjectToken(
        args.target_project_name,
        config,
      );
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get target project token: ${e.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Create build with all root resource SHAs
  const allResourceShas = domSnapshots
    .filter((s) => s.rootSha)
    .map((s) => ({
      type: "resources",
      id: s.rootSha!,
      attributes: {
        "resource-url": `/${s.name.replace(/\s+/g, "-").toLowerCase()}.html`,
        "is-root": true,
        mimetype: "text/html",
      },
    }));

  let buildResult: any;
  try {
    buildResult = await percyTokenPost("/builds", targetToken, {
      data: {
        type: "builds",
        attributes: {
          branch,
          "commit-sha": commitSha,
        },
        relationships: {
          resources: { data: allResourceShas },
        },
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

  const targetBuildId = buildResult?.data?.id;
  const targetBuildUrl =
    buildResult?.data?.attributes?.["web-url"] || "";
  const missingResources =
    buildResult?.data?.relationships?.["missing-resources"]
      ?.data || [];

  output += `Target build: **#${targetBuildId}**\n`;
  if (targetBuildUrl) output += `URL: ${targetBuildUrl}\n`;
  output += `Missing resources to upload: ${missingResources.length}\n\n`;

  // ── Step 5: Upload missing resources ──────────────────────────────────

  if (missingResources.length > 0) {
    output += `### Step 5: Uploading resources...\n\n`;

    for (const missing of missingResources) {
      const missingSha = missing.id;
      // Find the matching snapshot's root HTML
      const snap = domSnapshots.find(
        (s) => s.rootSha === missingSha,
      );
      if (snap?.rootHtml) {
        try {
          const base64 = Buffer.from(snap.rootHtml).toString(
            "base64",
          );
          await percyTokenPost(
            `/builds/${targetBuildId}/resources`,
            targetToken,
            {
              data: {
                type: "resources",
                id: missingSha,
                attributes: { "base64-content": base64 },
              },
            },
          );
          output += `- ✓ Uploaded ${missingSha.slice(0, 12)}... (${snap.name})\n`;
        } catch (e: any) {
          output += `- ✗ ${missingSha.slice(0, 12)}...: ${e.message}\n`;
        }
      }
    }
    output += "\n";
  }

  // ── Step 6: Create snapshots ──────────────────────────────────────────

  output += `### Step 6: Creating snapshots...\n\n`;

  let clonedDom = 0;
  let clonedScreenshot = 0;

  // DOM snapshots — create with resource reference (Percy re-renders)
  for (const snap of domSnapshots) {
    try {
      const widths = [
        ...new Set(snap.comparisons.map((c) => c.width)),
      ].sort();

      const snapResult = await percyTokenPost(
        `/builds/${targetBuildId}/snapshots`,
        targetToken,
        {
          data: {
            type: "snapshots",
            attributes: {
              name: snap.name,
              widths: widths.length > 0 ? widths : [1280],
              "enable-javascript": snap.enableJavascript,
              "enable-layout": snap.enableLayout,
            },
            relationships: {
              resources: {
                data: snap.rootSha
                  ? [
                      {
                        type: "resources",
                        id: snap.rootSha,
                        attributes: {
                          "resource-url": `/${snap.name.replace(/\s+/g, "-").toLowerCase()}.html`,
                          "is-root": true,
                          mimetype: "text/html",
                        },
                      },
                    ]
                  : [],
              },
            },
          },
        },
      );

      const newSnapId = snapResult?.data?.id;
      if (newSnapId) {
        // Upload any missing resources for this snapshot
        const snapMissing =
          snapResult?.data?.relationships?.[
            "missing-resources"
          ]?.data || [];
        for (const m of snapMissing) {
          if (m.id === snap.rootSha && snap.rootHtml) {
            const base64 = Buffer.from(
              snap.rootHtml,
            ).toString("base64");
            try {
              await percyTokenPost(
                `/builds/${targetBuildId}/resources`,
                targetToken,
                {
                  data: {
                    type: "resources",
                    id: m.id,
                    attributes: {
                      "base64-content": base64,
                    },
                  },
                },
              );
            } catch {
              /* may already be uploaded */
            }
          }
        }

        // Finalize snapshot
        await percyTokenPost(
          `/snapshots/${newSnapId}/finalize`,
          targetToken,
          {},
        );

        clonedDom++;
        output += `- ✓ **${snap.name}** (DOM, ${widths.length} widths) → Percy will re-render\n`;
      }
    } catch (e: any) {
      output += `- ✗ ${snap.name}: ${e.message}\n`;
    }
  }

  // Screenshot snapshots — fallback to tile upload
  for (const snap of screenshotSnapshots) {
    try {
      const snapResult = await percyTokenPost(
        `/builds/${targetBuildId}/snapshots`,
        targetToken,
        {
          data: {
            type: "snapshots",
            attributes: { name: snap.name },
          },
        },
      );
      const newSnapId = snapResult?.data?.id;
      if (!newSnapId) continue;

      let compCount = 0;
      for (const comp of snap.comparisons) {
        if (!comp.imageUrl) continue;

        // Download screenshot
        const imgResponse = await fetch(comp.imageUrl);
        if (!imgResponse.ok) continue;
        const imgBuffer = Buffer.from(
          await imgResponse.arrayBuffer(),
        );
        const sha = createHash("sha256")
          .update(imgBuffer)
          .digest("hex");
        const base64 = imgBuffer.toString("base64");

        try {
          const compResult = await percyTokenPost(
            `/snapshots/${newSnapId}/comparisons`,
            targetToken,
            {
              data: {
                attributes: {
                  "external-debug-url": null,
                  "dom-info-sha": null,
                },
                relationships: {
                  tag: {
                    data: {
                      attributes: {
                        name: comp.tagName,
                        width: comp.width,
                        height: comp.height,
                        "os-name": "Clone",
                        "browser-name": "Screenshot",
                      },
                    },
                  },
                  tiles: {
                    data: [
                      {
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

          const compId = compResult?.data?.id;
          if (compId) {
            await percyTokenPost(
              `/comparisons/${compId}/tiles`,
              targetToken,
              {
                data: {
                  attributes: { "base64-content": base64 },
                },
              },
            );
            await percyTokenPost(
              `/comparisons/${compId}/finalize`,
              targetToken,
              {},
            );
            compCount++;
          }
        } catch {
          /* comparison failed */
        }
      }

      clonedScreenshot++;
      output += `- ✓ **${snap.name}** (screenshot, ${compCount} comparisons)\n`;
    } catch (e: any) {
      output += `- ✗ ${snap.name}: ${e.message}\n`;
    }
  }

  output += "\n";

  // ── Step 7: Finalize ──────────────────────────────────────────────────

  try {
    await percyTokenPost(
      `/builds/${targetBuildId}/finalize`,
      targetToken,
      {},
    );
    output += `### Build Finalized ✓\n\n`;
  } catch (e: any) {
    output += `### Finalize failed: ${e.message}\n\n`;
  }

  // Summary
  output += `### Summary\n\n`;
  output += `| | Count |\n|---|---|\n`;
  output += `| DOM clones (re-rendered) | ${clonedDom} |\n`;
  output += `| Screenshot clones (copied) | ${clonedScreenshot} |\n`;
  output += `| Total | ${clonedDom + clonedScreenshot} |\n`;
  output += `| Target build | #${targetBuildId} |\n`;
  if (targetBuildUrl) output += `| View | ${targetBuildUrl} |\n`;

  if (allSnapshotIds.length > 20) {
    output += `\n> Cloned first 20 of ${allSnapshotIds.length} snapshots.\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
