/**
 * percy_clone_build — Clone a build into a different project. Fully automatic.
 *
 * Auto-selects the best strategy without user intervention:
 *
 * 1. Percy CLI (preferred — auto-installs if missing):
 *    - For URL-named snapshots: re-snapshots with full DOM/CSS/JS
 *    - Always used for web projects when snapshots have URLs
 *
 * 2. Screenshot Copy (for app/automate/generic builds, or web without URLs):
 *    - Downloads rendered screenshots from source build
 *    - Re-uploads as tiles via API
 *    - Copies real device/browser names from source
 *    - For web projects without URLs: clones into same project as app-type
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

/** Strip base64 padding for Percy's strict base64 requirement */
function toStrictBase64(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=+$/, "");
}

interface ComparisonInfo {
  width: number;
  height: number;
  tagName: string;
  osName: string;
  osVersion: string;
  browserName: string;
  browserVersion: string;
  orientation: string;
  imageUrl: string | null;
}

interface SnapshotInfo {
  id: string;
  name: string;
  displayName: string;
  widths: number[];
  enableJavascript: boolean;
  testCase: string | null;
  comparisons: ComparisonInfo[];
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
        { type: "text", text: `Failed to read source build: ${e.message}` },
      ],
      isError: true,
    };
  }

  const sourceAttrs = sourceBuild?.data?.attributes || {};
  const buildType = sourceAttrs.type || "web";

  output += `Source: **${sourceAttrs.state}** — ${sourceAttrs["total-snapshots"]} snapshots, type: ${buildType}\n\n`;

  // ── Step 2: Get snapshot details with full comparison/device info ──────

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

  // Read snapshot metadata with full comparison-tag details
  const snapsToClone = allSnapshotIds.slice(0, 20);
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

      const compRefs = snapJson.data?.relationships?.comparisons?.data || [];
      const comparisons: ComparisonInfo[] = [];
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

        // Extract REAL device/browser info from comparison tag
        const tagRef = comp.relationships?.["comparison-tag"]?.data;
        let tagName = "Chrome";
        let osName = "";
        let osVersion = "";
        let browserName = "Chrome";
        let browserVersion = "";
        let orientation = "portrait";

        if (tagRef) {
          const tag = byTypeId.get(`comparison-tags:${tagRef.id}`);
          if (tag?.attributes) {
            const ta = tag.attributes;
            tagName = ta.name || tagName;
            osName = ta["os-name"] || osName;
            osVersion = ta["os-version"] || osVersion;
            browserName = ta["browser-name"] || browserName;
            browserVersion = ta["browser-version"] || browserVersion;
            orientation = ta.orientation || orientation;
          }
        }

        comparisons.push({
          width,
          height,
          tagName,
          osName,
          osVersion,
          browserName,
          browserVersion,
          orientation,
          imageUrl,
        });
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

  // ── Step 3: Ensure Percy CLI is available (auto-install if missing) ───

  let hasCli = false;
  try {
    await execFileAsync("npx", ["@percy/cli", "--version"]);
    hasCli = true;
  } catch {
    output += `Installing Percy CLI...\n`;
    try {
      await execFileAsync("npm", ["install", "-g", "@percy/cli"], {
        timeout: 60000,
      });
      hasCli = true;
      output += `Percy CLI installed.\n\n`;
    } catch {
      hasCli = false;
      output += `Percy CLI install failed — using screenshot copy.\n\n`;
    }
  }

  // ── Step 4: Get target project token ──────────────────────────────────

  let targetToken: string;
  if (args.target_token) {
    targetToken = args.target_token;
  } else {
    try {
      // Don't force a type — use existing project as-is, or create with default type
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

  // ── Step 5: Determine clone mode ──────────────────────────────────────
  //
  // Priority:
  //   1. Percy CLI + URL-named snapshots → URL Replay (best for web builds)
  //   2. Percy CLI + non-URL snapshots + web build → still screenshot copy
  //   3. No CLI → screenshot copy (app/automate/generic only)
  //

  const hasUrlNames = snapshots.some(
    (s) => s.name.startsWith("http://") || s.name.startsWith("https://"),
  );

  if (hasCli && hasUrlNames) {
    return await replayWithPercyCli(
      output,
      snapshots,
      targetToken,
      branch,
      args.target_project_name,
    );
  }

  // Screenshot copy — works for app/automate/generic projects.
  // For web projects with non-URL snapshots, we need an app-type project.
  // Look up target project type to decide.

  const isRenderingBuild =
    buildType === "web" ||
    buildType === "visual_scanner" ||
    buildType === "lca";

  if (isRenderingBuild) {
    // Source is web-type but snapshots don't have URLs (can't use CLI replay).
    // Screenshot copy needs app-type project. Try to get/create one.
    let appToken: string;
    let appProjectName = args.target_project_name;
    try {
      appToken = await getOrCreateProjectToken(
        args.target_project_name,
        config,
        "app",
      );
    } catch {
      // Existing project is web-type — can't change it. Use companion project.
      appProjectName = `${args.target_project_name}-clone`;
      output += `"${args.target_project_name}" is web-type. Cloning screenshots into "${appProjectName}" (app-type).\n\n`;
      try {
        appToken = await getOrCreateProjectToken(appProjectName, config, "app");
      } catch (e: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create clone project: ${e.message}`,
            },
          ],
          isError: true,
        };
      }
    }
    return await copyScreenshots(
      output,
      snapshots,
      appToken,
      branch,
      appProjectName,
    );
  }

  // App/automate/generic — clone directly into same project
  return await copyScreenshots(
    output,
    snapshots,
    targetToken,
    branch,
    args.target_project_name,
  );
}

// ── URL Replay (Percy CLI) ──────────────────────────────────────────────────

async function replayWithPercyCli(
  output: string,
  snapshots: SnapshotInfo[],
  token: string,
  branch: string,
  projectName: string,
): Promise<CallToolResult> {
  output += `### Mode: URL Replay (Percy CLI)\n\n`;
  output += `**Project:** ${projectName}\n`;
  output += `Percy CLI will re-snapshot each page with full resource discovery.\n\n`;

  let yamlContent = "";
  const uniqueNames = new Set<string>();

  for (const snap of snapshots) {
    if (uniqueNames.has(snap.name)) continue;
    uniqueNames.add(snap.name);

    const name = snap.displayName || snap.name;
    const widths = snap.widths.length > 0 ? snap.widths : [1280];

    yamlContent += `- name: "${name}"\n`;
    if (snap.name.startsWith("http://") || snap.name.startsWith("https://")) {
      yamlContent += `  url: ${snap.name}\n`;
    } else {
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

  const hasUrls = snapshots.some(
    (s) => s.name.startsWith("http://") || s.name.startsWith("https://"),
  );

  if (!hasUrls) {
    output += `**Snapshots don't have URL names.** Use \`percy_create_build\` with URLs instead.\n`;
    output += `\nSnapshot names:\n`;
    for (const snap of snapshots.slice(0, 10)) {
      output += `- ${snap.displayName || snap.name} (${snap.widths.join(", ")}px)\n`;
    }
    return { content: [{ type: "text", text: output }] };
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "percy-clone-"));
  const configPath = join(tmpDir, "snapshots.yml");
  await writeFile(configPath, yamlContent);

  const child = spawn("npx", ["@percy/cli", "snapshot", configPath], {
    env: { ...process.env, PERCY_TOKEN: token, PERCY_BRANCH: branch },
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
    output += `Percy CLI is re-snapshotting with full resource discovery.\n`;
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

// ── Screenshot Copy (tile-based) ────────────────────────────────────────────
//
// Downloads rendered screenshots and re-uploads as tiles.
// Works for app/automate/generic project types.
//
// API flow:
//   POST /builds                            → create build
//   POST /builds/:id/snapshots              → create snapshot (no resources)
//   POST /snapshots/:id/comparisons         → create comparison with tag + tile SHAs
//   POST /comparisons/:id/tiles             → upload tile image (strict base64)
//   POST /comparisons/:id/finalize          → finalize comparison
//   POST /builds/:id/finalize               → finalize build
//

async function copyScreenshots(
  output: string,
  snapshots: SnapshotInfo[],
  token: string,
  branch: string,
  projectName: string,
): Promise<CallToolResult> {
  output += `### Mode: Screenshot Copy (tile-based)\n\n`;
  output += `**Project:** ${projectName}\n`;
  output += `Downloading screenshots and re-uploading as tiles.\n\n`;

  const commitSha = createHash("sha1")
    .update(Date.now().toString())
    .digest("hex");

  // Step 1: Create build
  let buildResult: any;
  try {
    buildResult = await percyTokenPost("/builds", token, {
      data: {
        type: "builds",
        attributes: { branch, "commit-sha": commitSha },
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
  let compTotal = 0;

  for (const snap of snapshots) {
    const compsWithImages = snap.comparisons.filter((c) => c.imageUrl);
    if (compsWithImages.length === 0) continue;

    try {
      // Step 2: Create snapshot (no resources needed for app builds)
      const snapResult = await percyTokenPost(
        `/builds/${buildId}/snapshots`,
        token,
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
      for (const comp of compsWithImages) {
        try {
          const imgResponse = await fetch(comp.imageUrl!);
          if (!imgResponse.ok) continue;

          const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
          const sha = createHash("sha256").update(imgBuffer).digest("hex");
          const base64 = toStrictBase64(imgBuffer);

          // Step 3: Create comparison with tag + tile SHAs
          // Use real device/browser info from source comparison
          const compResult = await percyTokenPost(
            `/snapshots/${newSnapId}/comparisons`,
            token,
            {
              data: {
                type: "comparisons",
                relationships: {
                  tag: {
                    data: {
                      type: "tag",
                      attributes: {
                        name: comp.tagName,
                        width: comp.width,
                        height: comp.height,
                        "os-name": comp.osName,
                        "os-version": comp.osVersion,
                        "browser-name": comp.browserName,
                        "browser-version": comp.browserVersion,
                        orientation: comp.orientation,
                      },
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
                          "header-height": 0,
                          "footer-height": 0,
                          fullscreen: false,
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
            // Step 4: Upload tile image (strict base64, no padding)
            await percyTokenPost(`/comparisons/${compId}/tiles`, token, {
              data: {
                type: "tiles",
                attributes: { "base64-content": base64 },
              },
            });
            // Step 5: Finalize comparison
            await percyTokenPost(`/comparisons/${compId}/finalize`, token, {});
            compCount++;
          }
        } catch (compErr: any) {
          output += `  - Comparison failed (${comp.tagName} ${comp.width}px): ${compErr.message?.slice(0, 120)}\n`;
        }
      }

      compTotal += compCount;
      cloned++;
      output += `- **${snap.name}** — ${compCount} comparison${compCount !== 1 ? "s" : ""} (${compsWithImages.map((c) => `${c.browserName || c.tagName} ${c.width}px`).join(", ")})\n`;
    } catch (e: any) {
      output += `- FAILED ${snap.name}: ${e.message}\n`;
    }
  }

  // Step 6: Finalize build
  try {
    await percyTokenPost(`/builds/${buildId}/finalize`, token, {});
    output += `\n**Build finalized.** ${cloned}/${snapshots.length} snapshots, ${compTotal} comparisons.\n`;
  } catch (e: any) {
    output += `\nFinalize failed: ${e.message}\n`;
  }

  if (buildUrl) output += `**View:** ${buildUrl}\n`;

  return { content: [{ type: "text", text: output }] };
}
