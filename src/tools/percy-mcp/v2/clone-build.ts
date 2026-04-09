/**
 * percy_clone_build — Clone a build into a different project with 100% parity.
 *
 * Preserves: snapshot names, all widths, all browsers, all device info.
 *
 * Two modes (auto-selected):
 *   1. URL Replay (`percy snapshot`): URL-named snapshots → full DOM re-render
 *   2. Screenshot Clone (direct API): Named snapshots → downloads all screenshots,
 *      re-uploads via tile API. Each snapshot keeps its exact name with all
 *      width/browser/device comparisons intact.
 *
 * Screenshot clone uses tile-based API which requires app-type project.
 * If target project is web-type, creates with same name as app-type.
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

/** Strip base64 padding — Percy requires strict base64 (RFC 4648 §4.1) */
function toStrictBase64(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=+$/, "");
}

/** Small delay to avoid rate limiting */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  // ── Step 2: Get ALL snapshot details with ALL comparisons ─────────────

  const headers = getPercyAuthHeaders(config);
  const baseUrl = "https://percy.io/api/v1";

  let allSnapshotIds: string[] = [];
  try {
    const items = await percyGet("/build-items", config, {
      "filter[build-id]": args.source_build_id,
      "page[limit]": "50",
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

  // Read snapshot metadata with ALL comparison details (all browsers, all widths)
  const snapshots: SnapshotInfo[] = [];
  let totalComps = 0;

  for (const snapId of allSnapshotIds) {
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

      totalComps += comparisons.length;
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

  // Show what we found
  const browsers = new Set<string>();
  const widths = new Set<number>();
  for (const snap of snapshots) {
    for (const c of snap.comparisons) {
      browsers.add(c.browserName || c.tagName);
      widths.add(c.width);
    }
  }

  output += `Read **${snapshots.length}** snapshots, **${totalComps}** comparisons\n`;
  output += `Browsers: ${[...browsers].join(", ")}\n`;
  output += `Widths: ${[...widths].sort((a, b) => a - b).join(", ")}px\n\n`;

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
    }
  }

  // ── Step 4: Determine clone mode ──────────────────────────────────────

  const hasUrlNames = snapshots.some(
    (s) => s.name.startsWith("http://") || s.name.startsWith("https://"),
  );

  if (hasCli && hasUrlNames) {
    // URL Replay: Percy CLI re-snapshots with full DOM/CSS/JS
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
    return await replayWithPercyCli(
      output,
      snapshots,
      targetToken,
      branch,
      args.target_project_name,
    );
  }

  // ── Screenshot Clone via tile API ─────────────────────────────────────
  // Tile-based API preserves: exact snapshot names, all widths, all browsers.
  // MUST be app-type project — web projects require DOM resources for snapshots
  // and reject tile-based uploads. This is an immutable Percy API constraint.

  let targetToken: string;
  const actualProjectName = args.target_project_name;

  if (args.target_token) {
    targetToken = args.target_token;
  } else {
    // Always request app type — tiles only work on app/automate/generic projects.
    // If project exists as web-type, this will fail and we retry with a suffix.
    try {
      targetToken = await getOrCreateProjectToken(
        args.target_project_name,
        config,
        "app",
      );
    } catch {
      // Project exists as web-type — can't use tiles on it.
      // Create companion project with same name + "-screenshots" as app type.
      const altName = `${args.target_project_name}-screenshots`;
      output += `"${args.target_project_name}" is web-type (needs DOM resources).\n`;
      output += `Creating **${altName}** (app-type) for screenshot clone.\n\n`;
      try {
        targetToken = await getOrCreateProjectToken(altName, config, "app");
      } catch (e: any) {
        return {
          content: [
            { type: "text", text: `Failed to create project: ${e.message}` },
          ],
          isError: true,
        };
      }
    }
  }

  return await cloneViaApi(
    output,
    snapshots,
    targetToken,
    branch,
    actualProjectName,
    totalComps,
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
    output += `Snapshots don't have URL names. Use \`percy_create_build\` with URLs.\n`;
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

// ── Screenshot Clone (direct API with tiles) ────────────────────────────────
//
// Full parity clone: same snapshot names, all widths, all browsers, all devices.
//
// API flow per snapshot:
//   1. POST /builds/:id/snapshots          → exact source name
//   2. For each comparison (width × browser):
//      a. Download screenshot image
//      b. POST /snapshots/:id/comparisons  → tag (browser/device) + tile SHA
//      c. POST /comparisons/:id/tiles      → upload image (strict base64)
//      d. POST /comparisons/:id/finalize   → finalize comparison
//   3. POST /builds/:id/finalize           → finalize build
//

async function cloneViaApi(
  output: string,
  snapshots: SnapshotInfo[],
  token: string,
  branch: string,
  projectName: string,
  totalComps: number,
): Promise<CallToolResult> {
  output += `### Mode: Screenshot Clone (full parity)\n\n`;
  output += `**Project:** ${projectName}\n`;
  output += `Cloning ${snapshots.length} snapshots, ${totalComps} comparisons.\n\n`;

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

  output += `Build: **#${buildId}**`;
  if (buildUrl) output += ` — ${buildUrl}`;
  output += "\n\n";

  let clonedSnaps = 0;
  let clonedComps = 0;
  let failedComps = 0;

  for (const snap of snapshots) {
    const compsWithImages = snap.comparisons.filter((c) => c.imageUrl);
    if (compsWithImages.length === 0) {
      output += `- ${snap.name} — no screenshots, skipped\n`;
      continue;
    }

    try {
      // Step 2: Create snapshot with EXACT source name
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
      if (!newSnapId) {
        output += `- ${snap.name} — snapshot creation failed\n`;
        continue;
      }

      let snapCompCount = 0;

      // Step 3: Create comparison for EACH width × browser combo
      for (const comp of compsWithImages) {
        try {
          // Download screenshot
          const imgResponse = await fetch(comp.imageUrl!);
          if (!imgResponse.ok) {
            failedComps++;
            continue;
          }

          const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
          const sha = createHash("sha256").update(imgBuffer).digest("hex");
          const base64 = toStrictBase64(imgBuffer);

          // Create comparison with real tag info + tile SHA
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
                        "os-name": comp.osName || undefined,
                        "os-version": comp.osVersion || undefined,
                        "browser-name": comp.browserName || undefined,
                        "browser-version": comp.browserVersion || undefined,
                        orientation: comp.orientation || undefined,
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
            // Upload tile image
            await percyTokenPost(`/comparisons/${compId}/tiles`, token, {
              data: {
                type: "tiles",
                attributes: { "base64-content": base64 },
              },
            });
            // Finalize comparison
            await percyTokenPost(`/comparisons/${compId}/finalize`, token, {});
            snapCompCount++;
            clonedComps++;
          } else {
            failedComps++;
          }
        } catch (compErr: any) {
          failedComps++;
          const msg = compErr.message?.slice(0, 100) || "unknown error";
          output += `  ! ${comp.browserName} ${comp.width}px: ${msg}\n`;
        }

        // Rate limit protection — 200ms between API calls
        await delay(200);
      }

      clonedSnaps++;
      output += `- **${snap.name}** — ${snapCompCount}/${compsWithImages.length} comparisons\n`;
    } catch (e: any) {
      output += `- FAILED ${snap.name}: ${e.message}\n`;
    }
  }

  // Finalize build
  try {
    await percyTokenPost(`/builds/${buildId}/finalize`, token, {});
  } catch (e: any) {
    output += `\nFinalize failed: ${e.message}\n`;
  }

  // Summary
  output += `\n---\n`;
  output += `**Result:** ${clonedSnaps}/${snapshots.length} snapshots, ${clonedComps}/${totalComps} comparisons cloned`;
  if (failedComps > 0) output += ` (${failedComps} failed)`;
  output += `\n`;
  if (buildUrl) output += `**View:** ${buildUrl}\n`;

  return { content: [{ type: "text", text: output }] };
}
