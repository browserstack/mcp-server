/**
 * percy_clone_build — Replay a build by re-snapshotting the same URLs.
 *
 * Two modes:
 * 1. URL Replay (web builds): Extracts page URLs from source build,
 *    re-snapshots them using Percy CLI → full DOM + CSS + JS + images
 * 2. Screenshot Copy (app builds): Downloads screenshots and re-uploads
 *
 * URL Replay is the correct approach because:
 * - Percy CLI handles full resource discovery (CSS, JS, images, fonts)
 * - Resources are properly uploaded with correct SHAs
 * - Percy re-renders with all dependencies
 * - Creates proper comparisons against target baseline
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
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

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

interface CloneBuildArgs {
  source_build_id: string;
  target_project_name: string;
  target_token?: string;
  branch?: string;
}

export async function percyCloneBuildV2(
  args: CloneBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const branch = args.branch || (await getGitBranch());

  let output = `## Percy Build Clone\n\n`;
  output += `**Source:** Build #${args.source_build_id}\n`;
  output += `**Target:** ${args.target_project_name}\n`;
  output += `**Branch:** ${branch}\n\n`;

  // ── Step 1: Read source build ─────────────────────────────────────────

  let sourceBuild: any;
  try {
    sourceBuild = await percyGet(`/builds/${args.source_build_id}`, config);
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to read source build: ${e.message}`,
        },
      ],
      isError: true,
    };
  }

  const sourceAttrs = sourceBuild?.data?.attributes || {};
  const buildType = sourceAttrs.type || "web";

  output += `Source: **${sourceAttrs.state}** — ${sourceAttrs["total-snapshots"]} snapshots, type: ${buildType}\n\n`;

  // ── Step 2: Get snapshot details ──────────────────────────────────────

  const headers = getPercyAuthHeaders(config);
  const baseUrl = "https://percy.io/api/v1";

  let allSnapshotIds: string[] = [];
  try {
    const items = await percyGet("/build-items", config, {
      "filter[build-id]": args.source_build_id,
      "page[limit]": "30",
    });
    const itemList = items?.data || [];
    for (const item of itemList) {
      const a = item.attributes || item;
      const ids = a["snapshot-ids"] || a.snapshotIds || [];
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
        { type: "text", text: `Failed to read snapshots: ${e.message}` },
      ],
      isError: true,
    };
  }

  output += `Found **${allSnapshotIds.length}** snapshots.\n\n`;

  if (allSnapshotIds.length === 0) {
    output += `Nothing to clone.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // Read snapshot metadata
  const snapsToClone = allSnapshotIds.slice(0, 20);

  interface SnapshotInfo {
    id: string;
    name: string;
    displayName: string;
    widths: number[];
    enableJavascript: boolean;
    testCase: string | null;
    // For screenshot fallback
    comparisons: Array<{
      width: number;
      height: number;
      tagName: string;
      imageUrl: string | null;
    }>;
  }

  const snapshots: SnapshotInfo[] = [];

  for (const snapId of snapsToClone) {
    try {
      const snapResponse = await fetch(
        `${baseUrl}/snapshots/${snapId}?include=comparisons.head-screenshot.image,comparisons.comparison-tag`,
        { headers },
      );
      if (!snapResponse.ok) continue;

      const snapJson = await snapResponse.json();
      const sa = snapJson.data?.attributes || {};
      const included = snapJson.included || [];

      const byTypeId = new Map<string, any>();
      for (const item of included) {
        byTypeId.set(`${item.type}:${item.id}`, item);
      }

      // Get comparison details
      const compRefs = snapJson.data?.relationships?.comparisons?.data || [];
      const comparisons: SnapshotInfo["comparisons"] = [];
      const widthSet = new Set<number>();

      for (const ref of compRefs) {
        const comp = byTypeId.get(`comparisons:${ref.id}`);
        if (!comp) continue;

        const width = comp.attributes?.width || 1280;
        widthSet.add(width);

        let imageUrl: string | null = null;
        let height = 800;

        const hsRef = comp.relationships?.["head-screenshot"]?.data;
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

        const tagRef = comp.relationships?.["comparison-tag"]?.data;
        let tagName = "Screenshot";
        if (tagRef) {
          const tag = byTypeId.get(`comparison-tags:${tagRef.id}`);
          tagName = tag?.attributes?.name || "Screenshot";
        }

        comparisons.push({ width, height, tagName, imageUrl });
      }

      snapshots.push({
        id: snapId,
        name: sa.name || `Snapshot ${snapId}`,
        displayName: sa["display-name"] || sa.name || "",
        widths: [...widthSet].sort(),
        enableJavascript: sa["enable-javascript"] || false,
        testCase: sa["test-case-name"] || null,
        comparisons,
      });
    } catch {
      /* skip failed snapshots */
    }
  }

  output += `Read **${snapshots.length}** snapshot details.\n\n`;

  // ── Step 3: Get target project token ──────────────────────────────────

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
          { type: "text", text: `Failed to get target token: ${e.message}` },
        ],
        isError: true,
      };
    }
  }

  // ── Step 4: Determine clone mode ────────────────────────────────────────

  // Check if snapshots have URL names (web builds where name IS the URL)
  const hasUrlNames = snapshots.some(
    (s) => s.name.startsWith("http://") || s.name.startsWith("https://"),
  );

  let hasCli = false;
  if (hasUrlNames) {
    try {
      await execFileAsync("npx", ["@percy/cli", "--version"]);
      hasCli = true;
    } catch {
      hasCli = false;
    }
  }

  if (hasCli && hasUrlNames && buildType === "web") {
    // URL Replay: Percy CLI re-snapshots with full resources
    return await replayWithPercyCli(
      output,
      snapshots,
      targetToken,
      branch,
      args.target_project_name,
    );
  } else {
    // Screenshot copy: always works — downloads and re-uploads images
    return await copyScreenshots(output, snapshots, targetToken, branch);
  }
}

// ── URL Replay (Percy CLI) ──────────────────────────────────────────────────

async function replayWithPercyCli(
  output: string,
  snapshots: Array<{
    name: string;
    displayName: string;
    widths: number[];
    testCase: string | null;
    enableJavascript: boolean;
  }>,
  token: string,
  branch: string,
  projectName: string,
): Promise<CallToolResult> {
  output += `### Mode: URL Replay (Percy CLI)\n\n`;
  output += `Percy CLI will re-snapshot each page with full resource discovery.\n\n`;

  // Build snapshots.yml — use snapshot names as identifiers
  // For web builds, snapshot names often contain the URL path
  let yamlContent = "";
  const uniqueNames = new Set<string>();

  for (const snap of snapshots) {
    // Skip duplicates
    if (uniqueNames.has(snap.name)) continue;
    uniqueNames.add(snap.name);

    const name = snap.displayName || snap.name;
    const widths = snap.widths.length > 0 ? snap.widths : [1280];

    yamlContent += `- name: "${name}"\n`;
    // If name looks like a URL or path, use it as the URL
    if (snap.name.startsWith("http://") || snap.name.startsWith("https://")) {
      yamlContent += `  url: ${snap.name}\n`;
    } else {
      // For non-URL names, we can't determine the URL
      // Skip this snapshot — user needs to provide the base URL
      yamlContent += `  # NOTE: Cannot determine URL from snapshot name "${snap.name}"\n`;
      yamlContent += `  # Provide the URL manually or use percy_create_build with urls parameter\n`;
      yamlContent += `  url: "UNKNOWN"\n`;
    }
    yamlContent += `  waitForTimeout: 3000\n`;
    if (snap.enableJavascript) {
      yamlContent += `  enableJavaScript: true\n`;
    }
    if (snap.testCase) {
      yamlContent += `  testCase: "${snap.testCase}"\n`;
    }
    yamlContent += `  widths:\n`;
    widths.forEach((w) => {
      yamlContent += `    - ${w}\n`;
    });
  }

  // Check if any snapshots have URLs
  const hasUrls = snapshots.some(
    (s) => s.name.startsWith("http://") || s.name.startsWith("https://"),
  );

  if (!hasUrls) {
    // Snapshots don't have URL names — show the YAML for manual editing
    output += `**Snapshots don't contain URL paths.** The snapshot names are:\n\n`;
    for (const snap of snapshots.slice(0, 10)) {
      output += `- ${snap.displayName || snap.name} (${snap.widths.join(", ")}px)\n`;
    }
    output += `\nTo replay, provide the base URL and use:\n`;
    output += `\`\`\`\nUse percy_create_build with project_name "${projectName}" and urls "http://your-app.com/page1,http://your-app.com/page2"\n\`\`\`\n\n`;
    output += `Or save this config as snapshots.yml and edit the URLs:\n`;
    output += `\`\`\`yaml\n${yamlContent.slice(0, 1000)}\n\`\`\`\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // Write and run Percy CLI
  const tmpDir = await mkdtemp(join(tmpdir(), "percy-clone-"));
  const configPath = join(tmpDir, "snapshots.yml");
  await writeFile(configPath, yamlContent);

  const child = spawn("npx", ["@percy/cli", "snapshot", configPath], {
    env: { ...process.env, PERCY_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let buildUrl = "";
  let stdoutData = "";

  child.stdout?.on("data", (d: Buffer) => {
    const text = d.toString();
    stdoutData += text;
    const match = text.match(/https:\/\/percy\.io\/[^\s]+\/builds\/\d+/);
    if (match) buildUrl = match[0];
  });
  child.stderr?.on("data", (d: Buffer) => {
    stdoutData += d.toString();
  });

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 30000);
    child.on("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    const check = setInterval(() => {
      if (buildUrl) {
        clearTimeout(timeout);
        clearInterval(check);
        resolve();
      }
    }, 500);
  });

  child.unref();

  setTimeout(async () => {
    try {
      await unlink(configPath);
    } catch {
      /* ignore */
    }
  }, 120000);

  output += `**Replaying ${uniqueNames.size} snapshots...**\n\n`;

  if (buildUrl) {
    output += `**Build URL:** ${buildUrl}\n\n`;
    output += `Percy CLI is re-snapshotting with full resource discovery (CSS, JS, images, fonts).\n`;
    output += `Results ready in 1-3 minutes.\n`;
  } else {
    const percyLines = stdoutData
      .split("\n")
      .filter((l) => l.includes("[percy"))
      .slice(0, 10);
    if (percyLines.length > 0) {
      output += `**Percy output:**\n\`\`\`\n${percyLines.join("\n")}\n\`\`\`\n`;
    } else {
      output += `Percy is processing in background. Check dashboard.\n`;
    }
  }

  return { content: [{ type: "text", text: output }] };
}

// ── Screenshot Copy (fallback) ──────────────────────────────────────────────

async function copyScreenshots(
  output: string,
  snapshots: Array<{
    name: string;
    comparisons: Array<{
      width: number;
      height: number;
      tagName: string;
      imageUrl: string | null;
    }>;
  }>,
  token: string,
  branch: string,
): Promise<CallToolResult> {
  output += `### Mode: Screenshot Copy\n\n`;
  output += `Downloading screenshots and re-uploading to target project.\n\n`;

  const commitSha = createHash("sha1")
    .update(Date.now().toString())
    .digest("hex");

  // Create build
  let buildResult: any;
  try {
    buildResult = await percyTokenPost("/builds", token, {
      data: {
        type: "builds",
        attributes: { branch, "commit-sha": commitSha },
        relationships: { resources: { data: [] } },
      },
    });
  } catch (e: any) {
    output += `Failed to create build: ${e.message}\n`;
    return { content: [{ type: "text", text: output }], isError: true };
  }

  const buildId = buildResult?.data?.id;
  const buildUrl = buildResult?.data?.attributes?.["web-url"] || "";

  output += `Target build: **#${buildId}**\n`;
  if (buildUrl) output += `URL: ${buildUrl}\n`;
  output += "\n";

  let cloned = 0;

  for (const snap of snapshots) {
    const compsWithImages = snap.comparisons.filter((c) => c.imageUrl);
    if (compsWithImages.length === 0) continue;

    try {
      const snapResult = await percyTokenPost(
        `/builds/${buildId}/snapshots`,
        token,
        {
          data: { type: "snapshots", attributes: { name: snap.name } },
        },
      );
      const newSnapId = snapResult?.data?.id;
      if (!newSnapId) continue;

      let compCount = 0;
      for (const comp of compsWithImages) {
        const imgResponse = await fetch(comp.imageUrl!);
        if (!imgResponse.ok) continue;

        const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
        const sha = createHash("sha256").update(imgBuffer).digest("hex");
        const base64 = imgBuffer.toString("base64");

        try {
          const compResult = await percyTokenPost(
            `/snapshots/${newSnapId}/comparisons`,
            token,
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
            await percyTokenPost(`/comparisons/${compId}/tiles`, token, {
              data: { attributes: { "base64-content": base64 } },
            });
            await percyTokenPost(`/comparisons/${compId}/finalize`, token, {});
            compCount++;
          }
        } catch {
          /* comparison failed */
        }
      }

      cloned++;
      output += `- ✓ **${snap.name}** (${compCount} comparisons)\n`;
    } catch (e: any) {
      output += `- ✗ ${snap.name}: ${e.message}\n`;
    }
  }

  // Finalize
  try {
    await percyTokenPost(`/builds/${buildId}/finalize`, token, {});
    output += `\n**Build finalized.** ${cloned} snapshots cloned.\n`;
  } catch (e: any) {
    output += `\nFinalize failed: ${e.message}\n`;
  }

  if (buildUrl) output += `**View:** ${buildUrl}\n`;

  return { content: [{ type: "text", text: output }] };
}
